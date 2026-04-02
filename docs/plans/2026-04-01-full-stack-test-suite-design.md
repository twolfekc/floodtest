# Full Stack Test Suite Design

## Problem

The codebase has zero automated tests. The only quality gates are compile/vet/build checks. This creates risk when adding features or refactoring — no way to know if existing behavior broke.

## Goals

1. Catch regressions when adding features
2. Enable safe refactoring with confidence
3. Gate CI merges on passing tests
4. Run fast locally for daily development

## Approach: Test Pyramid

Many fast unit tests at the base, fewer integration tests in the middle, minimal E2E at the top.

- **Tier 1 — Unit tests:** `go test ./...` (~5s). Mock external deps via `httptest` and interfaces.
- **Tier 2 — Integration tests:** `go test -tags integration ./...` (~15s). Real SQLite, wired components.
- **Tier 3 — Network tests:** `TEST_NETWORK=1` env var opt-in (~60s). Hit real speed test servers.
- **Frontend unit tests:** Vitest + React Testing Library (~10s).
- **E2E tests:** Playwright smoke tests against running binary (~30s).

## Prerequisite Refactoring

The `db` package uses a `sync.Once` singleton in `Open()`. This must be refactored to accept a path parameter so tests can create isolated temp databases. No other packages require structural changes — most already use dependency injection via interfaces or function callbacks.

## Go Unit Tests (Tier 1)

| Package | What to test | Mock strategy |
|---------|-------------|---------------|
| **config** | `New()` loads env then DB fallback; `Update()` persists; concurrent `Get()`/`Update()` safety; validation | Temp SQLite file |
| **db** | `Open()` creates schema; `GetSetting()`/`SetSetting()` round-trip; migrations idempotent | In-memory SQLite (`:memory:`) |
| **scheduler** | Schedule CRUD + validation; time-window matching (overnight, day-of-week); manual override precedence | Mock `EngineController`; temp DB |
| **stats** | Atomic byte counting; 1-second rate calculation; rolling history window; session/daily/monthly counters | Temp DB; short tick intervals |
| **throttle** | Event creation on rate drop; event resolution on recovery; threshold percentage math | Mock `RateProvider`; temp DB |
| **download** | Rate limiting via token bucket; concurrency adjustment; stats collector callbacks; server health scoring and cooldown backoff | `httptest.Server`; mock `StatsCollector` |
| **upload** | S3 client creation; rate limiting; random data sizing; cleanup on stop | `httptest.Server` as mock S3; mock `StatsCollector` |
| **updater** | Version parsing/comparison; update status state machine; Docker unavailable handling | Mock Docker client; mock GHCR HTTP |
| **api** | REST endpoint status + JSON shape; error responses; CORS headers | `httptest.Server` + `NewRouter()`; mock `App` callbacks |

Estimated: ~30-40 test functions across 9 packages.

## Go Integration Tests (Tier 2)

Tagged with `//go:build integration`:

- **API + DB + Config:** Full HTTP server with temp SQLite, settings CRUD end-to-end
- **API + Scheduler:** Create schedule via API, verify engine callbacks fire
- **API + Stats + WebSocket:** WebSocket client receives real-time rate broadcasts
- **Config + DB persistence:** Write config, create new `Config` instance on same DB, verify survival

Estimated: ~8-10 integration test functions.

## Go Network Tests (Tier 3)

Run only when `TEST_NETWORK=1`:

- Download from 2-3 real speed test servers, verify bytes > 0
- Server health scoring against known-good and known-bad URLs
- Upload to B2 (if configured), verify completion and cleanup

Estimated: ~4-5 test functions.

## Frontend Unit Tests

**Tools:** Vitest + React Testing Library + jsdom

Dependencies to add:
```json
{
  "vitest": "^3.x",
  "@testing-library/react": "^16.x",
  "@testing-library/jest-dom": "^6.x",
  "jsdom": "^25.x"
}
```

| Area | What to test |
|------|-------------|
| **Hooks** | `useWebSocket` — connect, receive, reconnect on close |
| **API client** | Each function calls correct endpoint with correct params |
| **Components** | Dashboard mode selector + start/stop; Charts with empty data; Settings form validation; Schedule day/time grid |
| **Utilities** | Byte formatting, date formatting, rate calculations |

Estimated: ~15-20 test files.

## E2E Tests (Playwright)

Start full Go binary with temp DB, run Playwright against `localhost:7860`.

Smoke tests:
1. Dashboard loads with mode selector and status
2. Start/stop toggle changes engine state
3. Settings saves and persists after reload
4. Schedule creates and displays
5. Charts renders with empty data
6. Server health shows server list
7. Updates page shows current version

## CI Integration

Add test job to `.github/workflows/build.yml`, running before Docker build/push:

```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/setup-go@v5
    - run: go test ./...
    - run: go test -tags integration ./...
    - run: cd frontend && npm ci && npx vitest run
    - run: |
        go build -o wansaturator ./cmd/server
        ./wansaturator &
        cd e2e && npx playwright install --with-deps
        npx playwright test
```

## Directory Structure

```
internal/
  config/config_test.go
  db/db_test.go
  download/engine_test.go
  download/servers_test.go
  upload/engine_test.go
  stats/collector_test.go
  throttle/detector_test.go
  scheduler/scheduler_test.go
  updater/updater_test.go
  api/handlers_test.go
  api/integration_test.go         # //go:build integration
frontend/
  vitest.config.ts
  src/__tests__/
    hooks/useWebSocket.test.ts
    api/client.test.ts
    components/Dashboard.test.tsx
    components/Settings.test.tsx
    ...
e2e/
  playwright.config.ts
  tests/
    dashboard.spec.ts
    settings.spec.ts
    schedule.spec.ts
    ...
```
