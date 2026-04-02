# Smart Auto Modes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace manual speed configuration with intelligent auto-modes. One-click Start runs a proper ISP speed test, auto-configures targets/streams/rate limits, and keeps running. Two modes: Reliable (auto-tuned, safe) and Max (no limits).

**Architecture:** New `internal/speedtest/` package implements a proper ISP speed test (multi-stream Cloudflare downloads/uploads with warm-up discard and trimmed mean). Config gets `AutoMode` and speed test result fields. `startEngines` in main.go branches on mode — Reliable pauses, tests, auto-configures; Max starts immediately at max settings. Dashboard gets a mode selector replacing the manual speed inputs.

**Tech Stack:** Go 1.26, React 18, TypeScript, Tailwind CSS, Cloudflare speed test endpoints

---

### Task 1: Create ISP Speed Test Package

**Files:**
- Create: `internal/speedtest/speedtest.go`

**Step 1: Create the ISP speed test module**

This is distinct from `download/speedtest.go` (which probes individual servers with 10MB downloads). This module measures actual ISP capacity using Cloudflare's speed test endpoints with proper methodology.

```go
package speedtest

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

const (
	downloadURL     = "https://speed.cloudflare.com/__down?bytes=100000000" // 100MB
	uploadURL       = "https://speed.cloudflare.com/__up"
	streams         = 8
	warmupDuration  = 3 * time.Second
	testDuration    = 10 * time.Second
	sampleInterval  = 200 * time.Millisecond
	uploadChunkSize = 10 * 1024 * 1024 // 10MB per POST
	trimPercent     = 0.25             // trim top/bottom 25%
)

// Result holds the outcome of an ISP speed test.
type Result struct {
	DownloadMbps float64   `json:"downloadMbps"`
	UploadMbps   float64   `json:"uploadMbps"`
	LatencyMs    float64   `json:"latencyMs"`
	Timestamp    time.Time `json:"timestamp"`
	Streams      int       `json:"streams"`
}

// ProgressCallback reports speed test progress to the UI.
type ProgressCallback func(phase string, pct int)

// RunISPTest measures actual ISP download and upload speeds.
// It uses multiple parallel streams to Cloudflare's speed test endpoints,
// discards warm-up data, and computes a trimmed mean.
// The callback reports progress: "download" (0-100), "upload" (0-100).
func RunISPTest(ctx context.Context, onProgress ProgressCallback) (*Result, error) {
	client := &http.Client{
		Transport: &http.Transport{
			DialContext:         (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
			TLSHandshakeTimeout: 10 * time.Second,
			MaxIdleConnsPerHost: streams * 2,
		},
	}

	result := &Result{
		Timestamp: time.Now(),
		Streams:   streams,
	}

	// Phase 1: Download test
	if onProgress != nil {
		onProgress("download", 0)
	}
	dlMbps, err := measureDownload(ctx, client, onProgress)
	if err != nil {
		return nil, fmt.Errorf("download test: %w", err)
	}
	result.DownloadMbps = dlMbps

	// Phase 2: Upload test
	if onProgress != nil {
		onProgress("upload", 0)
	}
	ulMbps, err := measureUpload(ctx, client, onProgress)
	if err != nil {
		return nil, fmt.Errorf("upload test: %w", err)
	}
	result.UploadMbps = ulMbps

	log.Printf("ISP speed test: download=%.0f Mbps, upload=%.0f Mbps",
		result.DownloadMbps, result.UploadMbps)

	return result, nil
}

// measureDownload runs parallel HTTP GETs to Cloudflare and measures throughput.
func measureDownload(ctx context.Context, client *http.Client, onProgress ProgressCallback) (float64, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var totalBytes atomic.Int64
	var wg sync.WaitGroup

	// Launch parallel download streams
	for i := 0; i < streams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buf := make([]byte, 256*1024)
			for {
				if ctx.Err() != nil {
					return
				}
				req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
				if err != nil {
					return
				}
				req.Header.Set("Accept-Encoding", "identity")
				resp, err := client.Do(req)
				if err != nil {
					return
				}
				for {
					n, err := resp.Body.Read(buf)
					if n > 0 {
						totalBytes.Add(int64(n))
					}
					if err != nil {
						break
					}
				}
				resp.Body.Close()
			}
		}()
	}

	// Collect 200ms samples over warmup + test duration
	samples := collectSamples(ctx, &totalBytes, onProgress, "download")

	cancel() // stop download goroutines
	wg.Wait()

	if len(samples) == 0 {
		return 0, fmt.Errorf("no samples collected")
	}

	return trimmedMeanMbps(samples), nil
}

// measureUpload runs parallel HTTP POSTs to Cloudflare and measures throughput.
func measureUpload(ctx context.Context, client *http.Client, onProgress ProgressCallback) (float64, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var totalBytes atomic.Int64
	var wg sync.WaitGroup

	// Pre-fill a random data buffer (reuse across all uploads)
	randomBuf := make([]byte, uploadChunkSize)
	rand.Read(randomBuf)

	for i := 0; i < streams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				if ctx.Err() != nil {
					return
				}
				// Create a counting reader around the random data
				cr := &countingReader{
					data:  randomBuf,
					total: &totalBytes,
				}
				req, err := http.NewRequestWithContext(ctx, "POST", uploadURL, cr)
				if err != nil {
					return
				}
				req.Header.Set("Content-Type", "application/octet-stream")
				req.ContentLength = int64(uploadChunkSize)
				resp, err := client.Do(req)
				if err != nil {
					return
				}
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
		}()
	}

	samples := collectSamples(ctx, &totalBytes, onProgress, "upload")

	cancel()
	wg.Wait()

	if len(samples) == 0 {
		return 0, fmt.Errorf("no samples collected")
	}

	return trimmedMeanMbps(samples), nil
}

// collectSamples reads the totalBytes counter every sampleInterval,
// discards warm-up samples, and returns measurement-phase samples (bytes per interval).
func collectSamples(ctx context.Context, totalBytes *atomic.Int64, onProgress ProgressCallback, phase string) []float64 {
	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()

	totalDuration := warmupDuration + testDuration
	start := time.Now()
	var lastBytes int64
	var samples []float64
	warmupDone := false

	for {
		select {
		case <-ctx.Done():
			return samples
		case <-ticker.C:
			elapsed := time.Since(start)
			if elapsed >= totalDuration {
				return samples
			}

			currentBytes := totalBytes.Load()
			delta := currentBytes - lastBytes
			lastBytes = currentBytes

			if !warmupDone && elapsed >= warmupDuration {
				warmupDone = true
			}

			if warmupDone {
				samples = append(samples, float64(delta))
			}

			// Report progress
			if onProgress != nil {
				pct := int(elapsed * 100 / totalDuration)
				if pct > 100 {
					pct = 100
				}
				onProgress(phase, pct)
			}
		}
	}
}

// trimmedMeanMbps sorts samples, trims top/bottom 25%, and computes
// mean throughput in Mbps from bytes-per-200ms samples.
func trimmedMeanMbps(samples []float64) float64 {
	sort.Float64s(samples)
	n := len(samples)
	low := int(float64(n) * trimPercent)
	high := n - low
	if low >= high {
		low = 0
		high = n
	}
	trimmed := samples[low:high]

	var sum float64
	for _, s := range trimmed {
		sum += s
	}
	avgBytesPerInterval := sum / float64(len(trimmed))

	// Convert bytes/200ms → bits/second → megabits/second
	bps := avgBytesPerInterval * 8 / sampleInterval.Seconds()
	return bps / 1_000_000
}

// countingReader reads from a pre-filled byte slice and tracks bytes read.
type countingReader struct {
	data   []byte
	offset int
	total  *atomic.Int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	remaining := len(r.data) - r.offset
	if remaining <= 0 {
		return 0, io.EOF
	}
	n := len(p)
	if n > remaining {
		n = remaining
	}
	copy(p, r.data[r.offset:r.offset+n])
	r.offset += n
	r.total.Add(int64(n))
	return n, nil
}
```

**Step 2: Verify build**

```bash
go build ./...
```

**Step 3: Commit**

```bash
git add internal/speedtest/speedtest.go
git commit -m "feat: add ISP speed test module with multi-stream Cloudflare testing"
```

---

### Task 2: Add Auto Mode Config Fields

**Files:**
- Modify: `internal/config/config.go`

**Step 1: Add constants and fields**

Add to the constants block:
```go
AutoModeReliable = "reliable"
AutoModeMax      = "max"
```

Add to the Config struct (after `UploadEndpoints`):
```go
AutoMode                 string  `json:"autoMode"`
MeasuredDownloadMbps     float64 `json:"measuredDownloadMbps"`
MeasuredUploadMbps       float64 `json:"measuredUploadMbps"`
LastSpeedTestTime        string  `json:"lastSpeedTestTime"`
```

**Step 2: Set defaults in New()**

```go
AutoMode: AutoModeReliable,
```

**Step 3: Add load/save**

In `loadFromDB()`:
```go
if v, _ := db.GetSetting(c.DB, "auto_mode"); v != "" {
	c.AutoMode = v
}
if v, _ := db.GetSetting(c.DB, "measured_download_mbps"); v != "" {
	if f, err := strconv.ParseFloat(v, 64); err == nil {
		c.MeasuredDownloadMbps = f
	}
}
if v, _ := db.GetSetting(c.DB, "measured_upload_mbps"); v != "" {
	if f, err := strconv.ParseFloat(v, 64); err == nil {
		c.MeasuredUploadMbps = f
	}
}
if v, _ := db.GetSetting(c.DB, "last_speed_test_time"); v != "" {
	c.LastSpeedTestTime = v
}
```

In `Save()` pairs:
```go
"auto_mode":               c.AutoMode,
"measured_download_mbps":   fmt.Sprintf("%.1f", c.MeasuredDownloadMbps),
"measured_upload_mbps":     fmt.Sprintf("%.1f", c.MeasuredUploadMbps),
"last_speed_test_time":     c.LastSpeedTestTime,
```

Add `"fmt"` to imports if not already present (it's already there via other uses).

**Step 4: Add handler support in HandleUpdateSettings**

In `internal/api/handlers.go`, add to `HandleUpdateSettings`:
```go
if v, ok := updates["autoMode"]; ok {
	cfg.AutoMode = fmt.Sprint(v)
}
```

**Step 5: Verify and commit**

```bash
go build ./...
git add internal/config/config.go internal/api/handlers.go
git commit -m "feat: add autoMode and speed test result fields to config"
```

---

### Task 3: Add ISP Speed Test API Endpoint

**Files:**
- Modify: `internal/api/handlers.go`
- Modify: `internal/api/router.go`
- Modify: `internal/api/websocket.go`

**Step 1: Add callback to App struct**

```go
RunISPSpeedTest func(ctx context.Context) (interface{}, error)
```

**Step 2: Add handler**

```go
func (a *App) HandleISPSpeedTest(w http.ResponseWriter, r *http.Request) {
	if a.RunISPSpeedTest == nil {
		writeError(w, 503, "ISP speed test not available")
		return
	}
	result, err := a.RunISPSpeedTest(r.Context())
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, result)
}
```

**Step 3: Add route**

```go
mux.HandleFunc("POST /api/isp-speed-test", app.HandleISPSpeedTest)
```

**Step 4: Add auto mode and measured speed to WsMessage**

```go
AutoMode             string  `json:"autoMode,omitempty"`
MeasuredDownloadMbps float64 `json:"measuredDownloadMbps,omitempty"`
MeasuredUploadMbps   float64 `json:"measuredUploadMbps,omitempty"`
ISPTestRunning       bool    `json:"ispTestRunning,omitempty"`
ISPTestPhase         string  `json:"ispTestPhase,omitempty"`
ISPTestProgress      int     `json:"ispTestProgress,omitempty"`
```

**Step 5: Add autoMode to HandleStatus response**

In `HandleStatus`, add to the response map:
```go
"autoMode": cfg.AutoMode,
"measuredDownloadMbps": cfg.MeasuredDownloadMbps,
"measuredUploadMbps": cfg.MeasuredUploadMbps,
```

**Step 6: Verify and commit**

```bash
go build ./...
git add internal/api/handlers.go internal/api/router.go internal/api/websocket.go
git commit -m "feat: add ISP speed test endpoint and auto mode WebSocket fields"
```

---

### Task 4: Wire Auto Modes in main.go

**Files:**
- Modify: `cmd/server/main.go`

This is the core task — make `startEngines` mode-aware.

**Step 1: Add ISP speed test state variables**

Near the existing speed test atomics:
```go
var ispTestRunning atomic.Bool
var ispTestPhase atomic.Value    // stores string
var ispTestProgress atomic.Int32
```

Initialize the phase:
```go
ispTestPhase.Store("")
```

**Step 2: Create a helper function for auto-configuring from speed test results**

```go
func autoConfigFromSpeedTest(result *speedtest.Result, cfg *config.Config) (dlMbps, ulMbps, dlStreams, ulStreams int) {
	// Target 90% of measured speed
	dlMbps = int(result.DownloadMbps * 0.9)
	ulMbps = int(result.UploadMbps * 0.9)
	if dlMbps < 10 {
		dlMbps = 10
	}
	if ulMbps < 10 {
		ulMbps = 10
	}

	// Streams: ~1 per 50 Mbps, clamped 4-32
	dlStreams = dlMbps / 50
	if dlStreams < 4 {
		dlStreams = 4
	}
	if dlStreams > 32 {
		dlStreams = 32
	}
	ulStreams = ulMbps / 50
	if ulStreams < 4 {
		ulStreams = 4
	}
	if ulStreams > 32 {
		ulStreams = 32
	}

	// Persist measured speeds
	cfg.MeasuredDownloadMbps = result.DownloadMbps
	cfg.MeasuredUploadMbps = result.UploadMbps
	cfg.LastSpeedTestTime = time.Now().UTC().Format(time.RFC3339)
	cfg.DefaultDownloadMbps = dlMbps
	cfg.DefaultUploadMbps = ulMbps
	cfg.DownloadConcurrency = dlStreams
	cfg.UploadConcurrency = ulStreams
	cfg.Save()

	return
}
```

**Step 3: Update startEngines to handle auto modes**

Wrap the existing `startEngines` logic. Before the current engine start code, add mode handling:

```go
startEngines := func(dlMbps, ulMbps int) error {
	cfgNow := cfg.Get()

	switch cfgNow.AutoMode {
	case config.AutoModeReliable:
		// Run ISP speed test first (pause if already running)
		if running.Load() {
			dlEngine.Stop()
			ulEngine.Stop()
			httpUploadEngine.Stop()
			running.Store(false)
			time.Sleep(2 * time.Second) // TCP drain
		}

		ispTestRunning.Store(true)
		defer ispTestRunning.Store(false)

		result, err := speedtest.RunISPTest(ctx, func(phase string, pct int) {
			ispTestPhase.Store(phase)
			ispTestProgress.Store(int32(pct))
		})
		if err != nil {
			log.Printf("ISP speed test failed: %v — using config defaults", err)
			// Fall through to use existing config values
		} else {
			dlMbps, ulMbps, _, _ = autoConfigFromSpeedTest(result, cfg)
			cfgNow = cfg.Get() // refresh after auto-config
			log.Printf("Auto-configured: %dMbps down, %dMbps up (%d/%d streams)",
				dlMbps, ulMbps, cfgNow.DownloadConcurrency, cfgNow.UploadConcurrency)
		}

	case config.AutoModeMax:
		dlMbps = 0  // 0 = no rate limit
		ulMbps = 0
		cfgNow.DownloadConcurrency = 64
		cfgNow.UploadConcurrency = 32
		// Reset server cooldowns
		serverList.ResetCooldowns()
		log.Println("Max mode: no rate limits, 64 dl / 32 ul streams")
	}

	// ... existing engine start code follows, using dlMbps, ulMbps, cfgNow ...
}
```

The rest of the existing `startEngines` code stays, but uses the (possibly modified) `dlMbps`, `ulMbps`, and `cfgNow` values.

**Step 4: Add `ResetCooldowns` method to ServerList**

In `internal/download/servers.go`, add:
```go
func (sl *ServerList) ResetCooldowns() {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		sl.servers[i].healthy = true
		sl.servers[i].unhealthyUntil = time.Time{}
		sl.servers[i].consecutiveFailures = 0
	}
}
```

Also add the same to `internal/upload/upload_servers.go`:
```go
func (sl *UploadServerList) ResetCooldowns() {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		sl.servers[i].healthy = true
		sl.servers[i].unhealthyUntil = time.Time{}
		sl.servers[i].consecutiveFailures = 0
	}
}
```

**Step 5: Add periodic re-test goroutine**

After the WebSocket broadcast goroutine, add:
```go
// Periodic ISP speed re-test (Reliable mode only, every 6 hours)
go func() {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cfgNow := cfg.Get()
			if cfgNow.AutoMode != config.AutoModeReliable || !running.Load() {
				continue
			}

			log.Println("Periodic ISP speed re-test starting...")

			// Pause engines
			dlEngine.Stop()
			ulEngine.Stop()
			httpUploadEngine.Stop()
			time.Sleep(2 * time.Second)

			ispTestRunning.Store(true)
			result, err := speedtest.RunISPTest(ctx, func(phase string, pct int) {
				ispTestPhase.Store(phase)
				ispTestProgress.Store(int32(pct))
			})
			ispTestRunning.Store(false)

			if err != nil {
				log.Printf("Periodic speed test failed: %v — resuming with current settings", err)
			} else {
				oldDl := cfgNow.DefaultDownloadMbps
				dlMbps, ulMbps, _, _ := autoConfigFromSpeedTest(result, cfg)

				// Only adjust if speed changed >20%
				changePct := float64(abs(dlMbps-oldDl)) / float64(oldDl) * 100
				if changePct > 20 {
					log.Printf("Speed changed %.0f%% — adjusting targets: %dMbps down, %dMbps up", changePct, dlMbps, ulMbps)
				} else {
					log.Printf("Speed stable (%.0f%% change) — keeping current targets", changePct)
				}
			}

			// Resume engines
			cfgNow = cfg.Get()
			startEngines(cfgNow.DefaultDownloadMbps, cfgNow.DefaultUploadMbps)
		}
	}
}()
```

Add a helper:
```go
func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
```

**Step 6: Wire ISP speed test callback and WS fields**

```go
app.RunISPSpeedTest = func(ctx context.Context) (interface{}, error) {
	// Pause engines for accurate measurement
	if running.Load() {
		stopEngines()
		time.Sleep(2 * time.Second)
	}
	ispTestRunning.Store(true)
	defer ispTestRunning.Store(false)
	result, err := speedtest.RunISPTest(ctx, func(phase string, pct int) {
		ispTestPhase.Store(phase)
		ispTestProgress.Store(int32(pct))
	})
	if err != nil {
		return nil, err
	}
	autoConfigFromSpeedTest(result, cfg)
	return result, nil
}
```

Add ISP test fields to WebSocket broadcast:
```go
hub.Broadcast(api.WsMessage{
	// ... existing fields ...
	AutoMode:             cfg.Get().AutoMode,
	MeasuredDownloadMbps: cfg.Get().MeasuredDownloadMbps,
	MeasuredUploadMbps:   cfg.Get().MeasuredUploadMbps,
	ISPTestRunning:       ispTestRunning.Load(),
	ISPTestPhase:         ispTestPhase.Load().(string),
	ISPTestProgress:      int(ispTestProgress.Load()),
})
```

**Step 7: Verify and commit**

```bash
go build ./...
git add cmd/server/main.go internal/speedtest/speedtest.go internal/download/servers.go internal/upload/upload_servers.go internal/api/handlers.go internal/api/router.go internal/api/websocket.go internal/config/config.go
git commit -m "feat: wire auto modes — reliable with ISP speed test, max with no limits"
```

---

### Task 5: Update Frontend Types

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/hooks/useWebSocket.ts`

**Step 1: Update Status interface**

Add to `Status`:
```typescript
autoMode: string
measuredDownloadMbps: number
measuredUploadMbps: number
```

**Step 2: Add ISPSpeedTestResult type**

```typescript
export interface ISPSpeedTestResult {
  downloadMbps: number
  uploadMbps: number
  latencyMs: number
  timestamp: string
  streams: number
}
```

**Step 3: Add API method**

```typescript
runISPSpeedTest: () => request<ISPSpeedTestResult>('/api/isp-speed-test', { method: 'POST' }),
```

**Step 4: Update WsStats**

Add to interface and EMPTY:
```typescript
autoMode: string           // "" default
measuredDownloadMbps: number  // 0 default
measuredUploadMbps: number    // 0 default
ispTestRunning: boolean       // false default
ispTestPhase: string          // "" default
ispTestProgress: number       // 0 default
```

**Step 5: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/api/client.ts frontend/src/hooks/useWebSocket.ts
git commit -m "feat: add auto mode and ISP speed test types to frontend"
```

---

### Task 6: Overhaul Dashboard with Mode Selector

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx`

**Step 1: Replace the start/stop section with mode-aware UI**

The new Dashboard should have:

1. **Mode selector** — two cards side by side: "Reliable" and "Max"
   - Reliable card: "Auto-tuned for sustained, safe throughput. Runs a speed test to configure optimally."
   - Max card: "No limits. Maximum streams, no rate limiting. May trigger rate limits on some servers."
   - Selected card has blue border, unselected has gray

2. **Start/Stop button** — same as before but bigger, centered under mode cards

3. **ISP speed test progress** — shown during Reliable mode start:
   - "Measuring your connection speed..." with phase indicator (Download/Upload) and progress bar
   - After test: "Auto-configured: 940 Mbps down / 480 Mbps up"

4. **Speed cards** — same as before but with additional info line:
   - Reliable: "Target: 940 Mbps (90% of 1044 Mbps measured)"
   - Max: "No limit"

5. **Advanced section** — collapsed by default, contains manual speed target inputs for override

The mode selector saves to config via `api.updateSettings({ autoMode: 'reliable' })` on change.

When Start is clicked in Reliable mode and no previous speed test exists (`measuredDownloadMbps === 0`), the start call triggers the speed test automatically (backend handles this).

**Step 2: Verify and commit**

```bash
cd frontend && npx tsc --noEmit && npm run build
git add frontend/src/components/Dashboard.tsx
git commit -m "feat: overhaul Dashboard with auto mode selector and ISP speed test UI"
```

---

### Task 7: Build, Verify, Final Integration

**Step 1: Full build chain**

```bash
cd frontend && npm run build && cd ..
cp -r frontend/dist cmd/server/frontend/dist
go build -o /tmp/wansaturator-test ./cmd/server
```

**Step 2: Smoke test**

```bash
DATA_DIR=/tmp/floodtest-test /tmp/wansaturator-test &
sleep 2
curl -s http://localhost:7860/api/status | python3 -m json.tool | grep autoMode
curl -s http://localhost:7860/api/settings | python3 -m json.tool | grep -E "autoMode|measured"
kill %1
rm -rf /tmp/floodtest-test
```

**Step 3: Fix any issues and commit**

```bash
git add -A
git commit -m "feat: smart auto modes with ISP speed testing"
```
