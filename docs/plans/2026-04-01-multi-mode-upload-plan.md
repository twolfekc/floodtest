# Multi-Mode Upload Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add HTTP discard upload mode alongside existing S3 mode, enabling free WAN upload bandwidth testing via public speed test endpoints (Cloudflare, Tele2) without any cloud account.

**Architecture:** Add a new `http_engine.go` in the `upload` package that does plain HTTP POST to configurable endpoints. Add `upload_servers.go` for endpoint health tracking. The existing `engine.go` (S3 mode) stays unchanged. A new `UploadMode` config field controls which engine starts. The frontend Settings page gets a mode selector that shows/hides relevant config fields.

**Tech Stack:** Go 1.26, React 18, TypeScript, Tailwind CSS, net/http

---

### Task 1: Add Upload Mode and Endpoints to Config

**Files:**
- Modify: `internal/config/config.go`

**Step 1: Add new config fields**

Add these fields to the `Config` struct (after `DownloadServers`):

```go
UploadMode      string   `json:"uploadMode"`      // "s3", "http", "local"
UploadEndpoints []string `json:"uploadEndpoints"`
```

Add default upload endpoints:

```go
var DefaultUploadEndpoints = []string{
	"https://speed.cloudflare.com/__up",
	"http://speedtest.tele2.net/upload.php",
}
```

In `New()`, set defaults:

```go
UploadMode:      "http",
UploadEndpoints: DefaultUploadEndpoints,
```

Note: Default is `"http"` (not `"s3"`) since the design goal is to work without cloud accounts. Existing users with B2 configured can switch to `"s3"` in settings.

**Step 2: Add load/save for new fields**

In `loadFromDB()`, add:

```go
if v, _ := db.GetSetting(c.DB, "upload_mode"); v != "" {
	c.UploadMode = v
}
if v, _ := db.GetSetting(c.DB, "upload_endpoints"); v != "" {
	var endpoints []string
	if json.Unmarshal([]byte(v), &endpoints) == nil && len(endpoints) > 0 {
		c.UploadEndpoints = endpoints
	}
}
```

In `Save()`, add to the `pairs` map:

```go
"upload_mode": c.UploadMode,
```

And add upload endpoints JSON serialization (same pattern as download_servers):

```go
uploadEndpointsJSON, _ := json.Marshal(c.UploadEndpoints)
pairs["upload_endpoints"] = string(uploadEndpointsJSON)
```

**Step 3: Update IsSetupRequired**

Change `IsSetupRequired` — setup is no longer required since HTTP mode needs no credentials:

```go
func (c *Config) IsSetupRequired() bool {
	return false
}
```

**Step 4: Verify build**

```bash
go build ./...
```

**Step 5: Commit**

```bash
git add internal/config/config.go
git commit -m "feat: add uploadMode and uploadEndpoints config fields"
```

---

### Task 2: Add Upload Server List with Health Tracking

**Files:**
- Create: `internal/upload/upload_servers.go`

**Step 1: Create upload server list**

This is a simplified version of `download/servers.go`. It manages a list of upload endpoints with health tracking and round-robin selection. Key differences from download's `ServerList`: no speed scoring, no location metadata (upload endpoints are few and well-known).

```go
package upload

import (
	"sync"
	"time"
)

const (
	uploadUnhealthyCooldown = 30 * time.Second
	uploadMaxCooldown       = 5 * time.Minute
)

type UploadServerHealth struct {
	URL                 string    `json:"url"`
	Healthy             bool      `json:"healthy"`
	ConsecutiveFailures int       `json:"consecutiveFailures"`
	TotalFailures       int       `json:"totalFailures"`
	TotalUploads        int       `json:"totalUploads"`
	LastError           string    `json:"lastError,omitempty"`
	LastErrorTime       time.Time `json:"lastErrorTime,omitempty"`
	UnhealthyUntil      time.Time `json:"unhealthyUntil,omitempty"`
	BytesUploaded       int64     `json:"bytesUploaded"`
	ActiveStreams       int32     `json:"activeStreams"`
	Status              string    `json:"status"` // "healthy", "cooldown", "failed"
}

type uploadServer struct {
	url                 string
	healthy             bool
	unhealthyUntil      time.Time
	consecutiveFailures int
	totalFailures       int
	totalUploads        int
	lastError           string
	lastErrorTime       time.Time
	bytesUploaded       int64
	activeStreams       int32
}

type UploadServerList struct {
	mu      sync.RWMutex
	servers []uploadServer
	index   int
}

func NewUploadServerList(urls []string) *UploadServerList {
	servers := make([]uploadServer, len(urls))
	for i, u := range urls {
		servers[i] = uploadServer{url: u, healthy: true}
	}
	return &UploadServerList{servers: servers}
}

func (sl *UploadServerList) Next() string {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	if len(sl.servers) == 0 {
		return ""
	}

	now := time.Now()
	start := sl.index

	for i := 0; i < len(sl.servers); i++ {
		idx := (start + i) % len(sl.servers)
		s := &sl.servers[idx]

		if !s.healthy && now.After(s.unhealthyUntil) {
			s.healthy = true
			s.unhealthyUntil = time.Time{}
			s.consecutiveFailures = 0
		}

		if s.healthy {
			sl.index = (idx + 1) % len(sl.servers)
			return s.url
		}
	}

	// All unhealthy — pick soonest recovery
	var best *uploadServer
	for i := range sl.servers {
		s := &sl.servers[i]
		if best == nil || s.unhealthyUntil.Before(best.unhealthyUntil) {
			best = s
		}
	}
	sl.index = (sl.index + 1) % len(sl.servers)
	return best.url
}

func (sl *UploadServerList) MarkUnhealthy(url string, errMsg string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			s := &sl.servers[i]
			s.healthy = false
			s.consecutiveFailures++
			s.totalFailures++
			s.lastError = errMsg
			s.lastErrorTime = time.Now()

			cooldown := uploadUnhealthyCooldown
			for j := 1; j < s.consecutiveFailures && cooldown < uploadMaxCooldown; j++ {
				cooldown *= 2
			}
			if cooldown > uploadMaxCooldown {
				cooldown = uploadMaxCooldown
			}
			s.unhealthyUntil = time.Now().Add(cooldown)
			return
		}
	}
}

func (sl *UploadServerList) MarkSuccess(url string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			sl.servers[i].consecutiveFailures = 0
			sl.servers[i].totalUploads++
			return
		}
	}
}

func (sl *UploadServerList) AddBytes(url string, n int64) {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		if sl.servers[i].url == url {
			sl.servers[i].bytesUploaded += n
			return
		}
	}
}

func (sl *UploadServerList) IncrementStreams(url string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		if sl.servers[i].url == url {
			sl.servers[i].activeStreams++
			return
		}
	}
}

func (sl *UploadServerList) DecrementStreams(url string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		if sl.servers[i].url == url {
			if sl.servers[i].activeStreams > 0 {
				sl.servers[i].activeStreams--
			}
			return
		}
	}
}

func (sl *UploadServerList) HealthStatus() []UploadServerHealth {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	now := time.Now()
	result := make([]UploadServerHealth, len(sl.servers))
	for i, s := range sl.servers {
		healthy := s.healthy
		if !healthy && now.After(s.unhealthyUntil) {
			healthy = true
		}

		status := "healthy"
		if !healthy {
			if s.consecutiveFailures >= 5 {
				status = "failed"
			} else {
				status = "cooldown"
			}
		}

		result[i] = UploadServerHealth{
			URL:                 s.url,
			Healthy:             healthy,
			ConsecutiveFailures: s.consecutiveFailures,
			TotalFailures:       s.totalFailures,
			TotalUploads:        s.totalUploads,
			LastError:           s.lastError,
			LastErrorTime:       s.lastErrorTime,
			UnhealthyUntil:      s.unhealthyUntil,
			BytesUploaded:       s.bytesUploaded,
			ActiveStreams:       s.activeStreams,
			Status:              status,
		}
	}
	return result
}

func (sl *UploadServerList) UpdateServers(urls []string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	servers := make([]uploadServer, len(urls))
	for i, u := range urls {
		servers[i] = uploadServer{url: u, healthy: true}
	}
	sl.servers = servers
	sl.index = 0
}

func (sl *UploadServerList) HealthyCount() int {
	sl.mu.RLock()
	defer sl.mu.RUnlock()
	now := time.Now()
	count := 0
	for _, s := range sl.servers {
		if s.healthy || now.After(s.unhealthyUntil) {
			count++
		}
	}
	return count
}

func (sl *UploadServerList) TotalCount() int {
	sl.mu.RLock()
	defer sl.mu.RUnlock()
	return len(sl.servers)
}
```

**Step 2: Verify build**

```bash
go build ./...
```

**Step 3: Commit**

```bash
git add internal/upload/upload_servers.go
git commit -m "feat: add upload server list with health tracking"
```

---

### Task 3: Create HTTP Upload Engine

**Files:**
- Create: `internal/upload/http_engine.go`

**Step 1: Create the HTTP-based upload engine**

This engine generates random data and POSTs it to endpoints from the `UploadServerList`. It reuses the `StatsCollector` interface and `CountingReader` from `engine.go`.

```go
package upload

import (
	"context"
	"crypto/rand"
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

// HTTPEngine uploads random data via HTTP POST to discard endpoints.
type HTTPEngine struct {
	serverList     *UploadServerList
	stats          StatsCollector
	concurrency    int
	maxConcurrency int
	chunkSize      int64
	rateLimitBps   atomic.Int64
	targetBps      atomic.Int64
	activeStreams  atomic.Int32
	running        atomic.Bool
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	mu             sync.Mutex
	statsProvider  func() int64
}

// NewHTTPEngine creates an HTTP-based upload engine.
func NewHTTPEngine(serverList *UploadServerList, concurrency int, chunkSize int64, rateLimitBps int64) *HTTPEngine {
	e := &HTTPEngine{
		serverList:     serverList,
		concurrency:    concurrency,
		maxConcurrency: 32,
		chunkSize:      chunkSize,
	}
	e.rateLimitBps.Store(rateLimitBps)
	return e
}

func (e *HTTPEngine) SetStatsCollector(c StatsCollector) { e.stats = c }
func (e *HTTPEngine) SetStatsProvider(fn func() int64) {
	e.mu.Lock()
	e.statsProvider = fn
	e.mu.Unlock()
}
func (e *HTTPEngine) SetTargetBps(bps int64)  { e.targetBps.Store(bps) }
func (e *HTTPEngine) ActiveStreams() int       { return int(e.activeStreams.Load()) }
func (e *HTTPEngine) SetRateLimit(bps int64)   { e.rateLimitBps.Store(bps) }
func (e *HTTPEngine) IsRunning() bool          { return e.running.Load() }

func (e *HTTPEngine) SetConcurrency(n int) {
	e.mu.Lock()
	e.concurrency = n
	e.mu.Unlock()
}

func (e *HTTPEngine) SetChunkSize(bytes int64) {
	e.mu.Lock()
	e.chunkSize = bytes
	e.mu.Unlock()
}

func (e *HTTPEngine) Start(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.running.Load() {
		return nil
	}

	childCtx, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	e.running.Store(true)
	e.activeStreams.Store(0)

	for i := 0; i < e.concurrency; i++ {
		e.launchStream(childCtx)
	}

	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		e.autoAdjust(childCtx)
	}()

	return nil
}

func (e *HTTPEngine) launchStream(ctx context.Context) {
	e.wg.Add(1)
	e.activeStreams.Add(1)
	go func() {
		defer e.wg.Done()
		defer e.activeStreams.Add(-1)
		e.uploadLoop(ctx)
	}()
}

func (e *HTTPEngine) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
	e.wg.Wait()
	e.running.Store(false)
	e.activeStreams.Store(0)
}

func (e *HTTPEngine) httpClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout: 30 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout: 30 * time.Second,
			MaxIdleConnsPerHost: 4,
		},
		Timeout: 0, // no overall timeout — stream until done or cancel
	}
}

func (e *HTTPEngine) uploadLoop(ctx context.Context) {
	client := e.httpClient()

	for {
		if ctx.Err() != nil {
			return
		}

		serverURL := e.serverList.Next()
		if serverURL == "" {
			select {
			case <-ctx.Done():
				return
			case <-time.After(1 * time.Second):
				continue
			}
		}

		e.serverList.IncrementStreams(serverURL)
		err := e.uploadTo(ctx, client, serverURL)
		e.serverList.DecrementStreams(serverURL)

		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("upload error to %s: %v", serverURL, err)
			e.serverList.MarkUnhealthy(serverURL, err.Error())
			select {
			case <-ctx.Done():
				return
			case <-time.After(1 * time.Second):
			}
		} else {
			e.serverList.MarkSuccess(serverURL)
		}
	}
}

func (e *HTTPEngine) uploadTo(ctx context.Context, client *http.Client, serverURL string) error {
	e.mu.Lock()
	chunkSize := e.chunkSize
	conc := e.concurrency
	e.mu.Unlock()

	pr, pw := io.Pipe()

	// Rate limiter
	var limiter *rate.Limiter
	totalBps := e.rateLimitBps.Load()
	if totalBps > 0 && conc > 0 {
		perStream := totalBps / int64(conc)
		if perStream < 1 {
			perStream = 1
		}
		burst := int(perStream)
		if burst > 256*1024 {
			burst = 256 * 1024
		}
		limiter = rate.NewLimiter(rate.Limit(perStream), burst)
	}

	// Writer goroutine: push random data into pipe
	go func() {
		defer pw.Close()
		buf := make([]byte, 256*1024)
		var written int64
		for written < chunkSize {
			if ctx.Err() != nil {
				return
			}
			toWrite := int64(len(buf))
			if remaining := chunkSize - written; remaining < toWrite {
				toWrite = remaining
			}
			n, err := rand.Read(buf[:toWrite])
			if err != nil {
				pw.CloseWithError(fmt.Errorf("rand read: %w", err))
				return
			}
			if limiter != nil {
				if err := limiter.WaitN(ctx, n); err != nil {
					return
				}
			}
			nn, err := pw.Write(buf[:n])
			if err != nil {
				return
			}
			written += int64(nn)
		}
	}()

	// Wrap reader for stats counting + per-server byte tracking
	reader := &httpCountingReader{r: pr, stats: e.stats, serverList: e.serverList, serverURL: serverURL}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serverURL, reader)
	if err != nil {
		pr.CloseWithError(err)
		return fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.ContentLength = chunkSize

	resp, err := client.Do(req)
	if err != nil {
		pr.CloseWithError(err)
		return fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	// Accept any 2xx as success
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	return nil
}

// httpCountingReader wraps an io.Reader and reports bytes to both StatsCollector and server list.
type httpCountingReader struct {
	r          io.Reader
	stats      StatsCollector
	serverList *UploadServerList
	serverURL  string
}

func (cr *httpCountingReader) Read(p []byte) (int, error) {
	n, err := cr.r.Read(p)
	if n > 0 {
		if cr.stats != nil {
			cr.stats.AddUploadBytes(int64(n))
		}
		cr.serverList.AddBytes(cr.serverURL, int64(n))
	}
	return n, err
}

func (e *HTTPEngine) autoAdjust(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.mu.Lock()
			provider := e.statsProvider
			maxConc := e.maxConcurrency
			e.mu.Unlock()

			if provider == nil {
				continue
			}
			target := e.targetBps.Load()
			if target <= 0 {
				continue
			}
			current := provider()
			active := int(e.activeStreams.Load())
			if current < target*80/100 && active < maxConc {
				e.launchStream(ctx)
				log.Printf("upload(http) auto-adjust: added stream (now %d, current=%dMbps, target=%dMbps)",
					e.activeStreams.Load(), current/1_000_000, target/1_000_000)
			}
		}
	}
}
```

**Step 2: Verify build**

```bash
go build ./...
```

**Step 3: Commit**

```bash
git add internal/upload/http_engine.go
git commit -m "feat: add HTTP discard upload engine for free bandwidth testing"
```

---

### Task 4: Add Upload Sink and Upload Health API Endpoints

**Files:**
- Modify: `internal/api/handlers.go`
- Modify: `internal/api/app.go` (the App struct is actually defined in handlers.go based on the code)
- Modify: `internal/api/router.go`

**Step 1: Add callbacks to App struct**

In `internal/api/handlers.go`, add to the App struct:

```go
GetUploadServerHealth func() interface{}
```

**Step 2: Add upload sink handler**

In `internal/api/handlers.go`, add:

```go
func (a *App) HandleUploadSink(w http.ResponseWriter, r *http.Request) {
	io.Copy(io.Discard, r.Body)
	r.Body.Close()
	w.WriteHeader(http.StatusOK)
}

func (a *App) HandleUploadServerHealth(w http.ResponseWriter, r *http.Request) {
	if a.GetUploadServerHealth != nil {
		writeJSON(w, a.GetUploadServerHealth())
	} else {
		writeJSON(w, []struct{}{})
	}
}
```

Add `"io"` to the imports in handlers.go.

**Step 3: Add routes**

In `internal/api/router.go`, add:

```go
mux.HandleFunc("POST /api/upload-sink", app.HandleUploadSink)
mux.HandleFunc("GET /api/upload-server-health", app.HandleUploadServerHealth)
```

**Step 4: Handle new config fields in HandleUpdateSettings**

In `internal/api/handlers.go`, in `HandleUpdateSettings`, add handling for the new fields:

```go
if v, ok := updates["uploadMode"]; ok {
	cfg.UploadMode = fmt.Sprint(v)
}
if v, ok := updates["uploadEndpoints"]; ok {
	if arr, ok := v.([]interface{}); ok {
		endpoints := make([]string, 0, len(arr))
		for _, s := range arr {
			endpoints = append(endpoints, fmt.Sprint(s))
		}
		cfg.UploadEndpoints = endpoints
	}
}
```

**Step 5: Verify build**

```bash
go build ./...
```

**Step 6: Commit**

```bash
git add internal/api/handlers.go internal/api/router.go
git commit -m "feat: add upload sink, upload server health endpoint, and upload mode settings"
```

---

### Task 5: Wire Multi-Mode Upload in main.go

**Files:**
- Modify: `cmd/server/main.go`

**Step 1: Create upload server list and HTTP engine alongside existing S3 engine**

After the existing upload engine initialization (line ~67), add:

```go
// Initialize upload endpoint list (for HTTP discard mode)
uploadServerList := upload.NewUploadServerList(cfg.UploadEndpoints)
httpUploadEngine := upload.NewHTTPEngine(
	uploadServerList,
	cfg.UploadConcurrency,
	int64(cfg.UploadChunkSizeMB)*1024*1024,
	mbpsToBps(cfg.DefaultUploadMbps),
)
httpUploadEngine.SetStatsCollector(collector)
httpUploadEngine.SetStatsProvider(func() int64 { return collector.CurrentRate().UploadBps })
```

**Step 2: Update startEngines to dispatch by upload mode**

Replace the upload start section in `startEngines` (lines ~136-146) with:

```go
// Start upload engine based on mode
switch cfgNow.UploadMode {
case "s3":
	if cfgNow.B2KeyID != "" && cfgNow.B2AppKey != "" && cfgNow.B2BucketName != "" {
		ulEngine.UpdateCredentials(cfgNow.B2KeyID, cfgNow.B2AppKey, cfgNow.B2BucketName, cfgNow.B2Endpoint)
		ulEngine.SetChunkSize(int64(cfgNow.UploadChunkSizeMB) * 1024 * 1024)
		if err := ulEngine.Start(ctx); err != nil {
			log.Printf("Upload engine (S3) failed to start: %v", err)
		} else {
			log.Printf("Upload engine (S3) started: %dMbps, %d streams", ulMbps, cfgNow.UploadConcurrency)
		}
	} else {
		log.Println("Upload engine (S3) skipped: credentials not configured")
	}
case "http":
	uploadServerList.UpdateServers(cfgNow.UploadEndpoints)
	httpUploadEngine.SetConcurrency(cfgNow.UploadConcurrency)
	httpUploadEngine.SetChunkSize(int64(cfgNow.UploadChunkSizeMB) * 1024 * 1024)
	httpUploadEngine.SetRateLimit(mbpsToBps(ulMbps))
	httpUploadEngine.SetTargetBps(int64(ulMbps) * 1_000_000)
	if err := httpUploadEngine.Start(ctx); err != nil {
		log.Printf("Upload engine (HTTP) failed to start: %v", err)
	} else {
		log.Printf("Upload engine (HTTP) started: %dMbps, %d streams, %d endpoints",
			ulMbps, cfgNow.UploadConcurrency, len(cfgNow.UploadEndpoints))
	}
case "local":
	// For local mode, use HTTP engine pointed at self
	localEndpoints := []string{fmt.Sprintf("http://localhost:%d/api/upload-sink", port)}
	uploadServerList.UpdateServers(localEndpoints)
	httpUploadEngine.SetConcurrency(cfgNow.UploadConcurrency)
	httpUploadEngine.SetChunkSize(int64(cfgNow.UploadChunkSizeMB) * 1024 * 1024)
	httpUploadEngine.SetRateLimit(mbpsToBps(ulMbps))
	httpUploadEngine.SetTargetBps(int64(ulMbps) * 1_000_000)
	if err := httpUploadEngine.Start(ctx); err != nil {
		log.Printf("Upload engine (local) failed to start: %v", err)
	} else {
		log.Printf("Upload engine (local discard) started: %dMbps", ulMbps)
	}
default:
	log.Printf("Upload engine skipped: unknown mode %q", cfgNow.UploadMode)
}
```

Remove the old upload credential update and start code that this replaces.

**Step 3: Update stopEngines to stop both engines**

In `stopEngines`, add `httpUploadEngine.Stop()` alongside `ulEngine.Stop()`.

**Step 4: Update GetUploadStreams to return from whichever engine is running**

```go
GetUploadStreams: func() int {
	if httpUploadEngine.IsRunning() {
		return httpUploadEngine.ActiveStreams()
	}
	return ulEngine.ActiveStreams()
},
```

**Step 5: Wire upload server health callback**

```go
app.GetUploadServerHealth = func() interface{} { return uploadServerList.HealthStatus() }
```

**Step 6: Move the `port` variable extraction before startEngines**

Currently `port` is set around line 273 (`port := cfg.WebPort`). It needs to be available in `startEngines` for the local discard mode URL. Move the port variable declaration to before the `startEngines` closure, or just use `cfg.WebPort` directly.

**Step 7: Verify build**

```bash
go build ./...
```

**Step 8: Commit**

```bash
git add cmd/server/main.go
git commit -m "feat: wire multi-mode upload engine (s3/http/local) in main.go"
```

---

### Task 6: Update Frontend Types and API Client

**Files:**
- Modify: `frontend/src/api/client.ts`

**Step 1: Update Settings interface**

Add new fields to the `Settings` interface:

```typescript
export interface Settings {
  // ... existing fields ...
  uploadMode: string           // "s3" | "http" | "local"
  uploadEndpoints: string[]
}
```

**Step 2: Add UploadServerHealth interface**

```typescript
export interface UploadServerHealth {
  url: string
  healthy: boolean
  consecutiveFailures: number
  totalFailures: number
  totalUploads: number
  lastError?: string
  lastErrorTime?: string
  unhealthyUntil?: string
  bytesUploaded: number
  activeStreams: number
  status: string
}
```

**Step 3: Add API method**

```typescript
getUploadServerHealth: () => request<UploadServerHealth[]>('/api/upload-server-health'),
```

**Step 4: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: add upload mode, upload endpoints, and upload server health to frontend types"
```

---

### Task 7: Update Settings UI with Upload Mode Selector

**Files:**
- Modify: `frontend/src/components/Settings.tsx`

**Step 1: Replace the "B2 Configuration" and "Upload" sections**

Replace the current B2 and Upload sections with a new "Upload Configuration" section that includes:

1. **Upload Mode dropdown** — select between "HTTP Discard (Free)", "S3-Compatible (B2/R2)", "Local Discard (Testing)"
2. **Conditional fields:**
   - When `"s3"`: show existing B2 credential fields (Key ID, App Key, Bucket, Endpoint, Test Connection button)
   - When `"http"`: show upload endpoint list (same add/remove pattern as download servers) + chunk size
   - When `"local"`: show info text "Uploads to this app's built-in discard endpoint" + chunk size
3. **Chunk size** shown for all modes

The upload mode dropdown:

```tsx
<div>
  <label className={labelClass}>Upload Mode</label>
  <select
    value={settings.uploadMode}
    onChange={(e) => update({ uploadMode: e.target.value })}
    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
  >
    <option value="http">HTTP Discard (Free — no account needed)</option>
    <option value="s3">S3-Compatible (Backblaze B2 / Cloudflare R2)</option>
    <option value="local">Local Discard (testing only)</option>
  </select>
  <p className="text-xs text-gray-500 mt-1">
    {settings.uploadMode === 'http' && 'Uploads random data to public speed test endpoints. Free, no account required.'}
    {settings.uploadMode === 's3' && 'Uploads to S3-compatible storage (Backblaze B2, Cloudflare R2, etc). Requires credentials.'}
    {settings.uploadMode === 'local' && 'Uploads to this app\'s built-in discard endpoint. Does not test real WAN bandwidth.'}
  </p>
</div>
```

When mode is `"http"`, show an upload endpoints list with add/remove (same pattern as download servers list but using `uploadEndpoints`).

When mode is `"s3"`, show the existing B2 credential fields and test connection button.

When mode is `"local"`, show just the chunk size field and an info note.

**Step 2: Add upload endpoint management functions**

Add state and handlers for the upload endpoint list (mirror the download server add/remove pattern):

```tsx
const [newUploadEndpoint, setNewUploadEndpoint] = useState('')

const addUploadEndpoint = () => {
  if (!settings || !newUploadEndpoint.trim()) return
  update({ uploadEndpoints: [...settings.uploadEndpoints, newUploadEndpoint.trim()] })
  setNewUploadEndpoint('')
}

const removeUploadEndpoint = (index: number) => {
  if (!settings) return
  update({ uploadEndpoints: settings.uploadEndpoints.filter((_, i) => i !== index) })
}
```

**Step 3: Verify TypeScript and build**

```bash
cd frontend && npx tsc --noEmit && npm run build
```

**Step 4: Commit**

```bash
git add frontend/src/components/Settings.tsx
git commit -m "feat: add upload mode selector and endpoint management to Settings UI"
```

---

### Task 8: Build, Verify, and Final Integration

**Step 1: Build everything**

```bash
cd frontend && npm run build && cd ..
cp -r frontend/dist cmd/server/frontend/dist
go build -o /tmp/wansaturator-test ./cmd/server
```

**Step 2: Smoke test**

```bash
DATA_DIR=/tmp/floodtest-test /tmp/wansaturator-test &
sleep 2
# Check settings include new fields
curl -s http://localhost:7860/api/settings | python3 -m json.tool | grep -E "uploadMode|uploadEndpoints"
# Check upload sink works
dd if=/dev/zero bs=1M count=1 2>/dev/null | curl -s -X POST -H "Content-Type: application/octet-stream" --data-binary @- http://localhost:7860/api/upload-sink -w "%{http_code}"
# Check upload server health
curl -s http://localhost:7860/api/upload-server-health | python3 -m json.tool | head -20
kill %1
rm -rf /tmp/floodtest-test
```

Expected: settings show `uploadMode: "http"` and `uploadEndpoints` array. Upload sink returns 200. Upload server health returns array.

**Step 3: Fix any issues and commit**

```bash
git add -A
git commit -m "feat: multi-mode upload engine with HTTP discard, S3, and local modes"
```
