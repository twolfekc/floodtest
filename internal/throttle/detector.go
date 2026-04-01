package throttle

import (
	"context"
	"database/sql"
	"log"
	"sync"
	"time"
)

// RateProvider returns average download and upload bps over the given window.
type RateProvider func(windowSeconds int) (avgDownloadBps, avgUploadBps int64)

// Detector monitors throughput and records throttle events when measured
// rates fall below a configurable percentage of the target speeds.
type Detector struct {
	db           *sql.DB
	rateProvider RateProvider

	mu               sync.Mutex
	thresholdPct     int   // e.g. 80 means throttle if below 80% of target
	windowMinutes    int   // averaging window in minutes
	targetDownloadBps int64
	targetUploadBps   int64

	activeDownEvent *int64 // nil when no active download throttle event
	activeUpEvent   *int64 // nil when no active upload throttle event

	cancel context.CancelFunc
}

// NewDetector creates a Detector that polls the rateProvider every 30 seconds.
//
//   - thresholdPct: percentage of target below which a throttle is detected (e.g. 80).
//   - windowMinutes: number of minutes to average when comparing against target.
func NewDetector(db *sql.DB, rateProvider RateProvider, thresholdPct int, windowMinutes int) *Detector {
	return &Detector{
		db:            db,
		rateProvider:  rateProvider,
		thresholdPct:  thresholdPct,
		windowMinutes: windowMinutes,
	}
}

// SetTargets sets the target download and upload speeds in bits per second.
func (d *Detector) SetTargets(downloadBps, uploadBps int64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.targetDownloadBps = downloadBps
	d.targetUploadBps = uploadBps
}

// SetThreshold updates the throttle threshold percentage.
func (d *Detector) SetThreshold(pct int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.thresholdPct = pct
}

// SetWindow updates the averaging window in minutes.
func (d *Detector) SetWindow(minutes int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.windowMinutes = minutes
}

// Start launches the detection goroutine that checks every 30 seconds.
func (d *Detector) Start(ctx context.Context) {
	ctx, d.cancel = context.WithCancel(ctx)
	go d.loop(ctx)
}

// Stop cancels the detection goroutine.
func (d *Detector) Stop() {
	if d.cancel != nil {
		d.cancel()
	}
}

func (d *Detector) loop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.check()
		}
	}
}

func (d *Detector) check() {
	d.mu.Lock()
	thresholdPct := d.thresholdPct
	windowMinutes := d.windowMinutes
	targetDl := d.targetDownloadBps
	targetUl := d.targetUploadBps
	d.mu.Unlock()

	avgDl, avgUl := d.rateProvider(windowMinutes * 60)

	d.evaluateDirection("download", targetDl, avgDl, thresholdPct, &d.activeDownEvent)
	d.evaluateDirection("upload", targetUl, avgUl, thresholdPct, &d.activeUpEvent)
}

// evaluateDirection checks one direction and creates/updates/resolves throttle events.
// The caller must NOT hold d.mu; this method acquires it internally for activeEvent access.
func (d *Detector) evaluateDirection(direction string, targetBps, avgBps int64, thresholdPct int, activeEvent **int64) {
	if targetBps <= 0 {
		return
	}

	threshold := targetBps * int64(thresholdPct) / 100
	isThrottled := avgBps < threshold && avgBps > 0

	d.mu.Lock()
	defer d.mu.Unlock()

	if isThrottled {
		if *activeEvent == nil {
			// Open a new throttle event.
			res, err := d.db.Exec(
				`INSERT INTO throttle_events (timestamp, direction, target_bps, actual_bps, duration_seconds)
				 VALUES (?, ?, ?, ?, 0)`,
				time.Now().UTC().Format(time.RFC3339), direction, targetBps, avgBps,
			)
			if err != nil {
				log.Printf("throttle: failed to insert event (%s): %v", direction, err)
				return
			}
			id, err := res.LastInsertId()
			if err != nil {
				log.Printf("throttle: failed to get last insert id (%s): %v", direction, err)
				return
			}
			*activeEvent = &id
		} else {
			// Update duration of existing event.
			_, err := d.db.Exec(
				`UPDATE throttle_events
				 SET duration_seconds = duration_seconds + 30,
				     actual_bps = ?
				 WHERE id = ?`,
				avgBps, **activeEvent,
			)
			if err != nil {
				log.Printf("throttle: failed to update event %d (%s): %v", **activeEvent, direction, err)
			}
		}
	} else {
		// Not throttled: resolve any active event.
		if *activeEvent != nil {
			_, err := d.db.Exec(
				`UPDATE throttle_events
				 SET resolved_at = CURRENT_TIMESTAMP
				 WHERE id = ?`,
				**activeEvent,
			)
			if err != nil {
				log.Printf("throttle: failed to resolve event %d (%s): %v", **activeEvent, direction, err)
			}
			*activeEvent = nil
		}
	}
}
