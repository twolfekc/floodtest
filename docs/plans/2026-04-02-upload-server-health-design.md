# Upload Server Health & Combined UI Design

**Date:** 2026-04-02
**Status:** Approved

## Goal

Add upload server health parity with download servers and combine both into a polished, collapsible stacked UI in the server health section.

## Scope

Three workstreams:
1. Backend — upload server speed tracking, location metadata, blocking
2. Frontend — collapsible stacked sections with shared table component, polish
3. Wiring — new API endpoints, WebSocket fields, main.go callbacks

## Backend: Upload Server Parity

### `internal/upload/upload_servers.go`

Add fields to `uploadServer` struct:
- `speedScore float64` — rolling average of last 5 speed samples
- `speedSamples []float64` — window of individual speed measurements
- `location string` — derived from URL hostname
- `blocked bool` — auto-blocks after 5 consecutive failures

Add methods to `UploadServerList`:
- `UpdateSpeedScore(url string, bps float64)` — push sample, recompute rolling average
- `UnblockServer(url string)` — clear blocked flag, reset consecutive failures
- `UnblockAll()` — unblock all servers

Update `UploadServerHealth` exported struct:
- Add `SpeedBps float64 json:"speedBps"`
- Add `Location string json:"location"`
- Add `Blocked bool json:"blocked"`

Update `HealthStatus()`:
- Compute "blocked" status when `blocked == true`
- Include speed and location in output

Bump `uploadMaxCooldown` from 5min to 10min to match downloads.

### Upload Location Derivation

Simple hostname-based mapping in `upload_servers.go`:
- Parse URL hostname, match known patterns (e.g., `s3.us-west-*` -> "US West")
- Fallback: empty string (displays as em-dash in UI)
- Applied when servers are created/updated via `NewUploadServerList()` and `UpdateServers()`

### API Additions (`internal/api/`)

New endpoints:
- `POST /api/upload-unblock` — unblock single upload server by URL
- `POST /api/upload-unblock-all` — unblock all upload servers

New `App` callback fields:
- `UnblockUploadServer func(url string)`
- `UnblockAllUploads func()`

## Frontend: Collapsible Stacked Server Health

### Component Structure

Replace `ServerHealth.tsx` monolith with:

```
ServerHealth (parent)
├── ServerSection (download, collapsible)
│   ├── Header bar: chevron + "Download Servers" + status counts + action buttons
│   └── ServerTable (shared, parameterized by column config)
└── ServerSection (upload, collapsible)
    ├── Header bar: chevron + "Upload Servers" + status counts + action buttons
    └── ServerTable (shared, parameterized by column config)
```

### Collapsible Headers

Each section header contains:
- Left: chevron icon (rotates on collapse), section title, inline counts (e.g., "42/55 healthy, 2 cooldown")
- Right: action buttons (Speed Test for download, Unblock All if any blocked)
- Click anywhere on header to toggle collapse
- Collapse state persisted in `localStorage`
- Default: both expanded

### Shared ServerTable

Single table component accepting:
- `servers: ServerHealthData[]` — the server list
- `columns: ColumnConfig[]` — which columns to render
- `type: 'download' | 'upload'` — for field name mapping (bytesDownloaded vs bytesUploaded)
- `onUnblock?: (url: string) => void` — optional unblock handler

Both tables get the same 7 columns: Server, Location, Status, Speed, Streams, Transferred, Error.

### Polish

- Tighter row padding: `py-2` instead of `py-3`
- Summary bar merged into collapsible header (no separate card)
- Error column: improved truncation with title attribute for hover tooltip
- Speed test button and Unblock All in header bar (right-aligned)
- 8px gap between download and upload sections
- Consistent border radius and styling

### API Client Updates (`frontend/src/api/client.ts`)

Add functions:
- `getUploadServerHealth(): Promise<UploadServerHealth[]>`
- `unblockUploadServer(url: string): Promise<void>`
- `unblockAllUploads(): Promise<void>`

Update `UploadServerHealth` TypeScript interface:
- Add `location: string`
- Add `speedBps: number`
- Add `blocked: boolean`

### Data Fetching

Single `ServerHealth` component polls both endpoints on 5-second interval.

## Wiring: main.go & WebSocket

### `cmd/server/main.go`

Wire new callbacks:
```go
UnblockUploadServer: func(url string) { uploadServerList.UnblockServer(url) },
UnblockAllUploads:   func() { uploadServerList.UnblockAll() },
```

Add to WebSocket broadcast:
```go
HealthyUploadServers: uploadServerList.HealthyCount(),
TotalUploadServers:   uploadServerList.TotalCount(),
```

### `internal/api/websocket.go`

Add fields to `WsMessage`:
- `HealthyUploadServers int json:"healthyUploadServers"`
- `TotalUploadServers int json:"totalUploadServers"`

### `internal/api/router.go`

Register routes:
- `POST /api/upload-unblock` -> `HandleUnblockUploadServer`
- `POST /api/upload-unblock-all` -> `HandleUnblockAllUploads`

## Out of Scope

- Speed test for upload servers (future enhancement)
- Weighted server selection for uploads (future, currently round-robin)
- Changes to download server code
- DB schema changes
- Dashboard layout changes beyond the server health section
