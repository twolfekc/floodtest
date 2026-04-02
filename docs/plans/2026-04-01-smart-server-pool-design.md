# Smart Server Pool + Speed Test with UI

**Date:** 2026-04-01
**Goal:** Reliable 1-2 Gbps download throughput from US Central on a 5 Gbps symmetric connection. Eliminate timeout churn, add visibility into server performance.

## 1. Expanded Server Pool (~40-50 servers)

**Remove/deprioritize:** Tiny files (CacheFly 200MB), geographically distant servers (Singapore, Sydney, Tokyo) that won't contribute meaningful throughput from US Central.

**Add:** Large-file sources with good US Central peering:
- OVH US/CA speed tests
- Linode/Akamai speed tests (multiple US regions)
- DigitalOcean speed tests
- Cloudflare speed test endpoint
- Leaseweb US
- Additional Hetzner US locations
- Target 10GB files where available, 1GB minimum

Servers tagged with location metadata (region string) for UI display.

## 2. Server Speed Scoring

- Each server maintains a rolling average throughput score (last 5 downloads).
- Streams assigned proportionally to score — a 500 Mbps server gets ~5x streams vs a 100 Mbps server.
- Scores persist in SQLite across restarts.
- Periodic rebalancing: every 30 seconds, check if stream allocation still matches score distribution.

## 3. Startup Speed Test

- On engine start (or on-demand via API), probe all servers in parallel.
- Each probe: download ~10MB, measure throughput, timeout after 15 seconds.
- Results rank servers and seed initial scores.
- Servers that fail the probe start in cooldown.
- Takes ~10-15 seconds total (parallel).
- Progress broadcast via WebSocket for UI.

## 4. Improved Cooldowns

- Initial cooldown: 30 seconds (down from 5 minutes).
- Backoff: 30s -> 1m -> 2m -> 5m -> 10m (cap, down from 30m).
- Recovery probe: when cooldown expires, run a small test download before assigning full streams.
- Faster recovery means servers come back into rotation sooner after transient issues.

## 5. UI — Server Health Dashboard

### During Speed Test
- Progress indicator: "Testing servers... 23/47 complete"
- Each server shows live speed result as it completes
- "Run Speed Test" button to trigger on-demand

### Server Table (enhanced)
- Columns: Server (truncated URL), Location, Status (healthy/cooldown/testing), Speed Score (Mbps), Active Streams, Data Downloaded, Last Error
- Color-coded rows: green (healthy+fast), yellow (healthy+slow), orange (cooldown), red (failed)
- Sortable by any column
- Speed score shown as inline horizontal bar

### Summary Stats (top of page)
- Total servers / Healthy / In cooldown / Failed
- Aggregate throughput from active servers
- "Run Speed Test" button with last-run timestamp

### Real-time Updates
- Existing WebSocket broadcasts extended with per-server speed scores and test progress.

## 6. API Changes

- `GET /api/server-health` — extended with speed scores, location, active stream count per server
- `POST /api/speed-test` — trigger on-demand speed test, returns results
- WebSocket messages gain `SpeedTestProgress` and per-server `SpeedScore` fields

## 7. Data Flow

```
Engine Start -> Speed Test (parallel probes) -> Rank servers -> Assign streams weighted by score
                    |
              WebSocket -> UI shows progress + results
                    |
         Running -> Track per-server throughput -> Update scores -> Rebalance streams periodically
                    |
              WebSocket -> UI shows live per-server stats
```

## 8. Backend Changes Summary

| Package | Changes |
|---------|---------|
| `download/servers.go` | Add location metadata, speed scores, weighted selection, score persistence |
| `download/engine.go` | Speed test orchestration, weighted stream assignment, rebalancing loop |
| `download/speedtest.go` | New file: parallel probe logic, progress callbacks |
| `config/config.go` | No changes needed — servers already configurable via DB |
| `api/handlers.go` | Extended health response, new speed-test endpoint |
| `api/app.go` | Wire new speed-test callback |
| `stats/collector.go` | No changes — existing byte tracking sufficient |
| `cmd/server/main.go` | Wire speed test callback, pass WebSocket broadcaster |

## 9. Frontend Changes Summary

| File | Changes |
|------|---------|
| `api/client.ts` | Add `runSpeedTest()`, update `ServerHealth` type |
| `pages/ServerHealth.tsx` | Enhanced table, summary stats, speed test button, progress UI |
| `hooks/useWebSocket.ts` | Handle new `SpeedTestProgress` and `SpeedScore` message fields |
