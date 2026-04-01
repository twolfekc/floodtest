package stats

import (
	"context"
	"database/sql"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// Snapshot holds a point-in-time throughput measurement.
type Snapshot struct {
	DownloadBps int64     `json:"downloadBps"`
	UploadBps   int64     `json:"uploadBps"`
	Timestamp   time.Time `json:"timestamp"`
}

// Collector aggregates real-time throughput counters and periodically
// persists summaries and usage counters to SQLite.
type Collector struct {
	downloadBytes atomic.Int64
	uploadBytes   atomic.Int64

	mu            sync.RWMutex
	currentRate   Snapshot
	recentHistory []Snapshot // last 10 minutes of per-second snapshots

	db           *sql.DB
	sessionStart time.Time
	cancel       context.CancelFunc
}

// NewCollector creates a new Collector backed by the given database.
func NewCollector(db *sql.DB) *Collector {
	return &Collector{
		db:            db,
		sessionStart:  time.Now(),
		recentHistory: make([]Snapshot, 0, 600),
	}
}

// Start launches background goroutines for rate computation, persistence,
// and history cleanup. It blocks until ctx is cancelled.
func (c *Collector) Start(ctx context.Context) {
	ctx, c.cancel = context.WithCancel(ctx)

	go c.rateLoop(ctx)
	go c.persistLoop(ctx)
	go c.cleanupLoop(ctx)
}

// Stop cancels the background goroutines.
func (c *Collector) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
}

// AddDownloadBytes atomically adds n bytes to the download counter.
func (c *Collector) AddDownloadBytes(n int64) {
	c.downloadBytes.Add(n)
}

// AddUploadBytes atomically adds n bytes to the upload counter.
func (c *Collector) AddUploadBytes(n int64) {
	c.uploadBytes.Add(n)
}

// CurrentRate returns the most recent per-second throughput snapshot.
func (c *Collector) CurrentRate() Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.currentRate
}

// RecentHistory returns the last `seconds` worth of per-second snapshots.
// If fewer snapshots are available, all available snapshots are returned.
func (c *Collector) RecentHistory(seconds int) []Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if seconds <= 0 {
		return nil
	}
	n := len(c.recentHistory)
	if seconds > n {
		seconds = n
	}
	out := make([]Snapshot, seconds)
	copy(out, c.recentHistory[n-seconds:])
	return out
}

// GetSessionStart returns the time this collector was created.
func (c *Collector) GetSessionStart() time.Time {
	return c.sessionStart
}

// ResetSession resets the session usage counter and session start time.
func (c *Collector) ResetSession() {
	c.mu.Lock()
	c.sessionStart = time.Now()
	c.mu.Unlock()
	// Reset the session counter in DB
	c.db.Exec("DELETE FROM usage_counters WHERE period = 'session'")
}

// SessionDownloadBytes returns the cumulative download bytes for the current session.
func (c *Collector) SessionDownloadBytes() int64 {
	var bytes int64
	c.db.QueryRow("SELECT download_bytes FROM usage_counters WHERE period = 'session'").Scan(&bytes)
	return bytes
}

// SessionUploadBytes returns the cumulative upload bytes for the current session.
func (c *Collector) SessionUploadBytes() int64 {
	var bytes int64
	c.db.QueryRow("SELECT upload_bytes FROM usage_counters WHERE period = 'session'").Scan(&bytes)
	return bytes
}

// rateLoop runs every 1 second, reads and resets the atomic counters,
// computes bytes/sec, and stores the snapshot.
func (c *Collector) rateLoop(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case t := <-ticker.C:
			dl := c.downloadBytes.Swap(0)
			ul := c.uploadBytes.Swap(0)

			snap := Snapshot{
				DownloadBps: dl * 8, // bytes -> bits per second
				UploadBps:   ul * 8,
				Timestamp:   t,
			}

			c.mu.Lock()
			c.currentRate = snap
			c.recentHistory = append(c.recentHistory, snap)
			if len(c.recentHistory) > 600 {
				// Trim to keep exactly 600 entries (10 minutes).
				copy(c.recentHistory, c.recentHistory[len(c.recentHistory)-600:])
				c.recentHistory = c.recentHistory[:600]
			}
			c.mu.Unlock()
		}
	}
}

// persistLoop runs every 60 seconds, sums the last minute of snapshots,
// inserts a row into throughput_history, and upserts usage_counters.
func (c *Collector) persistLoop(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.persistMinute()
		}
	}
}

func (c *Collector) persistMinute() {
	snapshots := c.RecentHistory(60)
	if len(snapshots) == 0 {
		return
	}

	var totalDownloadBytes, totalUploadBytes int64
	for _, s := range snapshots {
		// Convert bps back to bytes for this 1-second window.
		totalDownloadBytes += s.DownloadBps / 8
		totalUploadBytes += s.UploadBps / 8
	}

	now := time.Now()

	// Insert into throughput_history.
	_, err := c.db.Exec(
		"INSERT OR REPLACE INTO throughput_history (timestamp, download_bytes, upload_bytes) VALUES (?, ?, ?)",
		now.UTC().Format(time.RFC3339), totalDownloadBytes, totalUploadBytes,
	)
	if err != nil {
		log.Printf("stats: failed to insert throughput_history: %v", err)
	}

	// Upsert usage counters for session, daily, monthly, and all_time.
	periods := []string{
		"session",
		now.UTC().Format("2006-01-02"),
		now.UTC().Format("2006-01"),
		"all_time",
	}
	for _, period := range periods {
		_, err := c.db.Exec(
			`INSERT INTO usage_counters (period, download_bytes, upload_bytes, updated_at)
			 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(period) DO UPDATE SET
			     download_bytes = usage_counters.download_bytes + excluded.download_bytes,
			     upload_bytes = usage_counters.upload_bytes + excluded.upload_bytes,
			     updated_at = CURRENT_TIMESTAMP`,
			period, totalDownloadBytes, totalUploadBytes,
		)
		if err != nil {
			log.Printf("stats: failed to upsert usage_counters for %s: %v", period, err)
		}
	}
}

// cleanupLoop runs every 24 hours and deletes throughput_history rows
// older than 90 days.
func (c *Collector) cleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cutoff := time.Now().UTC().Add(-90 * 24 * time.Hour).Format(time.RFC3339)
			_, err := c.db.Exec("DELETE FROM throughput_history WHERE timestamp < ?", cutoff)
			if err != nil {
				log.Printf("stats: failed to clean old throughput_history: %v", err)
			}
		}
	}
}
