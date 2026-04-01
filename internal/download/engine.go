package download

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/time/rate"
)

const (
	readBufSize = 256 << 10 // 256 KB per read chunk
	burstSize   = 1 << 20   // 1 MB burst for the token-bucket limiter
	connTimeout = 30 * time.Second
	retrySleep  = 1 * time.Second
)

// StatsCollector is the interface used by the Engine to report downloaded bytes.
type StatsCollector interface {
	AddDownloadBytes(n int64)
}

// Engine drives parallel HTTP download streams to saturate WAN bandwidth.
type Engine struct {
	serverList   *ServerList
	stats        atomic.Value // holds StatsCollector (may be nil)
	concurrency  int
	rateLimitBps atomic.Int64 // 0 = unlimited
	running      atomic.Bool
	cancel       context.CancelFunc
	wg           sync.WaitGroup
	mu           sync.Mutex // guards concurrency and cancel
}

// New creates a download Engine.
//
// concurrency is the number of parallel download goroutines.
// rateLimitBps is the aggregate rate limit in bytes/sec (0 = unlimited).
func New(serverList *ServerList, concurrency int, rateLimitBps int64) *Engine {
	e := &Engine{
		serverList:  serverList,
		concurrency: concurrency,
	}
	e.rateLimitBps.Store(rateLimitBps)
	return e
}

// SetStatsCollector attaches a stats collector that receives byte counts.
func (e *Engine) SetStatsCollector(collector StatsCollector) {
	e.stats.Store(collector)
}

// Start launches the download goroutines. It is a no-op if the engine is
// already running.
func (e *Engine) Start(ctx context.Context) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.running.Load() {
		return
	}

	ctx, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	e.running.Store(true)

	conc := e.concurrency
	for i := 0; i < conc; i++ {
		e.wg.Add(1)
		go func() {
			defer e.wg.Done()
			e.downloadLoop(ctx, conc)
		}()
	}
}

// Stop cancels all in-flight downloads and waits for every goroutine to exit.
func (e *Engine) Stop() {
	e.mu.Lock()
	cancel := e.cancel
	e.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	e.wg.Wait()
	e.running.Store(false)
}

// IsRunning reports whether the engine is actively downloading.
func (e *Engine) IsRunning() bool {
	return e.running.Load()
}

// SetRateLimit updates the aggregate rate limit in bytes per second.
// Pass 0 for unlimited. The new limit takes effect on the next read cycle
// in each goroutine.
func (e *Engine) SetRateLimit(bps int64) {
	e.rateLimitBps.Store(bps)
}

// SetConcurrency updates the number of download goroutines.
// The change only takes effect on the next call to Start().
func (e *Engine) SetConcurrency(n int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.concurrency = n
}

// httpClient returns an *http.Client tuned for long-running streaming
// downloads: 30 s connection timeout, no overall request timeout.
func httpClient() *http.Client {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: connTimeout,
		}).DialContext,
		TLSHandshakeTimeout: connTimeout,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   0, // no overall timeout -- we stream until EOF or cancel
	}
}

// downloadLoop is the main work function executed by each goroutine.
// It repeatedly picks a server, downloads its payload, and loops.
func (e *Engine) downloadLoop(ctx context.Context, totalWorkers int) {
	client := httpClient()
	buf := make([]byte, readBufSize)

	for {
		if ctx.Err() != nil {
			return
		}

		serverURL := e.serverList.Next()
		if serverURL == "" {
			// No servers configured; wait a bit and retry.
			select {
			case <-ctx.Done():
				return
			case <-time.After(retrySleep):
				continue
			}
		}

		bytesRead, err := e.downloadFrom(ctx, client, serverURL, buf, totalWorkers)
		if err != nil {
			if ctx.Err() != nil {
				return // shutting down, not a server error
			}
			log.Printf("download error from %s: %v", serverURL, err)
			e.serverList.MarkUnhealthy(serverURL, err.Error())
			select {
			case <-ctx.Done():
				return
			case <-time.After(retrySleep):
			}
		} else {
			// Completed successfully (EOF)
			e.serverList.MarkSuccess(serverURL, bytesRead)
		}
	}
}

// downloadFrom performs a single HTTP GET against serverURL, streaming the
// response body through rate limiting and reporting bytes to the stats
// collector.
func (e *Engine) downloadFrom(ctx context.Context, client *http.Client, serverURL string, buf []byte, totalWorkers int) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serverURL, nil)
	if err != nil {
		return 0, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Accept-Encoding", "identity")

	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return 0, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	// Build or rebuild the rate limiter based on the current setting.
	var limiter *rate.Limiter
	lastLimit := e.rateLimitBps.Load()
	if lastLimit > 0 {
		perWorker := float64(lastLimit) / float64(totalWorkers)
		limiter = rate.NewLimiter(rate.Limit(perWorker), burstSize)
	}

	var totalRead int64
	for {
		// Check for rate-limit changes and adjust.
		currentLimit := e.rateLimitBps.Load()
		if currentLimit != lastLimit {
			lastLimit = currentLimit
			if currentLimit > 0 {
				perWorker := float64(currentLimit) / float64(totalWorkers)
				if limiter == nil {
					limiter = rate.NewLimiter(rate.Limit(perWorker), burstSize)
				} else {
					limiter.SetLimit(rate.Limit(perWorker))
				}
			} else {
				limiter = nil
			}
		}

		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			totalRead += int64(n)

			// Rate-limit the throughput.
			if limiter != nil {
				if err := limiter.WaitN(ctx, n); err != nil {
					return totalRead, err
				}
			}

			// Report bytes to the stats collector.
			if v := e.stats.Load(); v != nil {
				if sc, ok := v.(StatsCollector); ok {
					sc.AddDownloadBytes(int64(n))
				}
			}
		}

		if readErr != nil {
			if readErr == io.EOF {
				return totalRead, nil // finished; caller will loop back for a new download
			}
			return totalRead, fmt.Errorf("reading body: %w", readErr)
		}
	}
}
