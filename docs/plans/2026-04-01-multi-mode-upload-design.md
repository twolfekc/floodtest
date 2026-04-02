# Multi-Mode Upload Engine

**Date:** 2026-04-01
**Goal:** Replace B2-only upload with a multi-mode engine supporting free HTTP discard endpoints, S3-compatible storage, and local discard — eliminating the need for paid cloud storage for upload bandwidth testing.

## Upload Modes

| Mode | How it works | Account needed? | Best for |
|------|-------------|-----------------|----------|
| **HTTP Discard** | POST to speed test endpoints (Cloudflare, Tele2, custom) | No | Free WAN upload testing |
| **S3-Compatible** | S3 PUT/DELETE to any endpoint (B2, R2, MinIO) | Yes | Users with cloud accounts |
| **Local Discard** | POST to app's own `/api/upload-sink` | No | Engine testing only |

## 1. HTTP Discard Mode

### Upload Endpoints (built-in defaults)

- `https://speed.cloudflare.com/__up` — Anycast, hits nearest Cloudflare PoP, no auth, 100MB max per request
- `http://speedtest.tele2.net/upload.php` — EU-based, 10Gbps, no auth, no documented size limit
- Custom URLs configurable by user via Settings UI

### How It Works

- Round-robin across endpoints with health tracking (same pattern as download `ServerList`)
- Each stream goroutine: generate random data in an `io.Pipe`, HTTP POST to endpoint, count bytes via `CountingReader`
- Default chunk size: 50MB (balances connection overhead vs Cloudflare's 100MB limit)
- No delete step — endpoints discard the data
- On error (non-2xx response, timeout, connection refused): mark endpoint unhealthy with same cooldown/backoff logic as download servers
- All existing stats, auto-adjust, rate limiting, WebSocket broadcasting reused

### Upload Endpoint List

Managed by a new `UploadServerList` struct (or reuse the existing `ServerList` from the download package by extracting it into a shared package or making it generic enough). Tracks health, speed scores, active streams per endpoint.

## 2. S3-Compatible Mode

- Rename current B2-specific code to generic S3-compatible mode
- Works with B2, Cloudflare R2, MinIO, or any S3-compatible endpoint
- User enters: endpoint URL, key ID, app key, bucket name
- Existing upload/delete cycle preserved
- Existing cleanup logic preserved

## 3. Local Discard Mode

- `POST /api/upload-sink` handler on the existing app server
- Reads entire request body with `io.Copy(io.Discard, r.Body)`, returns 200 OK
- ~10 lines of code in `internal/api/`
- Endpoint automatically set to `http://localhost:{port}/api/upload-sink`
- Only useful for testing the engine itself, not real WAN bandwidth

## 4. Backend Changes

### New file: `internal/upload/http_engine.go`

HTTP-based upload engine for discard mode. Parallel goroutines generating random data and POSTing to endpoints.

- Reuses `CountingReader` from existing `engine.go`
- Reuses `io.Pipe` + `crypto/rand` pattern from existing `engine.go`
- Has its own `uploadLoop` that does plain HTTP POST instead of S3 PutObject
- Shares the `StatsCollector` interface, auto-adjust, rate limiting patterns

### New file: `internal/upload/upload_servers.go`

Upload endpoint list with health tracking. Similar to `download/servers.go` but simpler (no speed scoring needed initially — just health tracking and round-robin).

- `UploadServerList` struct with `Next()`, `MarkUnhealthy()`, `MarkSuccess()`, `HealthStatus()`
- Default endpoints: Cloudflare `__up`, Tele2

### Modified: `internal/upload/engine.go`

- Add `Mode` field: `"s3"`, `"http"`, `"local"`
- `Start()` dispatches to appropriate upload loop based on mode
- S3 mode: existing behavior unchanged
- HTTP/local mode: use new HTTP upload loop
- Expose upload server health for API

### Modified: `internal/api/router.go`

- Add `POST /api/upload-sink` — discard endpoint
- Add `GET /api/upload-server-health` — upload endpoint health (for HTTP mode)

### Modified: `internal/api/handlers.go`

- `HandleUploadSink` — reads and discards body
- `HandleUploadServerHealth` — returns upload endpoint health status

### Modified: `internal/api/app.go`

- Add `GetUploadServerHealth` callback

### Modified: `internal/config/config.go`

- Add `UploadMode string` field (default: `"s3"` for backward compat)
- Add `UploadEndpoints []string` field (for HTTP discard mode)
- Add `UploadChunkSizeBytes int64` field (for HTTP mode, default 50MB)
- Persist/load from DB

### Modified: `cmd/server/main.go`

- Pass upload mode to engine
- Wire upload server health callback
- Wire upload endpoint list

## 5. Frontend Changes

### Settings Page

- Add "Upload Mode" dropdown: S3-Compatible / HTTP Discard / Local Discard
- When S3-Compatible: show existing B2/S3 credential fields (relabel from "Backblaze B2" to "S3-Compatible Storage")
- When HTTP Discard: show upload endpoint list (editable textarea or list, like download servers)
- When Local Discard: show info text "Uploads to this app's built-in discard endpoint. Does not test WAN bandwidth."
- Hide irrelevant fields based on mode (e.g., hide S3 credentials in discard mode)

### Dashboard

- Upload server health visible when in HTTP discard mode (similar to download server health)
- Or add upload endpoint info to existing server health section

### API Client

- Update Settings interface with new fields
- Add `getUploadServerHealth()` method

## 6. Data Flow

```
Settings UI → UploadMode config → Engine.Start() dispatches by mode:

S3 Mode:       generate random → S3 PutObject → DeleteObject → stats
HTTP Mode:     generate random → HTTP POST to endpoint list → stats  
Local Mode:    generate random → HTTP POST to /api/upload-sink → stats
```

All modes feed into the same `StatsCollector.AddUploadBytes()` pipeline, so dashboard, charts, WebSocket broadcasting, and throttle detection work identically regardless of mode.
