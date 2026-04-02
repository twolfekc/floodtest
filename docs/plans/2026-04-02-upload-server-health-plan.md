# Upload Server Health & Combined UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add speed tracking, location metadata, and blocking to upload servers, then combine download + upload server health into a polished collapsible stacked UI.

**Architecture:** Extend the existing `uploadServer` struct with speed/location/blocking fields mirroring `download.Server`. Add two new API endpoints for upload server unblocking. Refactor `ServerHealth.tsx` into a parent component with two collapsible `ServerSection` subcomponents sharing a `ServerTable`.

**Tech Stack:** Go 1.22, React 18, TypeScript, Tailwind CSS

---

### Task 1: Add speed tracking to upload servers

**Files:**
- Modify: `internal/upload/upload_servers.go:31-42` (uploadServer struct)
- Modify: `internal/upload/upload_servers.go:16-28` (UploadServerHealth struct)

**Step 1: Write failing tests**

Create `internal/upload/upload_servers_test.go`:

```go
package upload

import (
	"testing"
)

func TestUpdateSpeedScore(t *testing.T) {
	sl := NewUploadServerList([]string{"http://a.com", "http://b.com"})

	// First sample
	sl.UpdateSpeedScore("http://a.com", 1e9)
	health := sl.HealthStatus()
	if health[0].SpeedBps != 1e9 {
		t.Errorf("expected 1e9, got %f", health[0].SpeedBps)
	}

	// Rolling average of 3 samples
	sl.UpdateSpeedScore("http://a.com", 2e9)
	sl.UpdateSpeedScore("http://a.com", 3e9)
	health = sl.HealthStatus()
	expected := (1e9 + 2e9 + 3e9) / 3
	if health[0].SpeedBps != expected {
		t.Errorf("expected %f, got %f", expected, health[0].SpeedBps)
	}

	// Window caps at 5 samples
	sl.UpdateSpeedScore("http://a.com", 4e9)
	sl.UpdateSpeedScore("http://a.com", 5e9)
	sl.UpdateSpeedScore("http://a.com", 6e9) // should push out 1e9
	health = sl.HealthStatus()
	expected = (2e9 + 3e9 + 4e9 + 5e9 + 6e9) / 5
	if health[0].SpeedBps != expected {
		t.Errorf("expected %f, got %f", expected, health[0].SpeedBps)
	}

	// Unknown URL is a no-op
	sl.UpdateSpeedScore("http://unknown.com", 999)
}
```

**Step 2: Run test to verify it fails**

Run: `go test -race ./internal/upload/ -run TestUpdateSpeedScore -v`
Expected: FAIL — `UpdateSpeedScore` method and `SpeedBps` field don't exist

**Step 3: Implement speed tracking**

In `internal/upload/upload_servers.go`, add to the `uploadServer` struct:

```go
speedScore   float64
speedSamples []float64
```

Add to `UploadServerHealth` struct:

```go
SpeedBps float64 `json:"speedBps"`
```

Add constant:

```go
uploadSpeedSampleWindow = 5
```

Add method:

```go
func (sl *UploadServerList) UpdateSpeedScore(url string, bps float64) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			s := &sl.servers[i]
			s.speedSamples = append(s.speedSamples, bps)
			if len(s.speedSamples) > uploadSpeedSampleWindow {
				s.speedSamples = s.speedSamples[len(s.speedSamples)-uploadSpeedSampleWindow:]
			}
			var total float64
			for _, v := range s.speedSamples {
				total += v
			}
			s.speedScore = total / float64(len(s.speedSamples))
			return
		}
	}
}
```

Update `HealthStatus()` to populate `SpeedBps: s.speedScore`.

**Step 4: Run test to verify it passes**

Run: `go test -race ./internal/upload/ -run TestUpdateSpeedScore -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/upload/upload_servers.go internal/upload/upload_servers_test.go
git commit -m "feat: add speed tracking to upload servers"
```

---

### Task 2: Add location metadata to upload servers

**Files:**
- Modify: `internal/upload/upload_servers.go`
- Modify: `internal/upload/upload_servers_test.go`

**Step 1: Write failing test**

Add to `internal/upload/upload_servers_test.go`:

```go
func TestUploadServerLocation(t *testing.T) {
	sl := NewUploadServerList([]string{
		"https://s3.us-west-002.backblazeb2.com/bucket",
		"https://s3.eu-central-003.backblazeb2.com/bucket",
		"https://s3.us-east-005.backblazeb2.com/bucket",
		"https://custom-server.example.com/upload",
	})

	health := sl.HealthStatus()
	cases := []struct {
		idx      int
		expected string
	}{
		{0, "US West"},
		{1, "EU Central"},
		{2, "US East"},
		{3, ""},
	}
	for _, tc := range cases {
		if health[tc.idx].Location != tc.expected {
			t.Errorf("server %d: expected location %q, got %q", tc.idx, tc.expected, health[tc.idx].Location)
		}
	}
}
```

**Step 2: Run test to verify it fails**

Run: `go test -race ./internal/upload/ -run TestUploadServerLocation -v`
Expected: FAIL — `Location` field doesn't exist on `UploadServerHealth`

**Step 3: Implement location derivation**

Add `location string` field to `uploadServer` struct.
Add `Location string json:"location"` to `UploadServerHealth` struct.

Add location derivation function:

```go
func deriveUploadLocation(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())

	// B2/S3 region patterns
	regionMap := map[string]string{
		"us-west":    "US West",
		"us-east":    "US East",
		"eu-central": "EU Central",
		"eu-west":    "EU West",
		"ap-south":   "AP South",
		"ap-north":   "AP Northeast",
	}
	for pattern, label := range regionMap {
		if strings.Contains(host, pattern) {
			return label
		}
	}
	return ""
}
```

Call `deriveUploadLocation` in `NewUploadServerList()` and `UpdateServers()` when creating server entries. Populate `Location` in `HealthStatus()`.

Add `"net/url"` and `"strings"` imports.

**Step 4: Run test to verify it passes**

Run: `go test -race ./internal/upload/ -run TestUploadServerLocation -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/upload/upload_servers.go internal/upload/upload_servers_test.go
git commit -m "feat: add location metadata to upload servers"
```

---

### Task 3: Add blocking/unblocking to upload servers

**Files:**
- Modify: `internal/upload/upload_servers.go`
- Modify: `internal/upload/upload_servers_test.go`

**Step 1: Write failing tests**

Add to `internal/upload/upload_servers_test.go`:

```go
func TestUploadServerAutoBlock(t *testing.T) {
	sl := NewUploadServerList([]string{"http://a.com", "http://b.com"})

	// 5 consecutive failures should auto-block
	for i := 0; i < 5; i++ {
		sl.MarkUnhealthy("http://a.com", "fail")
	}
	health := sl.HealthStatus()
	if health[0].Status != "blocked" {
		t.Errorf("expected blocked, got %s", health[0].Status)
	}
	if !health[0].Blocked {
		t.Error("expected Blocked=true")
	}
}

func TestUploadServerUnblock(t *testing.T) {
	sl := NewUploadServerList([]string{"http://a.com", "http://b.com"})

	for i := 0; i < 5; i++ {
		sl.MarkUnhealthy("http://a.com", "fail")
	}

	ok := sl.UnblockServer("http://a.com")
	if !ok {
		t.Error("expected UnblockServer to return true")
	}

	health := sl.HealthStatus()
	if health[0].Status != "healthy" {
		t.Errorf("expected healthy after unblock, got %s", health[0].Status)
	}
}

func TestUploadServerUnblockAll(t *testing.T) {
	sl := NewUploadServerList([]string{"http://a.com", "http://b.com"})

	for i := 0; i < 5; i++ {
		sl.MarkUnhealthy("http://a.com", "fail")
		sl.MarkUnhealthy("http://b.com", "fail")
	}

	count := sl.UnblockAll()
	if count != 2 {
		t.Errorf("expected 2 unblocked, got %d", count)
	}

	health := sl.HealthStatus()
	for _, h := range health {
		if h.Status != "healthy" {
			t.Errorf("expected healthy, got %s for %s", h.Status, h.URL)
		}
	}
}
```

**Step 2: Run tests to verify they fail**

Run: `go test -race ./internal/upload/ -run "TestUploadServer(AutoBlock|Unblock)" -v`
Expected: FAIL — `Blocked` field, `UnblockServer`, `UnblockAll` don't exist

**Step 3: Implement blocking**

Add `blocked bool` field to `uploadServer` struct.
Add `Blocked bool json:"blocked"` to `UploadServerHealth` struct.

Update `MarkUnhealthy` to auto-block after 5 consecutive failures:

```go
if s.consecutiveFailures >= 5 {
	s.blocked = true
}
```

Update `HealthStatus()` status computation to check `blocked` first:

```go
status := "healthy"
if s.blocked {
	status = "blocked"
} else if !s.healthy {
	if s.consecutiveFailures >= 5 {
		status = "failed"
	} else if now.Before(s.unhealthyUntil) {
		status = "cooldown"
	}
}
```

Add methods:

```go
func (sl *UploadServerList) UnblockServer(url string) bool {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			sl.servers[i].blocked = false
			sl.servers[i].healthy = true
			sl.servers[i].consecutiveFailures = 0
			sl.servers[i].unhealthyUntil = time.Time{}
			return true
		}
	}
	return false
}

func (sl *UploadServerList) UnblockAll() int {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	count := 0
	for i := range sl.servers {
		if sl.servers[i].blocked {
			sl.servers[i].blocked = false
			sl.servers[i].healthy = true
			sl.servers[i].consecutiveFailures = 0
			sl.servers[i].unhealthyUntil = time.Time{}
			count++
		}
	}
	return count
}
```

Update `Next()` to skip blocked servers (same as healthy check — skip if `s.blocked`).

Bump `uploadMaxCooldown` from 5 min to 10 min.

**Step 4: Run tests to verify they pass**

Run: `go test -race ./internal/upload/ -run "TestUploadServer" -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add internal/upload/upload_servers.go internal/upload/upload_servers_test.go
git commit -m "feat: add blocking/unblocking to upload servers"
```

---

### Task 4: Add upload unblock API endpoints

**Files:**
- Modify: `internal/api/handlers.go:21-50` (App struct — add callbacks)
- Modify: `internal/api/handlers.go` (add handler functions)
- Modify: `internal/api/router.go:35` (add routes)

**Step 1: Write failing test**

Add to `internal/api/handlers_test.go` (find existing unblock tests and add alongside):

```go
func TestHandleUnblockUploadServer(t *testing.T) {
	app := &App{
		UnblockUploadServer: func(url string) bool { return url == "http://a.com" },
	}
	body := `{"url":"http://a.com"}`
	req := httptest.NewRequest("POST", "/api/upload-unblock", strings.NewReader(body))
	w := httptest.NewRecorder()
	app.HandleUnblockUploadServer(w, req)
	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandleUnblockAllUploads(t *testing.T) {
	app := &App{
		UnblockAllUploads: func() int { return 3 },
	}
	req := httptest.NewRequest("POST", "/api/upload-unblock-all", nil)
	w := httptest.NewRecorder()
	app.HandleUnblockAllUploads(w, req)
	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}
```

**Step 2: Run tests to verify they fail**

Run: `go test -race ./internal/api/ -run "TestHandleUnblock(Upload|AllUpload)" -v`
Expected: FAIL — fields and methods don't exist

**Step 3: Implement handlers**

Add to `App` struct in `internal/api/handlers.go:21-50`:

```go
UnblockUploadServer func(url string) bool
UnblockAllUploads   func() int
```

Add handler methods (mirror existing `HandleUnblockServer` / `HandleUnblockAll`):

```go
func (a *App) HandleUnblockUploadServer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := decodeJSONBody(r, &req, false); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	if err := validateAbsoluteURL("url", req.URL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if a.UnblockUploadServer != nil && a.UnblockUploadServer(req.URL) {
		writeJSON(w, map[string]string{"status": "unblocked"})
	} else {
		writeError(w, 404, "upload server not found")
	}
}

func (a *App) HandleUnblockAllUploads(w http.ResponseWriter, r *http.Request) {
	count := 0
	if a.UnblockAllUploads != nil {
		count = a.UnblockAllUploads()
	}
	writeJSON(w, map[string]interface{}{"status": "unblocked", "count": count})
}
```

Add routes in `internal/api/router.go` after line 35:

```go
mux.HandleFunc("POST /api/upload-unblock", app.HandleUnblockUploadServer)
mux.HandleFunc("POST /api/upload-unblock-all", app.HandleUnblockAllUploads)
```

**Step 4: Run tests to verify they pass**

Run: `go test -race ./internal/api/ -run "TestHandleUnblock" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/api/handlers.go internal/api/handlers_test.go internal/api/router.go
git commit -m "feat: add upload server unblock API endpoints"
```

---

### Task 5: Wire upload server callbacks and WebSocket fields

**Files:**
- Modify: `cmd/server/main.go:292-294` (add callbacks)
- Modify: `cmd/server/main.go:374-394` (add WS fields)
- Modify: `internal/api/websocket.go:14-34` (add WsMessage fields)

**Step 1: Add WebSocket fields**

In `internal/api/websocket.go`, add to `WsMessage` struct after `TotalServers`:

```go
HealthyUploadServers int `json:"healthyUploadServers"`
TotalUploadServers   int `json:"totalUploadServers"`
```

**Step 2: Wire callbacks in main.go**

In `cmd/server/main.go`, add after the existing `UnblockAll` callback (~line 294):

```go
UnblockUploadServer: func(url string) bool { return uploadServerList.UnblockServer(url) },
UnblockAllUploads:   func() int { return uploadServerList.UnblockAll() },
```

**Step 3: Add upload counts to WebSocket broadcast**

In `cmd/server/main.go`, in the `hub.Broadcast(api.WsMessage{...})` block (~line 374-394), add after `TotalServers`:

```go
HealthyUploadServers: uploadServerList.HealthyCount(),
TotalUploadServers:   uploadServerList.TotalCount(),
```

**Step 4: Run all Go tests**

Run: `go test -race ./...`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add internal/api/websocket.go cmd/server/main.go
git commit -m "feat: wire upload server unblock callbacks and WebSocket fields"
```

---

### Task 6: Update frontend API client types

**Files:**
- Modify: `frontend/src/api/client.ts:113-125` (UploadServerHealth interface)
- Modify: `frontend/src/api/client.ts:205-209` (add API methods)

**Step 1: Update TypeScript interface**

In `frontend/src/api/client.ts`, update `UploadServerHealth` interface (line 113):

```typescript
export interface UploadServerHealth {
  url: string
  location: string
  healthy: boolean
  blocked: boolean
  consecutiveFailures: number
  totalFailures: number
  totalUploads: number
  lastError?: string
  lastErrorTime?: string
  unhealthyUntil?: string
  bytesUploaded: number
  speedBps: number
  activeStreams: number
  status: string
}
```

**Step 2: Add API methods**

Add after `unblockAll` in the `api` object (~line 209):

```typescript
unblockUploadServer: (url: string) => request<{ status: string }>('/api/upload-unblock', {
  method: 'POST',
  body: JSON.stringify({ url }),
}),
unblockAllUploads: () => request<{ status: string; count: number }>('/api/upload-unblock-all', { method: 'POST' }),
```

**Step 3: Run type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: update UploadServerHealth types and add unblock API methods"
```

---

### Task 7: Refactor ServerHealth.tsx into collapsible stacked sections

**Files:**
- Modify: `frontend/src/components/ServerHealth.tsx` (full rewrite)

**Step 1: Rewrite the component**

Replace `ServerHealth.tsx` with the new collapsible stacked layout. Key structure:

```tsx
// Top-level: fetches both download and upload server data
// Renders two CollapsibleSection components stacked vertically

interface CollapsibleSectionProps {
  title: string
  type: 'download' | 'upload'
  servers: ServerHealthData[] | UploadServerHealthData[]
  isRunning?: boolean
  onSpeedTest?: () => void
  onUnblock?: (url: string) => void
  onUnblockAll?: () => void
  speedTestProgress?: { completed: number; total: number }
  lastTestTime?: string | null
}
```

Key implementation details:

- **Collapse state**: Use `localStorage` keys `serverHealth.download.collapsed` and `serverHealth.upload.collapsed`. Default: both expanded.
- **Header bar**: Single row with chevron (rotates 90deg when expanded), title, status counts inline, action buttons right-aligned.
- **Shared table rendering**: Both sections use the same table markup. Columns: Server, Location, Status, Speed, Streams, Transferred, Error. The `type` prop determines field mapping (`bytesDownloaded` vs `bytesUploaded`, `totalDownloads` vs `totalUploads`).
- **Polish**: `py-2` row padding, summary merged into header, error tooltip via `title` attribute, 8px gap between sections (`space-y-2` on parent).
- **Sorting**: Each section has independent sort state.
- **Data fetching**: Parent polls both `api.getServerHealth()` and `api.getUploadServerHealth()` every 5 seconds in the same `useEffect`.

Upload section gets all the same UI features: unblock buttons, status badges, speed bars, etc.

**Step 2: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: PASS (existing tests should not break — ServerHealth is not directly tested)

**Step 4: Visual verification**

Run: `cd frontend && npm run dev`
Open `http://localhost:5173` and verify:
- Both sections render with collapsible headers
- Download shows all servers with existing data
- Upload shows configured upload servers (may be empty if no upload endpoints configured)
- Collapse/expand works and persists on page reload
- Tighter row spacing, cleaner look

**Step 5: Commit**

```bash
git add frontend/src/components/ServerHealth.tsx
git commit -m "feat: refactor server health into collapsible stacked sections with upload parity"
```

---

### Task 8: Build and verify end-to-end

**Files:**
- No new files

**Step 1: Run all Go tests**

Run: `go test -race ./...`
Expected: ALL PASS

**Step 2: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: ALL PASS

**Step 3: Build frontend and embed**

Run: `cd frontend && npm run build && cp -r dist ../cmd/server/frontend/dist`

**Step 4: Build Go binary**

Run: `go build -o wansaturator ./cmd/server`
Expected: Build succeeds

**Step 5: Commit any final adjustments and tag**

```bash
git add -A
git commit -m "chore: update embedded frontend build"
```
