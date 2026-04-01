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
)

const (
	speedTestBytes   = 10 * 1024 * 1024 // 10 MB per server
	speedTestTimeout = 15 * time.Second
)

// SpeedTestResult holds the result of testing a single server.
type SpeedTestResult struct {
	URL      string `json:"url"`
	Location string `json:"location"`
	SpeedBps int64  `json:"speedBps"`
	Error    string `json:"error,omitempty"`
	OK       bool   `json:"ok"`
}

// SpeedTestProgress is broadcast via WebSocket during a speed test.
type SpeedTestProgress struct {
	Running   bool              `json:"running"`
	Completed int               `json:"completed"`
	Total     int               `json:"total"`
	Results   []SpeedTestResult `json:"results,omitempty"`
}

// ProgressCallback is called as each server test completes.
type ProgressCallback func(SpeedTestProgress)

// RunSpeedTest probes all servers in parallel and reports progress via onProgress.
// It returns the final list of results once all probes have finished.
func (sl *ServerList) RunSpeedTest(ctx context.Context, onProgress ProgressCallback) []SpeedTestResult {
	// Copy the server list under RLock.
	sl.mu.RLock()
	servers := make([]Server, len(sl.servers))
	copy(servers, sl.servers)
	sl.mu.RUnlock()

	total := len(servers)
	if total == 0 {
		return nil
	}

	// Mark all servers as testing.
	sl.mu.Lock()
	for i := range sl.servers {
		sl.servers[i].testing = true
	}
	sl.mu.Unlock()

	defer func() {
		sl.mu.Lock()
		for i := range sl.servers {
			sl.servers[i].testing = false
		}
		sl.mu.Unlock()
	}()

	// Broadcast initial progress.
	if onProgress != nil {
		onProgress(SpeedTestProgress{
			Running: true,
			Total:   total,
		})
	}

	// Semaphore to limit concurrent probes.
	sem := make(chan struct{}, 10)

	var (
		completed atomic.Int32
		resultsMu sync.Mutex
		results   []SpeedTestResult
		wg        sync.WaitGroup
	)

	for _, srv := range servers {
		wg.Add(1)
		go func(s Server) {
			defer wg.Done()

			sem <- struct{}{}        // acquire
			defer func() { <-sem }() // release

			result := probeServer(ctx, s.URL, s.Location)

			if result.OK {
				sl.UpdateSpeedScore(s.URL, result.SpeedBps)
			} else {
				sl.MarkUnhealthy(s.URL, result.Error)
			}

			c := int(completed.Add(1))

			resultsMu.Lock()
			results = append(results, result)
			snapshot := make([]SpeedTestResult, len(results))
			copy(snapshot, results)
			resultsMu.Unlock()

			if onProgress != nil {
				onProgress(SpeedTestProgress{
					Running:   true,
					Completed: c,
					Total:     total,
					Results:   snapshot,
				})
			}
		}(srv)
	}

	wg.Wait()

	// Broadcast final progress.
	resultsMu.Lock()
	finalResults := make([]SpeedTestResult, len(results))
	copy(finalResults, results)
	resultsMu.Unlock()

	if onProgress != nil {
		onProgress(SpeedTestProgress{
			Running:   false,
			Completed: total,
			Total:     total,
			Results:   finalResults,
		})
	}

	return finalResults
}

// probeServer downloads up to speedTestBytes from a single server and measures throughput.
func probeServer(ctx context.Context, url, location string) SpeedTestResult {
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout: 10 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout: 10 * time.Second,
		},
	}

	ctx, cancel := context.WithTimeout(ctx, speedTestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return SpeedTestResult{URL: url, Location: location, Error: err.Error()}
	}
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Range", fmt.Sprintf("bytes=0-%d", speedTestBytes-1))

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return SpeedTestResult{URL: url, Location: location, Error: err.Error()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return SpeedTestResult{
			URL:      url,
			Location: location,
			Error:    fmt.Sprintf("unexpected status %d", resp.StatusCode),
		}
	}

	buf := make([]byte, 64*1024)
	var totalRead int64
	for totalRead < int64(speedTestBytes) {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			totalRead += int64(n)
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return SpeedTestResult{URL: url, Location: location, Error: readErr.Error()}
		}
	}

	elapsed := time.Since(start)

	if elapsed < 100*time.Millisecond || totalRead < 1024 {
		return SpeedTestResult{
			URL:      url,
			Location: location,
			Error:    "insufficient data",
		}
	}

	bps := totalRead * 8 * int64(time.Second) / int64(elapsed)

	log.Printf("speed test: %s → %d Mbps (%.1f MB in %v)", url, bps/1_000_000, float64(totalRead)/(1024*1024), elapsed.Round(time.Millisecond))

	return SpeedTestResult{
		URL:      url,
		Location: location,
		SpeedBps: bps,
		OK:       true,
	}
}
