# Smart Server Pool + Speed Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the download server pool to ~45 servers, add per-server speed scoring with weighted stream assignment, implement a startup/on-demand speed test, reduce cooldown timers, and build a rich UI showing all of this in real-time.

**Architecture:** Extend the existing `download` package with speed scoring on `Server` structs, a new `speedtest.go` file for parallel probing, and weighted server selection replacing round-robin. The API gains a `POST /api/speed-test` endpoint and the WebSocket gets speed-test progress fields. The frontend `ServerHealth` component gets a full overhaul with a summary bar, speed test button, and enhanced table.

**Tech Stack:** Go 1.26, React 18, TypeScript, Tailwind CSS, WebSocket (nhooyr.io/websocket)

---

### Task 1: Expand Server List and Add Location Metadata

**Files:**
- Modify: `internal/download/servers.go:1-68`

**Step 1: Update the Server struct and ServerHealth struct to include location and speed score**

In `internal/download/servers.go`, update the `Server` struct to add `Location`, `SpeedScore` (rolling average bps), `SpeedSamples` (last 5 measurements), and `ActiveStreams` fields. Update `ServerHealth` to export these for the API.

```go
// ServerHealth contains the current health status of a download server,
// exported for API consumption.
type ServerHealth struct {
	URL                 string    `json:"url"`
	Location            string    `json:"location"`
	Healthy             bool      `json:"healthy"`
	ConsecutiveFailures int       `json:"consecutiveFailures"`
	TotalFailures       int       `json:"totalFailures"`
	TotalDownloads      int       `json:"totalDownloads"`
	LastError           string    `json:"lastError,omitempty"`
	LastErrorTime       time.Time `json:"lastErrorTime,omitempty"`
	UnhealthyUntil      time.Time `json:"unhealthyUntil,omitempty"`
	BytesDownloaded     int64     `json:"bytesDownloaded"`
	SpeedBps            int64     `json:"speedBps"`
	ActiveStreams       int       `json:"activeStreams"`
	Status              string    `json:"status"` // "healthy", "cooldown", "testing", "failed"
}

// Server represents a single download endpoint with health tracking.
type Server struct {
	URL                 string
	Location            string
	healthy             bool
	unhealthyUntil      time.Time
	consecutiveFailures int
	totalFailures       int
	totalDownloads      int
	lastError           string
	lastErrorTime       time.Time
	bytesDownloaded     int64
	speedScore          int64   // rolling average speed in bps
	speedSamples        []int64 // last 5 speed measurements
	activeStreams       int32   // current streams on this server
	testing             bool    // true during speed test
}
```

**Step 2: Replace DefaultServers with a struct-based list including locations**

Replace the `DefaultServers` string slice with a `DefaultServerEntries` slice of `{URL, Location}` structs. Expand to ~45 servers, prioritizing US-accessible large-file endpoints:

```go
// ServerEntry defines a download server with its location tag.
type ServerEntry struct {
	URL      string
	Location string
}

// DefaultServerEntries is the built-in list of speed-test file URLs.
var DefaultServerEntries = []ServerEntry{
	// --- Hetzner — 10GB files ---
	{"http://ash-speed.hetzner.com/10GB.bin", "US-East"},
	{"http://speed.hetzner.de/10GB.bin", "EU-Germany"},
	{"http://fsn1-speed.hetzner.com/10GB.bin", "EU-Germany"},
	{"http://nbg1-speed.hetzner.com/10GB.bin", "EU-Germany"},
	{"http://hel1-speed.hetzner.com/10GB.bin", "EU-Finland"},

	// --- OVH — 10GB files ---
	{"http://proof.ovh.net/files/10Gb.dat", "EU-France"},
	{"http://rbx-proof.ovh.net/files/10Gb.dat", "EU-France"},
	{"http://gra-proof.ovh.net/files/10Gb.dat", "EU-France"},

	// --- Leaseweb — 10GB files ---
	{"http://mirror.leaseweb.com/speedtest/10000mb.bin", "EU-Netherlands"},
	{"http://mirror.us.leaseweb.net/speedtest/10000mb.bin", "US-East"},
	{"http://mirror.wdc1.us.leaseweb.net/speedtest/10000mb.bin", "US-East"},
	{"http://mirror.sfo12.us.leaseweb.net/speedtest/10000mb.bin", "US-West"},
	{"http://mirror.dal10.us.leaseweb.net/speedtest/10000mb.bin", "US-Central"},

	// --- Scaleway — 10GB files ---
	{"http://ping.online.net/10000Mo.dat", "EU-France"},
	{"http://scaleway.testdebit.info/10G.iso", "EU-France"},

	// --- European Providers — large files ---
	{"http://speedtest.belwue.net/10G", "EU-Germany"},
	{"http://speedtest.tele2.net/10GB.zip", "EU-Sweden"},
	{"http://speedtest.serverius.net/files/10000mb.bin", "EU-Netherlands"},

	// --- Vultr Looking Glass — 1GB files ---
	{"http://lax-ca-us-ping.vultr.com/vultr.com.1000MB.bin", "US-West"},
	{"http://nj-us-ping.vultr.com/vultr.com.1000MB.bin", "US-East"},
	{"http://il-us-ping.vultr.com/vultr.com.1000MB.bin", "US-Central"},
	{"http://tx-us-ping.vultr.com/vultr.com.1000MB.bin", "US-Central"},
	{"http://ga-us-ping.vultr.com/vultr.com.1000MB.bin", "US-East"},
	{"http://sea-wa-us-ping.vultr.com/vultr.com.1000MB.bin", "US-West"},
	{"http://ams-nl-ping.vultr.com/vultr.com.1000MB.bin", "EU-Netherlands"},
	{"http://fra-de-ping.vultr.com/vultr.com.1000MB.bin", "EU-Germany"},
	{"http://par-fr-ping.vultr.com/vultr.com.1000MB.bin", "EU-France"},

	// --- DigitalOcean — large test files ---
	{"http://speedtest-nyc1.digitalocean.com/10mb.test", "US-East"},
	{"http://speedtest-sfo1.digitalocean.com/10mb.test", "US-West"},

	// --- Linode/Akamai — large test files ---
	{"http://speedtest.newark.linode.com/100MB-newark.bin", "US-East"},
	{"http://speedtest.atlanta.linode.com/100MB-atlanta.bin", "US-East"},
	{"http://speedtest.dallas.linode.com/100MB-dallas.bin", "US-Central"},
	{"http://speedtest.fremont.linode.com/100MB-fremont.bin", "US-West"},
	{"http://speedtest.chicago.linode.com/100MB-chicago.bin", "US-Central"},

	// --- ThinkBroadband — 1GB ---
	{"http://ipv4.download.thinkbroadband.com/1GB.zip", "EU-UK"},

	// --- Clouvider — 10GB ---
	{"http://lon.speedtest.clouvider.net/10000mb.bin", "EU-UK"},
	{"http://nyc.speedtest.clouvider.net/10000mb.bin", "US-East"},
	{"http://dal.speedtest.clouvider.net/10000mb.bin", "US-Central"},
	{"http://la.speedtest.clouvider.net/10000mb.bin", "US-West"},

	// --- Fdcservers — 10GB ---
	{"http://lg.chi.fdcservers.net/10GBtest.zip", "US-Central"},
	{"http://lg.den.fdcservers.net/10GBtest.zip", "US-Central"},
	{"http://lg.atl.fdcservers.net/10GBtest.zip", "US-East"},

	// --- WorldStream — 10GB ---
	{"http://speedtest.worldstream.nl/10000mb.bin", "EU-Netherlands"},
}
```

Note: Some of these URLs should be verified before finalizing. The implementer should test each URL and remove any that return errors. The important thing is the structure.

Keep a `DefaultServers` variable for backward compatibility with the config system (which stores a `[]string`):

```go
// DefaultServers returns just the URLs for backward compatibility with config.
var DefaultServers = func() []string {
	urls := make([]string, len(DefaultServerEntries))
	for i, e := range DefaultServerEntries {
		urls[i] = e.URL
	}
	return urls
}()
```

**Step 3: Update NewServerList to accept location metadata**

```go
// NewServerList creates a ServerList from the given URLs.
// Locations are resolved from DefaultServerEntries if available.
func NewServerList(urls []string) *ServerList {
	// Build a lookup from defaults
	locMap := make(map[string]string)
	for _, e := range DefaultServerEntries {
		locMap[e.URL] = e.Location
	}

	servers := make([]Server, len(urls))
	for i, u := range urls {
		servers[i] = Server{URL: u, Location: locMap[u], healthy: true}
	}
	return &ServerList{servers: servers}
}
```

**Step 4: Update HealthStatus to include new fields**

Update the `HealthStatus()` method to populate `SpeedBps`, `ActiveStreams`, `Location`, and `Status` fields.

**Step 5: Commit**

```bash
git add internal/download/servers.go
git commit -m "feat: expand server list to ~45 servers with location metadata and speed scoring fields"
```

---

### Task 2: Reduce Cooldown Timers

**Files:**
- Modify: `internal/download/servers.go:8,141-166`

**Step 1: Update cooldown constants and backoff logic**

Change `unhealthyCooldown` from 5 minutes to 30 seconds. Update the backoff cap from 30 minutes to 10 minutes.

```go
const (
	unhealthyCooldown    = 30 * time.Second       // was 5 * time.Minute
	maxCooldown          = 10 * time.Minute        // was 30 * time.Minute
)
```

Update `MarkUnhealthy`:
```go
func (sl *ServerList) MarkUnhealthy(url string, errMsg string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].URL == url {
			s := &sl.servers[i]
			s.healthy = false
			s.consecutiveFailures++
			s.totalFailures++
			s.lastError = errMsg
			s.lastErrorTime = time.Now()

			// Exponential backoff: 30s * 2^(failures-1), capped at 10min
			cooldown := unhealthyCooldown
			for j := 1; j < s.consecutiveFailures && cooldown < maxCooldown; j++ {
				cooldown *= 2
			}
			if cooldown > maxCooldown {
				cooldown = maxCooldown
			}
			s.unhealthyUntil = time.Now().Add(cooldown)
			return
		}
	}
}
```

**Step 2: Commit**

```bash
git add internal/download/servers.go
git commit -m "feat: reduce cooldown timers — 30s initial, 10min cap (was 5min/30min)"
```

---

### Task 3: Implement Weighted Server Selection

**Files:**
- Modify: `internal/download/servers.go`

**Step 1: Add speed score tracking methods**

Add `UpdateSpeedScore(url string, bps int64)` method that maintains a rolling window of 5 samples per server:

```go
// UpdateSpeedScore records a throughput measurement for a server.
// Maintains a rolling window of the last 5 samples.
func (sl *ServerList) UpdateSpeedScore(url string, bps int64) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].URL == url {
			s := &sl.servers[i]
			s.speedSamples = append(s.speedSamples, bps)
			if len(s.speedSamples) > 5 {
				s.speedSamples = s.speedSamples[len(s.speedSamples)-5:]
			}
			var total int64
			for _, v := range s.speedSamples {
				total += v
			}
			s.speedScore = total / int64(len(s.speedSamples))
			return
		}
	}
}
```

**Step 2: Add active stream tracking**

Add `IncrementStreams(url)` and `DecrementStreams(url)` methods:

```go
func (sl *ServerList) IncrementStreams(url string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		if sl.servers[i].URL == url {
			sl.servers[i].activeStreams++
			return
		}
	}
}

func (sl *ServerList) DecrementStreams(url string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		if sl.servers[i].URL == url {
			if sl.servers[i].activeStreams > 0 {
				sl.servers[i].activeStreams--
			}
			return
		}
	}
}
```

**Step 3: Replace round-robin Next() with weighted selection**

Replace `Next()` to prefer servers with higher speed scores but still distribute load. Algorithm:
- Collect all healthy servers
- If any have speed scores, weight selection by score (server with 500Mbps score gets 5x chance vs 100Mbps)
- If none have scores yet (pre-speed-test), fall back to round-robin
- Among equally-scored servers, prefer those with fewer active streams

```go
func (sl *ServerList) Next() string {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	if len(sl.servers) == 0 {
		return ""
	}

	now := time.Now()

	// Promote any servers whose cooldown has expired.
	for i := range sl.servers {
		s := &sl.servers[i]
		if !s.healthy && now.After(s.unhealthyUntil) {
			s.healthy = true
			s.unhealthyUntil = time.Time{}
			s.consecutiveFailures = 0
		}
	}

	// Collect healthy servers.
	type candidate struct {
		idx   int
		score int64
	}
	var candidates []candidate
	var hasScores bool
	for i := range sl.servers {
		s := &sl.servers[i]
		if s.healthy && !s.testing {
			score := s.speedScore
			if score > 0 {
				hasScores = true
			}
			candidates = append(candidates, candidate{i, score})
		}
	}

	if len(candidates) == 0 {
		// All unhealthy — pick soonest recovery.
		var best *Server
		for i := range sl.servers {
			s := &sl.servers[i]
			if best == nil || s.unhealthyUntil.Before(best.unhealthyUntil) {
				best = s
			}
		}
		sl.index = (sl.index + 1) % len(sl.servers)
		return best.URL
	}

	if !hasScores {
		// No speed data yet — round-robin among healthy.
		start := sl.index
		for i := 0; i < len(sl.servers); i++ {
			idx := (start + i) % len(sl.servers)
			s := &sl.servers[idx]
			if s.healthy && !s.testing {
				sl.index = (idx + 1) % len(sl.servers)
				return s.URL
			}
		}
	}

	// Weighted selection: pick the server with the best score-to-streams ratio.
	// This naturally distributes streams proportionally to speed.
	bestIdx := candidates[0].idx
	bestRatio := float64(0)
	for _, c := range candidates {
		score := c.score
		if score <= 0 {
			score = 1 // minimal weight for unscored servers
		}
		streams := sl.servers[c.idx].activeStreams
		ratio := float64(score) / float64(streams+1)
		if ratio > bestRatio {
			bestRatio = ratio
			bestIdx = c.idx
		}
	}

	return sl.servers[bestIdx].URL
}
```

**Step 4: Commit**

```bash
git add internal/download/servers.go
git commit -m "feat: weighted server selection based on speed scores and active stream count"
```

---

### Task 4: Wire Stream Tracking into Download Engine

**Files:**
- Modify: `internal/download/engine.go:170-209`

**Step 1: Update downloadLoop to track active streams per server**

In `downloadLoop`, call `IncrementStreams` before downloading and `DecrementStreams` after. Also call `UpdateSpeedScore` on successful downloads:

```go
func (e *Engine) downloadLoop(ctx context.Context, totalWorkers int) {
	client := httpClient()
	buf := make([]byte, readBufSize)

	for {
		if ctx.Err() != nil {
			return
		}

		serverURL := e.serverList.Next()
		if serverURL == "" {
			select {
			case <-ctx.Done():
				return
			case <-time.After(retrySleep):
				continue
			}
		}

		e.serverList.IncrementStreams(serverURL)
		start := time.Now()
		bytesRead, err := e.downloadFrom(ctx, client, serverURL, buf, totalWorkers)
		elapsed := time.Since(start)
		e.serverList.DecrementStreams(serverURL)

		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("download error from %s: %v", serverURL, err)
			e.serverList.MarkUnhealthy(serverURL, err.Error())
			select {
			case <-ctx.Done():
				return
			case <-time.After(retrySleep):
			}
		} else {
			e.serverList.MarkSuccess(serverURL)
			// Update speed score (bytes/sec * 8 = bits/sec)
			if elapsed > time.Second {
				bps := bytesRead * 8 / int64(elapsed.Seconds())
				e.serverList.UpdateSpeedScore(serverURL, bps)
			}
		}
	}
}
```

**Step 2: Commit**

```bash
git add internal/download/engine.go
git commit -m "feat: track per-server active streams and update speed scores after downloads"
```

---

### Task 5: Implement Speed Test

**Files:**
- Create: `internal/download/speedtest.go`

**Step 1: Create the speed test module**

```go
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

// RunSpeedTest probes all servers in parallel and returns results.
// The callback is invoked after each server completes for real-time UI updates.
func (sl *ServerList) RunSpeedTest(ctx context.Context, onProgress ProgressCallback) []SpeedTestResult {
	sl.mu.RLock()
	servers := make([]Server, len(sl.servers))
	copy(servers, sl.servers)
	sl.mu.RUnlock()

	total := len(servers)
	results := make([]SpeedTestResult, total)
	var completed atomic.Int32
	var mu sync.Mutex

	// Mark all servers as testing
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

	// Broadcast initial state
	if onProgress != nil {
		onProgress(SpeedTestProgress{Running: true, Total: total})
	}

	// Run all probes in parallel with a semaphore to limit concurrency
	sem := make(chan struct{}, 10) // max 10 concurrent probes
	var wg sync.WaitGroup

	for i, s := range servers {
		wg.Add(1)
		go func(idx int, srv Server) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result := probeServer(ctx, srv.URL, srv.Location)
			results[idx] = result

			if result.OK {
				sl.UpdateSpeedScore(srv.URL, result.SpeedBps)
			} else {
				sl.MarkUnhealthy(srv.URL, result.Error)
			}

			done := int(completed.Add(1))

			if onProgress != nil {
				mu.Lock()
				// Collect completed results so far
				var completedResults []SpeedTestResult
				for j := 0; j < total; j++ {
					if results[j].URL != "" {
						completedResults = append(completedResults, results[j])
					}
				}
				mu.Unlock()
				onProgress(SpeedTestProgress{
					Running:   true,
					Completed: done,
					Total:     total,
					Results:   completedResults,
				})
			}
		}(i, s)
	}

	wg.Wait()

	// Final broadcast
	if onProgress != nil {
		onProgress(SpeedTestProgress{
			Running:   false,
			Completed: total,
			Total:     total,
			Results:   results,
		})
	}

	return results
}

// probeServer downloads up to speedTestBytes from a single server and measures throughput.
func probeServer(ctx context.Context, url, location string) SpeedTestResult {
	ctx, cancel := context.WithTimeout(ctx, speedTestTimeout)
	defer cancel()

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
			TLSHandshakeTimeout: 10 * time.Second,
		},
		Timeout: 0,
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return SpeedTestResult{URL: url, Location: location, Error: err.Error()}
	}
	req.Header.Set("Accept-Encoding", "identity")
	// Request only 10MB via Range header if server supports it
	req.Header.Set("Range", fmt.Sprintf("bytes=0-%d", speedTestBytes-1))

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return SpeedTestResult{URL: url, Location: location, Error: err.Error()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return SpeedTestResult{URL: url, Location: location, Error: fmt.Sprintf("status %d", resp.StatusCode)}
	}

	buf := make([]byte, 64*1024)
	var totalRead int64
	for totalRead < speedTestBytes {
		n, readErr := resp.Body.Read(buf)
		totalRead += int64(n)
		if readErr != nil {
			break
		}
	}

	elapsed := time.Since(start)
	if elapsed < 100*time.Millisecond || totalRead < 1024 {
		return SpeedTestResult{URL: url, Location: location, Error: "insufficient data"}
	}

	bps := totalRead * 8 * int64(time.Second) / int64(elapsed)

	log.Printf("speed test: %s → %d Mbps (%.1f MB in %s)", url, bps/1_000_000, float64(totalRead)/1e6, elapsed.Round(time.Millisecond))

	return SpeedTestResult{
		URL:      url,
		Location: location,
		SpeedBps: bps,
		OK:       true,
	}
}
```

**Step 2: Commit**

```bash
git add internal/download/speedtest.go
git commit -m "feat: add parallel speed test with per-server probing and progress callbacks"
```

---

### Task 6: Add Speed Test API Endpoint and WebSocket Updates

**Files:**
- Modify: `internal/api/app.go:17-41`
- Modify: `internal/api/handlers.go`
- Modify: `internal/api/router.go:29`
- Modify: `internal/api/websocket.go:14-25`

**Step 1: Add speed test callback to App struct**

In `internal/api/app.go`, add to the `App` struct:

```go
RunSpeedTest func(ctx context.Context) interface{}
```

**Step 2: Add speed test handler**

In `internal/api/handlers.go`, add:

```go
func (a *App) HandleSpeedTest(w http.ResponseWriter, r *http.Request) {
	if a.RunSpeedTest == nil {
		writeError(w, 503, "speed test not available")
		return
	}
	results := a.RunSpeedTest(r.Context())
	writeJSON(w, results)
}
```

**Step 3: Add route**

In `internal/api/router.go`, add after the server-health line:

```go
mux.HandleFunc("POST /api/speed-test", app.HandleSpeedTest)
```

**Step 4: Add speed test progress fields to WsMessage**

In `internal/api/websocket.go`, add to `WsMessage`:

```go
type WsMessage struct {
	// ... existing fields ...
	SpeedTestRunning   bool  `json:"speedTestRunning,omitempty"`
	SpeedTestCompleted int   `json:"speedTestCompleted,omitempty"`
	SpeedTestTotal     int   `json:"speedTestTotal,omitempty"`
}
```

**Step 5: Commit**

```bash
git add internal/api/app.go internal/api/handlers.go internal/api/router.go internal/api/websocket.go
git commit -m "feat: add POST /api/speed-test endpoint and WebSocket progress fields"
```

---

### Task 7: Wire Speed Test in main.go and Add WebSocket Broadcasting

**Files:**
- Modify: `cmd/server/main.go`

**Step 1: Add speed test state tracking and wire the callback**

Add atomic variables to track speed test progress for WebSocket broadcasting. Wire the `RunSpeedTest` callback on the App struct:

```go
// Speed test state for WebSocket broadcasting
var speedTestRunning atomic.Bool
var speedTestCompleted atomic.Int32
var speedTestTotal atomic.Int32
```

Wire in the app setup (after `GetServerHealth`):

```go
app.RunSpeedTest = func(ctx context.Context) interface{} {
	return serverList.RunSpeedTest(ctx, func(p download.SpeedTestProgress) {
		speedTestRunning.Store(p.Running)
		speedTestCompleted.Store(int32(p.Completed))
		speedTestTotal.Store(int32(p.Total))
	})
}
```

**Step 2: Add speed test fields to WebSocket broadcast**

In the broadcast goroutine, add the speed test fields:

```go
hub.Broadcast(api.WsMessage{
	// ... existing fields ...
	SpeedTestRunning:   speedTestRunning.Load(),
	SpeedTestCompleted: int(speedTestCompleted.Load()),
	SpeedTestTotal:     int(speedTestTotal.Load()),
})
```

**Step 3: Commit**

```bash
git add cmd/server/main.go
git commit -m "feat: wire speed test into main.go with WebSocket progress broadcasting"
```

---

### Task 8: Update Frontend API Client and WebSocket Types

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/hooks/useWebSocket.ts`

**Step 1: Update ServerHealth interface and add SpeedTestResult type**

In `frontend/src/api/client.ts`, update:

```typescript
export interface ServerHealth {
  url: string
  location: string
  healthy: boolean
  consecutiveFailures: number
  totalFailures: number
  totalDownloads: number
  lastError?: string
  lastErrorTime?: string
  unhealthyUntil?: string
  bytesDownloaded: number
  speedBps: number
  activeStreams: number
  status: string // "healthy" | "cooldown" | "testing" | "failed"
}

export interface SpeedTestResult {
  url: string
  location: string
  speedBps: number
  error?: string
  ok: boolean
}
```

Add speed test API method:

```typescript
runSpeedTest: () => request<SpeedTestResult[]>('/api/speed-test', { method: 'POST' }),
```

**Step 2: Update WsStats interface**

In `frontend/src/hooks/useWebSocket.ts`, add to `WsStats`:

```typescript
speedTestRunning: boolean
speedTestCompleted: number
speedTestTotal: number
```

Add defaults in `EMPTY`:

```typescript
speedTestRunning: false,
speedTestCompleted: 0,
speedTestTotal: 0,
```

**Step 3: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/hooks/useWebSocket.ts
git commit -m "feat: update frontend types for speed scoring and speed test progress"
```

---

### Task 9: Overhaul ServerHealth UI Component

**Files:**
- Modify: `frontend/src/components/ServerHealth.tsx`

**Step 1: Complete rewrite of ServerHealth component**

Replace the entire component with a new version that includes:

1. **Summary bar** at top: Total/Healthy/Cooldown/Failed counts, aggregate throughput, "Run Speed Test" button with last-run timestamp
2. **Speed test progress** indicator: "Testing servers... 23/47 complete" with progress bar (shown only during test)
3. **Enhanced table**: Columns for Server (hostname), Location, Status (color-coded badge), Speed Score (Mbps with inline bar), Active Streams, Data Downloaded, Last Error
4. **Sortable columns**: Click column headers to sort
5. **Color coding**: Green rows for healthy+fast, yellow for healthy+slow, orange for cooldown, red for failed

The component should:
- Poll `/api/server-health` every 5 seconds (faster than current 10s)
- Read speed test progress from WebSocket stats (passed as prop)
- Call `api.runSpeedTest()` on button click
- Show a progress bar during speed test

Full implementation:

```tsx
import { useState, useEffect, useMemo } from 'react'
import { api, ServerHealth as ServerHealthData, SpeedTestResult } from '../api/client'

interface Props {
  speedTestRunning?: boolean
  speedTestCompleted?: number
  speedTestTotal?: number
}

type SortKey = 'url' | 'location' | 'status' | 'speedBps' | 'activeStreams' | 'bytesDownloaded'
type SortDir = 'asc' | 'desc'

function formatUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return '—'
  const mbps = bps / 1_000_000
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`
  return `${mbps.toFixed(0)} Mbps`
}

function timeUntil(isoString: string): string {
  const target = new Date(isoString).getTime()
  const now = Date.now()
  const diffMs = target - now
  if (diffMs <= 0) return ''
  const totalSeconds = Math.ceil(diffMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function statusColor(status: string): string {
  switch (status) {
    case 'healthy': return 'bg-green-900/50 text-green-400 border-green-800'
    case 'testing': return 'bg-blue-900/50 text-blue-400 border-blue-800'
    case 'cooldown': return 'bg-yellow-900/50 text-yellow-400 border-yellow-800'
    default: return 'bg-red-900/50 text-red-400 border-red-800'
  }
}

function rowBg(server: ServerHealthData): string {
  if (server.status === 'failed') return 'bg-red-950/20'
  if (server.status === 'cooldown') return 'bg-yellow-950/10'
  if (server.status === 'testing') return 'bg-blue-950/10'
  if (server.speedBps > 0 && server.speedBps < 100_000_000) return 'bg-yellow-950/10' // < 100Mbps = slow
  return ''
}

export default function ServerHealth({ speedTestRunning, speedTestCompleted, speedTestTotal }: Props) {
  const [servers, setServers] = useState<ServerHealthData[]>([])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('speedBps')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [lastTestTime, setLastTestTime] = useState<string | null>(null)

  useEffect(() => {
    const fetchHealth = () => {
      api.getServerHealth().then((data) => {
        setServers(data)
        setLoading(false)
      }).catch(() => setLoading(false))
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleSpeedTest = async () => {
    setTesting(true)
    try {
      await api.runSpeedTest()
      setLastTestTime(new Date().toLocaleTimeString())
    } catch (err) {
      console.error('Speed test failed:', err)
    } finally {
      setTesting(false)
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    return [...servers].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'url': cmp = a.url.localeCompare(b.url); break
        case 'location': cmp = (a.location || '').localeCompare(b.location || ''); break
        case 'status': cmp = (a.status || '').localeCompare(b.status || ''); break
        case 'speedBps': cmp = a.speedBps - b.speedBps; break
        case 'activeStreams': cmp = a.activeStreams - b.activeStreams; break
        case 'bytesDownloaded': cmp = a.bytesDownloaded - b.bytesDownloaded; break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [servers, sortKey, sortDir])

  const healthyCount = servers.filter(s => s.status === 'healthy').length
  const cooldownCount = servers.filter(s => s.status === 'cooldown').length
  const failedCount = servers.filter(s => s.status === 'failed').length
  const testingCount = servers.filter(s => s.status === 'testing').length
  const totalCount = servers.length
  const maxSpeed = Math.max(...servers.map(s => s.speedBps), 1)

  const isRunningTest = testing || speedTestRunning

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="text-sm text-gray-500">Loading server health...</div>
      </div>
    )
  }

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-200 select-none"
      onClick={() => handleSort(field)}
    >
      {label} {sortKey === field ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
    </th>
  )

  return (
    <div>
      {/* Summary bar */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-gray-400">Total: </span>
              <span className="text-white font-medium">{totalCount}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-400">Healthy: </span>
              <span className="text-green-400 font-medium">{healthyCount}</span>
            </div>
            {cooldownCount > 0 && (
              <div className="text-sm">
                <span className="text-gray-400">Cooldown: </span>
                <span className="text-yellow-400 font-medium">{cooldownCount}</span>
              </div>
            )}
            {failedCount > 0 && (
              <div className="text-sm">
                <span className="text-gray-400">Failed: </span>
                <span className="text-red-400 font-medium">{failedCount}</span>
              </div>
            )}
            {testingCount > 0 && (
              <div className="text-sm">
                <span className="text-gray-400">Testing: </span>
                <span className="text-blue-400 font-medium">{testingCount}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {lastTestTime && (
              <span className="text-xs text-gray-500">Last test: {lastTestTime}</span>
            )}
            <button
              onClick={handleSpeedTest}
              disabled={isRunningTest}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunningTest ? 'Testing...' : 'Run Speed Test'}
            </button>
          </div>
        </div>
      </div>

      {/* Speed test progress bar */}
      {isRunningTest && speedTestTotal && speedTestTotal > 0 && (
        <div className="bg-gray-900 rounded-xl border border-blue-800 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-blue-400">
              Testing servers... {speedTestCompleted || 0}/{speedTestTotal} complete
            </span>
            <span className="text-xs text-gray-500">
              {Math.round(((speedTestCompleted || 0) / speedTestTotal) * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${((speedTestCompleted || 0) / speedTestTotal) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Server table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-800/50">
              <tr>
                <SortHeader label="Server" field="url" />
                <SortHeader label="Location" field="location" />
                <SortHeader label="Status" field="status" />
                <SortHeader label="Speed" field="speedBps" />
                <SortHeader label="Streams" field="activeStreams" />
                <SortHeader label="Downloaded" field="bytesDownloaded" />
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {sorted.map((server) => (
                <tr key={server.url} className={`${rowBg(server)} hover:bg-gray-800/30`}>
                  <td className="px-3 py-2 text-sm text-white font-mono">
                    {formatUrl(server.url)}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-400">
                    {server.location || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(server.status)}`}>
                      {server.status}
                    </span>
                    {server.status === 'cooldown' && server.unhealthyUntil && (
                      <span className="ml-1 text-xs text-yellow-400">
                        {timeUntil(server.unhealthyUntil)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-300 w-20 text-right">
                        {formatSpeed(server.speedBps)}
                      </span>
                      {server.speedBps > 0 && (
                        <div className="w-24 bg-gray-800 rounded-full h-1.5">
                          <div
                            className="bg-green-500 h-1.5 rounded-full"
                            style={{ width: `${Math.min(100, (server.speedBps / maxSpeed) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-300 text-center">
                    {server.activeStreams || 0}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-300">
                    {formatBytes(server.bytesDownloaded)}
                  </td>
                  <td className="px-3 py-2 text-xs text-red-400 max-w-xs truncate">
                    {server.lastError || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="p-6 text-center">
            <span className="text-sm text-gray-500">No download servers configured</span>
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Update the parent component to pass WebSocket stats**

The ServerHealth component needs WebSocket stats passed as props. Find where `ServerHealth` is rendered (in `Dashboard.tsx` or directly in `App.tsx`) and pass the WS stats through. The component is currently self-contained — it needs to accept `speedTestRunning`, `speedTestCompleted`, `speedTestTotal` props from the parent that has access to `useWebSocket()`.

Check `Dashboard.tsx` or wherever `ServerHealth` is imported and update:

```tsx
<ServerHealth
  speedTestRunning={ws.stats.speedTestRunning}
  speedTestCompleted={ws.stats.speedTestCompleted}
  speedTestTotal={ws.stats.speedTestTotal}
/>
```

**Step 3: Commit**

```bash
git add frontend/src/components/ServerHealth.tsx frontend/src/components/Dashboard.tsx
git commit -m "feat: overhaul ServerHealth UI with speed scores, speed test button, sortable table"
```

---

### Task 10: Build and Verify

**Step 1: Build the frontend**

```bash
cd frontend && npm ci && npx tsc --noEmit && npm run build
```

Expected: TypeScript compiles cleanly, Vite produces build output.

**Step 2: Copy frontend and build Go binary**

```bash
cp -r frontend/dist cmd/server/frontend/dist
go build -o wansaturator ./cmd/server
```

Expected: Binary compiles without errors.

**Step 3: Verify the server starts**

```bash
DATA_DIR=/tmp/floodtest-test ./wansaturator &
sleep 2
curl -s http://localhost:7860/api/server-health | head -c 200
curl -s http://localhost:7860/api/status | head -c 200
kill %1
```

Expected: server-health returns JSON array with `location`, `speedBps`, `activeStreams`, `status` fields. Status endpoint responds.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues from smart server pool implementation"
```

---

### Task 11: Final Integration Commit

**Step 1: Verify all changes compile and run**

Run the full build chain one more time:

```bash
cd frontend && npm run build && cd ..
cp -r frontend/dist cmd/server/frontend/dist
go build -o wansaturator ./cmd/server
```

**Step 2: Create final commit if needed**

```bash
git add -A
git commit -m "feat: smart server pool with speed testing, weighted selection, and enhanced UI"
```
