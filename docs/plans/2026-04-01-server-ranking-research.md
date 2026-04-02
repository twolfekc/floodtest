# Automated Speed Test Server Ranking System

**Date:** 2026-04-01
**Status:** Research & Design
**Goal:** Build a self-tuning server ranking system that continuously measures, scores, and allocates download streams to maximize aggregate throughput while being a good citizen on public infrastructure.

---

## Table of Contents

1. [Discovered Server Inventory](#1-discovered-server-inventory)
2. [Ranking Algorithm Design](#2-ranking-algorithm-design)
3. [Per-Server Rate Limiting & Citizenship Controls](#3-per-server-rate-limiting--citizenship-controls)
4. [Server Health Dashboard Metrics](#4-server-health-dashboard-metrics)
5. [Codebase Changes](#5-codebase-changes)
6. [Migration Path](#6-migration-path)

---

## 1. Discovered Server Inventory

### 1.1 Current Servers (Already in DefaultServerEntries)

The codebase has 53 servers across Hetzner, OVH, Leaseweb, Vultr, Linode, Clouvider, FDCservers, WorldStream, ThinkBroadband, BuyVM, RackNerd, and WebNX. Of these, **24 are US-based** and **29 are EU/international**.

### 1.2 New Servers to Add

The following servers were discovered through research and are not in the current list. Each has been verified as a publicly documented speed test endpoint.

#### Tier 1 -- US Servers (High Priority)

| # | Provider | URL | Location | File Size | Notes |
|---|----------|-----|----------|-----------|-------|
| 1 | Hetzner | `https://hil-speed.hetzner.com/10GB.bin` | Hillsboro, OR, US | 10 GB | New US West location |
| 2 | Vultr | `http://sjo-ca-us-ping.vultr.com/vultr.com.1000MB.bin` | San Jose, CA, US | 1 GB | Silicon Valley PoP |
| 3 | DigitalOcean | `http://speedtest-nyc1.digitalocean.com/5gb.test` | New York, NY, US | 5 GB | NYC region 1 |
| 4 | DigitalOcean | `http://speedtest-nyc3.digitalocean.com/5gb.test` | New York, NY, US | 5 GB | NYC region 3 |
| 5 | DigitalOcean | `http://speedtest-sfo3.digitalocean.com/5gb.test` | San Francisco, CA, US | 5 GB | SFO region 3 |
| 6 | DataPacket | `http://nyc.download.datapacket.com/10000mb.bin` | New York, NY, US | 10 GB | 10Gbps network |
| 7 | DataPacket | `http://chi.download.datapacket.com/10000mb.bin` | Chicago, IL, US | 10 GB | 10Gbps network |
| 8 | DataPacket | `http://dal.download.datapacket.com/10000mb.bin` | Dallas, TX, US | 10 GB | 10Gbps network |
| 9 | DataPacket | `http://den.download.datapacket.com/10000mb.bin` | Denver, CO, US | 10 GB | 10Gbps network |
| 10 | DataPacket | `http://lax.download.datapacket.com/10000mb.bin` | Los Angeles, CA, US | 10 GB | 10Gbps network |
| 11 | DataPacket | `http://mia.download.datapacket.com/10000mb.bin` | Miami, FL, US | 10 GB | 10Gbps network |
| 12 | DataPacket | `http://sea.download.datapacket.com/10000mb.bin` | Seattle, WA, US | 10 GB | 10Gbps network |
| 13 | DataPacket | `http://ash.download.datapacket.com/10000mb.bin` | Ashburn, VA, US | 10 GB | 10Gbps network |
| 14 | DataPacket | `http://atl.download.datapacket.com/10000mb.bin` | Atlanta, GA, US | 10 GB | 10Gbps network |
| 15 | DataPacket | `http://hou.download.datapacket.com/10000mb.bin` | Houston, TX, US | 10 GB | 10Gbps network |
| 16 | DataPacket | `http://sjc.download.datapacket.com/10000mb.bin` | San Jose, CA, US | 10 GB | 10Gbps network |
| 17 | FDCservers | `http://lg.mia.fdcservers.net/10GBtest.zip` | Miami, FL, US | 10 GB | Additional FDC PoP |
| 18 | FDCservers | `http://lg.ny.fdcservers.net/10GBtest.zip` | New York, NY, US | 10 GB | Additional FDC PoP |
| 19 | FDCservers | `http://lg.la.fdcservers.net/10GBtest.zip` | Los Angeles, CA, US | 10 GB | Additional FDC PoP |
| 20 | FDCservers | `http://lg.sea.fdcservers.net/10GBtest.zip` | Seattle, WA, US | 10 GB | Additional FDC PoP |
| 21 | Softlayer/IBM | `http://speedtest.wdc01.softlayer.com/downloads/test10000.zip` | Washington DC, US | 10 GB | Legacy IBM Cloud |
| 22 | Softlayer/IBM | `http://speedtest.sjc01.softlayer.com/downloads/test10000.zip` | San Jose, CA, US | 10 GB | Legacy IBM Cloud |
| 23 | LAX-NOC | `http://repos.lax-noc.com/speedtests/100gb.bin` | Los Angeles, CA, US | 100 GB | Very large file, good for sustained tests |
| 24 | LAX-NOC | `http://repos.mia.lax-noc.com/speedtests/100gb.bin` | Miami, FL, US | 100 GB | Very large file |
| 25 | RackNerd | `https://lg-sea.racknerd.com/test_files/1GB.test` | Seattle, WA, US | 1 GB | Additional RackNerd PoP |
| 26 | RackNerd | `https://lg-atl.racknerd.com/test_files/1GB.test` | Atlanta, GA, US | 1 GB | Additional RackNerd PoP |
| 27 | RackNerd | `https://lg-ash.racknerd.com/test_files/1GB.test` | Ashburn, VA, US | 1 GB | Additional RackNerd PoP |

#### Tier 2 -- Canada Servers

| # | Provider | URL | Location | File Size | Notes |
|---|----------|-----|----------|-----------|-------|
| 28 | OVH | `http://proof.ovh.ca/files/10Gio.dat` | Beauharnois, QC, CA | 10 GB | Good for US Central routing |
| 29 | DataPacket | `http://mon.download.datapacket.com/10000mb.bin` | Montreal, QC, CA | 10 GB | 10Gbps network |
| 30 | DataPacket | `http://tor.download.datapacket.com/10000mb.bin` | Toronto, ON, CA | 10 GB | 10Gbps network |
| 31 | DataPacket | `http://van.download.datapacket.com/10000mb.bin` | Vancouver, BC, CA | 10 GB | 10Gbps network |
| 32 | FDCservers | `http://lg.tor.fdcservers.net/10GBtest.zip` | Toronto, ON, CA | 10 GB | FDC Toronto PoP |

#### Tier 3 -- EU Servers (Lower Priority from US Central)

| # | Provider | URL | Location | File Size | Notes |
|---|----------|-----|----------|-----------|-------|
| 33 | DataPacket | `http://lon.download.datapacket.com/10000mb.bin` | London, UK | 10 GB | 10Gbps network |
| 34 | DataPacket | `http://fra.download.datapacket.com/10000mb.bin` | Frankfurt, DE | 10 GB | 10Gbps network |
| 35 | DataPacket | `http://par.download.datapacket.com/10000mb.bin` | Paris, FR | 10 GB | 10Gbps network |
| 36 | DataPacket | `http://ams.download.datapacket.com/10000mb.bin` | Amsterdam, NL | 10 GB | 10Gbps network |
| 37 | DataPacket | `http://mad.download.datapacket.com/10000mb.bin` | Madrid, ES | 10 GB | 10Gbps network |
| 38 | OVH | `http://sbg.proof.ovh.net/files/10Gio.dat` | Strasbourg, FR | 10 GB | OVH SBG datacenter |
| 39 | OVH | `http://bhs.proof.ovh.net/files/10Gio.dat` | Beauharnois, QC (via FR net) | 10 GB | OVH BHS datacenter |
| 40 | XS4ALL | `http://download.xs4all.nl/test/10GB.bin` | Netherlands | 10 GB | Major Dutch ISP |
| 41 | AltusHost | `http://nl.altushost.com/10gb.test` | Netherlands | 10 GB | NL hosting provider |
| 42 | Hetzner | `https://sin-speed.hetzner.com/10GB.bin` | Singapore, SG | 10 GB | Asia-Pacific PoP |
| 43 | FDCservers | `http://lg.ams.fdcservers.net/10GBtest.zip` | Amsterdam, NL | 10 GB | FDC EU PoP |
| 44 | Vultr | `http://hnd-jp-ping.vultr.com/vultr.com.1000MB.bin` | Tokyo, JP | 1 GB | Asia-Pacific comparison |

### 1.3 Combined Server Count

| Region | Current | New | Total |
|--------|---------|-----|-------|
| US | 24 | 27 | 51 |
| Canada | 0 | 5 | 5 |
| Europe | 26 | 10 | 36 |
| Asia-Pacific | 0 | 2 | 2 |
| **Total** | **53** (some duplicated) | **44** | **~94** (after dedup) |

### 1.4 Server Quality Tiers

For allocation purposes, servers should be classified by file size and expected reliability:

| Tier | File Size | Behavior | Examples |
|------|-----------|----------|----------|
| **A -- Large Files** | >= 10 GB | Best for sustained throughput. A single stream can run for minutes. | Hetzner, Leaseweb, DataPacket, OVH, Clouvider, FDCservers |
| **B -- Medium Files** | 1-5 GB | Good throughput but requires reconnection every 30-90s at high speed. | Vultr (1 GB), RackNerd (1 GB), BuyVM, DigitalOcean (5 GB) |
| **C -- Small Files** | 100 MB | Frequent reconnection overhead. Only useful as probe targets or low-bandwidth fill. | Linode (100 MB) |

The engine should prefer Tier A servers for primary stream allocation and use Tier B/C servers as supplementary capacity or for probing.

---

## 2. Ranking Algorithm Design

### 2.1 Core Concept: Exponential Weighted Moving Average (EWMA) with Reliability Multiplier

Each server maintains a **composite score** that combines throughput measurement with reliability history. Streams are allocated proportionally to scores.

### 2.2 Data Model

```go
type ServerScore struct {
    // Throughput tracking
    ThroughputSamples []ThroughputSample // ring buffer, last N samples
    EWMAThroughput    float64            // exponentially weighted moving average (bps)

    // Reliability tracking
    SuccessCount      int64
    FailureCount      int64
    ConsecutiveFails  int
    LastSuccessTime   time.Time
    LastFailureTime   time.Time

    // Composite
    CompositeScore    float64  // final score used for stream allocation
    Tier              string   // "A", "B", "C" based on file size
    Region            string   // "us-east", "us-west", "us-central", "eu", "apac"

    // Persistence
    LastUpdated       time.Time
}

type ThroughputSample struct {
    Timestamp  time.Time
    BytesPerSec int64
    Duration   time.Duration  // how long this measurement ran
}
```

### 2.3 Throughput Scoring: EWMA with Time Decay

The EWMA gives recent measurements exponentially more weight than older ones.

```
Algorithm: UpdateThroughput(server, newSampleBps)

    alpha = 0.3  // smoothing factor (higher = more weight to recent)

    if server.EWMAThroughput == 0:
        server.EWMAThroughput = newSampleBps  // bootstrap
    else:
        server.EWMAThroughput = alpha * newSampleBps + (1 - alpha) * server.EWMAThroughput

    // Apply time-based decay: if no measurement in >5 minutes, decay toward zero
    timeSinceLastSample = now() - server.LastUpdated
    if timeSinceLastSample > 5m:
        decayFactor = exp(-timeSinceLastSample.Minutes() / 30.0)  // half-life of ~20 min
        server.EWMAThroughput *= decayFactor
```

**Why alpha = 0.3?**
- After 5 samples, the oldest sample contributes only ~17% weight.
- A sudden drop in server performance is reflected within 2-3 measurements.
- Temporary spikes don't over-promote a server after a single good run.

### 2.4 Reliability Multiplier

Reliability is a value between 0.0 and 1.0 that penalizes servers with high failure rates.

```
Algorithm: ReliabilityMultiplier(server)

    totalAttempts = server.SuccessCount + server.FailureCount
    if totalAttempts < 3:
        return 1.0  // not enough data, assume reliable

    successRate = server.SuccessCount / totalAttempts

    // Weighted success rate: recent failures count more
    consecutivePenalty = 1.0
    if server.ConsecutiveFails > 0:
        consecutivePenalty = 1.0 / (1.0 + float64(server.ConsecutiveFails) * 0.5)
        // 1 fail: 0.67, 2 fails: 0.50, 3 fails: 0.40, 5 fails: 0.29

    return successRate * consecutivePenalty
```

### 2.5 Composite Score Calculation

```
Algorithm: CompositeScore(server)

    throughput   = server.EWMAThroughput
    reliability  = ReliabilityMultiplier(server)
    tierBonus    = TierBonus(server.Tier)
    regionBonus  = RegionBonus(server.Region, userRegion)

    server.CompositeScore = throughput * reliability * tierBonus * regionBonus
```

**Tier Bonus** (prefer large files to minimize reconnection overhead):

| Tier | Bonus |
|------|-------|
| A (>= 10 GB) | 1.2 |
| B (1-5 GB) | 1.0 |
| C (< 1 GB) | 0.7 |

**Region Bonus** (prefer geographically closer servers -- for US Central user):

| Server Region | Bonus |
|---------------|-------|
| US Central (Chicago, Dallas, Denver, Houston) | 1.3 |
| US East (Ashburn, NYC, Atlanta, Miami, Newark) | 1.1 |
| US West (LAX, SFO, SJC, Seattle, Hillsboro) | 1.0 |
| Canada (Toronto, Montreal, Vancouver) | 0.9 |
| EU (London, Amsterdam, Frankfurt, Paris) | 0.6 |
| Asia-Pacific (Singapore, Tokyo) | 0.3 |

### 2.6 Stream Allocation Algorithm

Given N total desired streams, allocate proportionally to composite scores.

```
Algorithm: AllocateStreams(servers, totalStreams)

    // Filter to eligible servers (not blocked, not in cooldown)
    eligible = servers.filter(s => s.isAvailable())

    if len(eligible) == 0:
        return  // no servers available

    // Calculate total score
    totalScore = sum(s.CompositeScore for s in eligible)

    if totalScore == 0:
        // No scores yet (cold start). Distribute evenly.
        perServer = totalStreams / len(eligible)
        for each server:
            server.AllocatedStreams = perServer
        return

    // Proportional allocation with minimum of 1 stream per eligible server
    for each server in eligible:
        fraction = server.CompositeScore / totalScore
        server.AllocatedStreams = max(1, round(fraction * totalStreams))

    // Enforce per-server stream cap
    for each server in eligible:
        server.AllocatedStreams = min(server.AllocatedStreams, server.MaxStreams)

    // Enforce global stream cap
    while sum(AllocatedStreams) > totalStreams:
        // Remove stream from server with lowest score per stream
        worst = argmin(s.CompositeScore / s.AllocatedStreams for s in eligible if s.AllocatedStreams > 1)
        worst.AllocatedStreams -= 1
```

### 2.7 Rebalancing Loop

Every 30 seconds, the engine re-evaluates stream allocation:

```
Algorithm: RebalanceLoop()

    ticker = every 30 seconds

    on tick:
        scores = getCurrentScores()
        desired = AllocateStreams(scores, targetConcurrency)
        current = getCurrentStreamCounts()

        for each server:
            diff = desired[server] - current[server]
            if diff > 0:
                // Need more streams to this server
                for i = 0; i < diff; i++:
                    launchStream(server)
            elif diff < -1:
                // Too many streams; let excess drain naturally on EOF
                // (don't kill active downloads -- just don't replace them)
                server.DrainCount = abs(diff)
```

### 2.8 Startup Probe (Speed Test)

On engine start (or on-demand via API), probe all servers in parallel to seed initial scores.

```
Algorithm: StartupProbe(servers)

    results = parallelMap(servers, concurrency=20):
        for each server:
            start = now()
            bytes = downloadWithTimeout(server.URL, timeout=15s, maxBytes=50MB)
            elapsed = since(start)
            if err:
                server.MarkFailed()
                return {server, bps: 0, err: err}
            bps = bytes * 8 / elapsed.Seconds()
            return {server, bps: bps, err: nil}

    // Seed EWMA from probe results
    for each result:
        if result.err == nil:
            result.server.EWMAThroughput = result.bps
            result.server.CompositeScore = CompositeScore(result.server)
        else:
            result.server.EWMAThroughput = 0
            // Server enters cooldown

    // Sort by score descending for initial stream allocation
    sort(servers, by=CompositeScore, desc)
    AllocateStreams(servers, targetConcurrency)
```

### 2.9 Demotion and Promotion Thresholds

Servers are never fully removed from the pool (unless manually blocked by the user). Instead, they move between states:

| State | Meaning | Streams Allocated |
|-------|---------|-------------------|
| **Active** | Healthy, good throughput | Proportional to score |
| **Probation** | Below threshold or recent failures | 1 stream (monitoring) |
| **Cooldown** | Failed, waiting for backoff timer | 0 streams |
| **Blocked** | Manually blocked by user | 0 streams |

**Demotion triggers** (Active -> Probation):
- EWMA throughput drops below 10% of the pool's median throughput
- Success rate drops below 50% over last 20 attempts
- 3 consecutive failures

**Promotion triggers** (Probation -> Active):
- 3 consecutive successes
- EWMA throughput recovers above 25% of pool median
- Both conditions must be met

**Cooldown entry** (any -> Cooldown):
- 5 consecutive failures (same as current behavior)
- Exponential backoff: 30s, 60s, 120s, 5m, 10m (cap)

**Cooldown exit** (Cooldown -> Probation):
- Backoff timer expires
- Server enters Probation with 1 monitoring stream, not directly Active

---

## 3. Per-Server Rate Limiting & Citizenship Controls

### 3.1 Design Philosophy

Public speed test servers are a shared resource. The tool should:
1. Spread load across many servers (no single server takes more than ~10% of total bandwidth)
2. Cap per-server bandwidth to avoid triggering provider abuse detection
3. Respect implicit rate limits (429 responses, connection drops)
4. Use large files to minimize connection overhead (fewer TCP handshakes)

### 3.2 Per-Server Stream Caps

```go
type ServerLimits struct {
    MaxConcurrentStreams int           // hard cap on parallel downloads
    MaxBandwidthBps     int64         // per-server bandwidth cap (0 = unlimited)
    MinInterRequestGap  time.Duration // minimum time between starting new requests
    CooldownEscalation  []time.Duration // backoff sequence on failure
}

// Default limits by provider
var ProviderDefaults = map[string]ServerLimits{
    "hetzner":     {MaxConcurrentStreams: 4, MaxBandwidthBps: 0, MinInterRequestGap: 0},
    "leaseweb":    {MaxConcurrentStreams: 4, MaxBandwidthBps: 0, MinInterRequestGap: 0},
    "ovh":         {MaxConcurrentStreams: 3, MaxBandwidthBps: 0, MinInterRequestGap: 0},
    "datapacket":  {MaxConcurrentStreams: 3, MaxBandwidthBps: 0, MinInterRequestGap: 0},
    "vultr":       {MaxConcurrentStreams: 2, MaxBandwidthBps: 500_000_000, MinInterRequestGap: 1 * time.Second},
    "linode":      {MaxConcurrentStreams: 2, MaxBandwidthBps: 500_000_000, MinInterRequestGap: 1 * time.Second},
    "digitalocean":{MaxConcurrentStreams: 2, MaxBandwidthBps: 500_000_000, MinInterRequestGap: 1 * time.Second},
    "clouvider":   {MaxConcurrentStreams: 3, MaxBandwidthBps: 0, MinInterRequestGap: 0},
    "fdcservers":  {MaxConcurrentStreams: 3, MaxBandwidthBps: 0, MinInterRequestGap: 0},
    "racknerd":    {MaxConcurrentStreams: 2, MaxBandwidthBps: 500_000_000, MinInterRequestGap: 2 * time.Second},
    "buyvm":       {MaxConcurrentStreams: 2, MaxBandwidthBps: 500_000_000, MinInterRequestGap: 2 * time.Second},
    "softlayer":   {MaxConcurrentStreams: 2, MaxBandwidthBps: 500_000_000, MinInterRequestGap: 1 * time.Second},
    "default":     {MaxConcurrentStreams: 2, MaxBandwidthBps: 300_000_000, MinInterRequestGap: 2 * time.Second},
}
```

### 3.3 Global Citizenship Constraints

| Constraint | Value | Rationale |
|-----------|-------|-----------|
| Max streams per server | 4 (configurable) | Prevent monopolizing any single server |
| Max % of total bandwidth per server | 15% | Force distribution across pool |
| Max total streams | 64 (existing) | CPU/memory bound |
| Min servers in active use | 5 | Ensure distribution even at low concurrency |
| Request User-Agent | `WanSaturator/1.0 (bandwidth-test)` | Identify traffic for server operators |

### 3.4 Cooldown Escalation (Updated)

Current system: 30s base, 2x multiplier, 10m cap, auto-block at 5 consecutive failures.

Proposed refinement:

```
Failure 1:  30s cooldown
Failure 2:  60s cooldown
Failure 3:  2m cooldown  + move to Probation
Failure 4:  5m cooldown
Failure 5:  10m cooldown + auto-block (existing behavior)

On success after cooldown:
  - Reset consecutive failure count
  - Stay in Probation (1 stream) for 3 successful downloads
  - Then promote back to Active
```

### 3.5 Adaptive Rate Detection

If a server responds with:
- **HTTP 429 (Too Many Requests)**: Immediately halve MaxConcurrentStreams for that server, enter 5m cooldown
- **HTTP 503 (Service Unavailable)**: Enter cooldown, keep limits
- **Connection reset / timeout**: Normal failure path
- **Slow throughput** (< 1 Mbps sustained for 30s): Abort download, count as failure, suggest server may be throttling

### 3.6 Provider Identification

Map server URLs to providers for applying per-provider defaults:

```go
func identifyProvider(url string) string {
    host := extractHost(url)
    providerPatterns := map[string][]string{
        "hetzner":      {"hetzner.com", "hetzner.de"},
        "leaseweb":     {"leaseweb.net"},
        "ovh":          {"ovh.net", "ovh.ca"},
        "datapacket":   {"datapacket.com"},
        "vultr":        {"vultr.com"},
        "linode":       {"linode.com"},
        "digitalocean": {"digitalocean.com"},
        "clouvider":    {"clouvider.net"},
        "fdcservers":   {"fdcservers.net"},
        "racknerd":     {"racknerd.com"},
        "buyvm":        {"buyvm.net"},
        "softlayer":    {"softlayer.com"},
        "webnx":        {"webnx.com"},
        "tele2":        {"tele2.net"},
        "worldstream":  {"worldstream.nl"},
        "thinkbroadband":{"thinkbroadband.com"},
    }
    for provider, patterns := range providerPatterns {
        for _, pattern := range patterns {
            if strings.Contains(host, pattern) {
                return provider
            }
        }
    }
    return "default"
}
```

---

## 4. Server Health Dashboard Metrics

### 4.1 Per-Server Metrics (API Response)

```go
type ServerHealthExtended struct {
    // Existing fields (from current ServerHealth)
    URL                 string    `json:"url"`
    Location            string    `json:"location"`
    Healthy             bool      `json:"healthy"`
    Blocked             bool      `json:"blocked"`
    ConsecutiveFailures int       `json:"consecutiveFailures"`
    TotalFailures       int       `json:"totalFailures"`
    TotalDownloads      int       `json:"totalDownloads"`
    LastError           string    `json:"lastError,omitempty"`
    LastErrorTime       time.Time `json:"lastErrorTime,omitempty"`
    UnhealthyUntil      time.Time `json:"unhealthyUntil,omitempty"`
    BytesDownloaded     int64     `json:"bytesDownloaded"`
    SpeedBps            int64     `json:"speedBps"`
    ActiveStreams        int       `json:"activeStreams"`
    Status              string    `json:"status"`

    // NEW: Ranking fields
    Provider            string    `json:"provider"`           // "hetzner", "vultr", etc.
    Region              string    `json:"region"`             // "us-central", "eu", etc.
    Tier                string    `json:"tier"`               // "A", "B", "C"
    FileSizeBytes       int64     `json:"fileSizeBytes"`      // test file size

    EWMAThroughputBps   int64     `json:"ewmaThroughputBps"`  // smoothed throughput
    CompositeScore      float64   `json:"compositeScore"`     // final ranking score
    ReliabilityPct      float64   `json:"reliabilityPct"`     // 0-100
    AllocatedStreams    int       `json:"allocatedStreams"`    // how many streams assigned
    MaxStreams          int       `json:"maxStreams"`          // per-server cap

    RankPosition        int       `json:"rankPosition"`       // 1 = best server
    State               string    `json:"state"`              // "active", "probation", "cooldown", "blocked"

    ProbeSpeedBps       int64     `json:"probeSpeedBps,omitempty"`   // last startup probe result
    ProbeTime           time.Time `json:"probeTime,omitempty"`       // when probe was run
}
```

### 4.2 Pool Summary Metrics

```go
type PoolSummary struct {
    TotalServers    int     `json:"totalServers"`
    ActiveServers   int     `json:"activeServers"`
    ProbationServers int    `json:"probationServers"`
    CooldownServers int     `json:"cooldownServers"`
    BlockedServers  int     `json:"blockedServers"`

    TotalStreams     int     `json:"totalStreams"`
    TargetStreams    int     `json:"targetStreams"`

    TopServerURL    string  `json:"topServerUrl"`
    TopServerBps    int64   `json:"topServerBps"`
    MedianBps       int64   `json:"medianBps"`
    AggregateBps    int64   `json:"aggregateBps"`

    LastProbeTime   time.Time `json:"lastProbeTime,omitempty"`
    ProbeRunning    bool      `json:"probeRunning"`
}
```

### 4.3 UI Enhancements

**Pool Summary Bar** (top of Server Health page):
- Total / Active / Probation / Cooldown / Blocked counts
- Aggregate throughput from all servers
- "Run Speed Test" button with spinner and progress
- Last probe timestamp

**Server Table Columns** (sortable):
1. Rank (#)
2. Status indicator (colored dot: green/yellow/orange/red)
3. Server URL (truncated, tooltip for full)
4. Provider
5. Location
6. Tier (A/B/C)
7. EWMA Speed (Mbps) -- with inline bar chart
8. Reliability (%)
9. Composite Score
10. Active / Allocated Streams
11. Total Downloaded (GB)
12. Actions (Block/Unblock, Force Probe)

**Color Coding:**
- Green: Active, score > pool median
- Yellow: Active, score < pool median
- Orange: Probation
- Red: Cooldown
- Gray: Blocked

**Sort Defaults:** By Composite Score descending (best servers first)

---

## 5. Codebase Changes

### 5.1 New Files

| File | Purpose |
|------|---------|
| `internal/download/ranking.go` | EWMA scoring, composite score calculation, stream allocation algorithm |
| `internal/download/probe.go` | Startup and on-demand speed probe logic with progress callbacks |
| `internal/download/providers.go` | Provider identification and per-provider default limits |
| `frontend/src/components/PoolSummary.tsx` | Pool summary bar component |

### 5.2 Modified Files

| File | Changes |
|------|---------|
| `internal/download/servers.go` | Add new servers to `DefaultServerEntries`. Add `Tier`, `Region`, `Provider`, `FileSizeBytes` fields to `ServerEntry`. Extend `Server` struct with scoring fields. Extend `ServerHealth` with ranking data. |
| `internal/download/engine.go` | Replace round-robin `Next()` dispatch with score-weighted allocation. Add rebalance loop (30s ticker). Integrate startup probe on `Start()`. Add per-server rate limiter support. |
| `internal/api/handlers.go` | Extend `GET /api/server-health` response with ranking data. Add `POST /api/speed-test` endpoint. Add `GET /api/pool-summary` endpoint. |
| `internal/config/config.go` | Add configurable fields: `ServerMaxStreams`, `ServerMaxBandwidthPct`, `ProbeOnStartup` (bool), `RebalanceIntervalSec`. |
| `internal/db/db.go` | Add `server_scores` table for persisting EWMA scores across restarts. |
| `cmd/server/main.go` | Wire probe callbacks to WebSocket broadcaster. Wire new API endpoints. |
| `frontend/src/pages/ServerHealth.tsx` | Add pool summary bar, extended table columns, sort by score, color coding, probe button. |
| `frontend/src/api/client.ts` | Add `runSpeedTest()`, `getPoolSummary()` functions. Update `ServerHealth` type. |
| `frontend/src/hooks/useWebSocket.ts` | Handle `ProbeProgress` message type for live probe updates. |

### 5.3 Database Schema Addition

```sql
CREATE TABLE IF NOT EXISTS server_scores (
    url             TEXT PRIMARY KEY,
    ewma_throughput REAL NOT NULL DEFAULT 0,
    success_count   INTEGER NOT NULL DEFAULT 0,
    failure_count   INTEGER NOT NULL DEFAULT 0,
    composite_score REAL NOT NULL DEFAULT 0,
    last_updated    TEXT NOT NULL DEFAULT ''
);
```

Scores are persisted every 60 seconds (piggyback on existing stats persistence ticker) and loaded on startup to avoid cold-start penalty.

### 5.4 New API Endpoints

**`POST /api/speed-test`**
- Triggers parallel probe of all servers
- Returns immediately with `202 Accepted`
- Progress streamed via WebSocket: `{"type":"probeProgress","completed":12,"total":47,"results":[...]}`
- Final results pushed as `{"type":"probeComplete","results":[...]}`

**`GET /api/pool-summary`**
- Returns `PoolSummary` JSON
- Lightweight endpoint for dashboard polling

**`GET /api/server-health`** (extended)
- Existing endpoint, response now includes ranking fields
- Backward compatible (new fields are additive)

---

## 6. Migration Path

### Phase 1: Expand Server List (Low Risk)

1. Add all Tier 1 (US) and Tier 2 (Canada) servers to `DefaultServerEntries` in `servers.go`.
2. Add `Tier`, `Region`, `Provider`, `FileSizeBytes` metadata fields to `ServerEntry`.
3. Populate metadata for all servers (existing + new).
4. Update `config.go` upgrade logic to detect old server lists and replace with new defaults.
5. No behavioral changes -- existing round-robin + speed-score selection continues working.

**Estimated effort:** 2-3 hours. **Risk:** Very low -- additive only.

### Phase 2: Implement Ranking Core (Medium Risk)

1. Add `ranking.go` with EWMA calculation, reliability multiplier, composite score.
2. Add `server_scores` SQLite table and persistence.
3. Replace `Server.speedScore` (simple average of last 5) with `EWMAThroughput`.
4. Update `Next()` to use composite score instead of raw speed score.
5. Load persisted scores on startup.

**Estimated effort:** 4-6 hours. **Risk:** Medium -- changes server selection behavior. Fallback: if no scores loaded, existing round-robin kicks in automatically.

### Phase 3: Add Startup Probe (Medium Risk)

1. Add `probe.go` with parallel probe logic.
2. Wire probe to engine `Start()` with configurable enable/disable.
3. Add `POST /api/speed-test` endpoint.
4. Add WebSocket progress messages.
5. Update frontend with probe button and progress UI.

**Estimated effort:** 6-8 hours. **Risk:** Medium -- adds 10-15s startup delay. Mitigated by making probe configurable and running streams during probe.

### Phase 4: Implement Stream Allocation & Rebalancing (Higher Risk)

1. Replace current "launch N identical goroutines" model with "launch targeted goroutines per server".
2. Add rebalance ticker (30s).
3. Add per-server stream caps from provider defaults.
4. Add per-server rate limiters.
5. Implement demotion/promotion state machine (Active/Probation/Cooldown/Blocked).

**Estimated effort:** 8-12 hours. **Risk:** Higher -- fundamental change to stream dispatch. Requires careful testing. Fallback: disable rebalancing, revert to current dispatch.

### Phase 5: UI & Polish

1. Add `PoolSummary` component to Server Health page.
2. Extend server table with ranking columns.
3. Add color coding and sort-by-score.
4. Add inline speed bar charts.

**Estimated effort:** 4-6 hours. **Risk:** Low -- frontend only.

### Total Estimated Effort: ~25-35 hours across all phases

### Rollback Strategy

Each phase is independently revertable:
- Phase 1: Remove new servers from list (or keep them -- they cause no harm).
- Phase 2: Set alpha=0 to disable EWMA, falls back to simple average.
- Phase 3: Set `ProbeOnStartup=false` in config.
- Phase 4: Set `RebalanceEnabled=false`, revert to current `Next()` round-robin.
- Phase 5: Frontend changes are cosmetic only.

---

## Appendix A: Full Proposed Server List

Below is the complete proposed `DefaultServerEntries` after merging current + new servers, deduplicated and organized by region.

### US East (16 servers)
```
http://ash-speed.hetzner.com/10GB.bin                         Ashburn, VA
http://mirror.us.leaseweb.net/speedtest/10000mb.bin           Manassas, VA
http://mirror.wdc1.us.leaseweb.net/speedtest/10000mb.bin      Washington DC
http://nj-us-ping.vultr.com/vultr.com.1000MB.bin              New Jersey
http://ga-us-ping.vultr.com/vultr.com.1000MB.bin              Atlanta, GA
http://fl-us-ping.vultr.com/vultr.com.1000MB.bin              Miami, FL
http://speedtest.newark.linode.com/100MB-newark.bin            Newark, NJ
http://speedtest.atlanta.linode.com/100MB-atlanta.bin          Atlanta, GA
http://nyc.speedtest.clouvider.net/10G.bin                     New York, NY
http://lg.atl.fdcservers.net/10GBtest.zip                     Atlanta, GA
https://speedtest.ny.buyvm.net/10000MB.test                   New York, NY
https://speedtest.mia.buyvm.net/1000MB.test                   Miami, FL
https://lg-ny.racknerd.com/test_files/1GB.test                New York, NY
http://ash.download.datapacket.com/10000mb.bin                Ashburn, VA
http://nyc.download.datapacket.com/10000mb.bin                New York, NY
http://atl.download.datapacket.com/10000mb.bin                Atlanta, GA
http://mia.download.datapacket.com/10000mb.bin                Miami, FL
http://speedtest.wdc01.softlayer.com/downloads/test10000.zip  Washington DC
http://speedtest-nyc1.digitalocean.com/5gb.test               New York, NY
http://speedtest-nyc3.digitalocean.com/5gb.test               New York, NY
https://lg-ash.racknerd.com/test_files/1GB.test               Ashburn, VA
https://lg-atl.racknerd.com/test_files/1GB.test               Atlanta, GA
```

### US Central (10 servers)
```
http://il-us-ping.vultr.com/vultr.com.1000MB.bin              Chicago, IL
http://tx-us-ping.vultr.com/vultr.com.1000MB.bin              Dallas, TX
http://mirror.dal10.us.leaseweb.net/speedtest/10000mb.bin     Dallas, TX
http://speedtest.dallas.linode.com/100MB-dallas.bin            Dallas, TX
http://speedtest.chicago.linode.com/100MB-chicago.bin          Chicago, IL
http://dal.speedtest.clouvider.net/10G.bin                     Dallas, TX
http://lg.chi.fdcservers.net/10GBtest.zip                     Chicago, IL
http://lg.den.fdcservers.net/10GBtest.zip                     Denver, CO
https://lg-dal.racknerd.com/test_files/1GB.test               Dallas, TX
https://lg-chi.racknerd.com/test_files/1GB.test               Chicago, IL
http://chi.download.datapacket.com/10000mb.bin                Chicago, IL
http://dal.download.datapacket.com/10000mb.bin                Dallas, TX
http://den.download.datapacket.com/10000mb.bin                Denver, CO
http://hou.download.datapacket.com/10000mb.bin                Houston, TX
```

### US West (14 servers)
```
http://lax-ca-us-ping.vultr.com/vultr.com.1000MB.bin          Los Angeles, CA
http://sjo-ca-us-ping.vultr.com/vultr.com.1000MB.bin          San Jose, CA
http://sea-us-ping.vultr.com/vultr.com.1000MB.bin             Seattle, WA
http://wa-us-ping.vultr.com/vultr.com.1000MB.bin              Seattle, WA
http://mirror.sfo12.us.leaseweb.net/speedtest/10000mb.bin     San Francisco, CA
http://speedtest.fremont.linode.com/100MB-fremont.bin          Fremont, CA
http://la.speedtest.clouvider.net/10G.bin                      Los Angeles, CA
https://speedtest.lv.buyvm.net/1000MB.test                    Las Vegas, NV
https://lg-lax02.racknerd.com/test_files/1GB.test             Los Angeles, CA
https://lg-sj.racknerd.com/test_files/1GB.test                San Jose, CA
https://mirrors-lax.webnx.com/test/10gb.bin                   Los Angeles, CA
https://hil-speed.hetzner.com/10GB.bin                        Hillsboro, OR
http://lax.download.datapacket.com/10000mb.bin                Los Angeles, CA
http://sea.download.datapacket.com/10000mb.bin                Seattle, WA
http://sjc.download.datapacket.com/10000mb.bin                San Jose, CA
http://speedtest.sjc01.softlayer.com/downloads/test10000.zip  San Jose, CA
http://speedtest-sfo3.digitalocean.com/5gb.test               San Francisco, CA
https://lg-sea.racknerd.com/test_files/1GB.test               Seattle, WA
http://repos.lax-noc.com/speedtests/100gb.bin                 Los Angeles, CA
```

### Canada (5 servers)
```
http://proof.ovh.ca/files/10Gio.dat                           Beauharnois, QC
http://mon.download.datapacket.com/10000mb.bin                Montreal, QC
http://tor.download.datapacket.com/10000mb.bin                Toronto, ON
http://van.download.datapacket.com/10000mb.bin                Vancouver, BC
http://lg.tor.fdcservers.net/10GBtest.zip                     Toronto, ON
```

### Europe (30+ servers)
```
http://speed.hetzner.de/10GB.bin                              Falkenstein, DE
http://fsn1-speed.hetzner.com/10GB.bin                        Falkenstein, DE
http://nbg1-speed.hetzner.com/10GB.bin                        Nuremberg, DE
http://hel1-speed.hetzner.com/10GB.bin                        Helsinki, FI
http://proof.ovh.net/files/10Gb.dat                           Gravelines, FR
http://rbx-proof.ovh.net/files/10Gb.dat                       Roubaix, FR
http://gra-proof.ovh.net/files/10Gb.dat                       Gravelines, FR
http://ping.online.net/10000Mo.dat                            Paris, FR
http://speedtest.belwue.net/10G                               Stuttgart, DE
http://speedtest.tele2.net/10GB.zip                           Stockholm, SE
http://speedtest.serverius.net/files/10000mb.bin               Dronten, NL
http://ams-nl-ping.vultr.com/vultr.com.1000MB.bin             Amsterdam, NL
http://fra-de-ping.vultr.com/vultr.com.1000MB.bin             Frankfurt, DE
http://par-fr-ping.vultr.com/vultr.com.1000MB.bin             Paris, FR
http://lon-gb-ping.vultr.com/vultr.com.1000MB.bin             London, UK
http://lon.speedtest.clouvider.net/10G.bin                     London, UK
http://speedtest.worldstream.nl/10G.bin                       Naaldwijk, NL
http://ipv4.download.thinkbroadband.com/1GB.zip               London, UK
http://mirror.nl.leaseweb.net/speedtest/10000mb.bin           Haarlem, NL
http://mirror.de.leaseweb.net/speedtest/10000mb.bin           Frankfurt, DE
http://mirror.i3d.net/10000mb.bin                             Rotterdam, NL
https://speedtest.lu.buyvm.net/1000MB.test                    Luxembourg, LU
http://lon.download.datapacket.com/10000mb.bin                London, UK
http://fra.download.datapacket.com/10000mb.bin                Frankfurt, DE
http://par.download.datapacket.com/10000mb.bin                Paris, FR
http://ams.download.datapacket.com/10000mb.bin                Amsterdam, NL
http://download.xs4all.nl/test/10GB.bin                       Netherlands
http://nl.altushost.com/10gb.test                             Netherlands
http://sbg.proof.ovh.net/files/10Gio.dat                      Strasbourg, FR
```

### Asia-Pacific (2 servers)
```
https://sin-speed.hetzner.com/10GB.bin                        Singapore, SG
http://hnd-jp-ping.vultr.com/vultr.com.1000MB.bin             Tokyo, JP
```

**Grand Total: ~94 unique servers** (exact count depends on deduplication of minor URL variants like `sea-us-ping` vs `wa-us-ping`).

---

## Appendix B: Pseudocode Summary

```
┌─────────────────────────────────────────────────────────┐
│                    ENGINE START                          │
├─────────────────────────────────────────────────────────┤
│ 1. Load persisted scores from SQLite                    │
│ 2. If ProbeOnStartup enabled:                           │
│    a. Probe all servers (parallel, 15s timeout each)    │
│    b. Seed EWMA from probe results                      │
│    c. Broadcast progress via WebSocket                  │
│ 3. Calculate composite scores for all servers           │
│ 4. Allocate streams proportional to scores              │
│ 5. Launch allocated streams                             │
│ 6. Start rebalance ticker (30s)                         │
│ 7. Start score persistence ticker (60s)                 │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  DOWNLOAD LOOP (per stream)              │
├─────────────────────────────────────────────────────────┤
│ 1. Pick server (from allocated assignment)              │
│ 2. Check per-server stream cap                          │
│ 3. Download file, streaming bytes to stats collector    │
│ 4. On completion:                                       │
│    a. Calculate throughput (bytes/duration)              │
│    b. Update EWMA: new = 0.3*sample + 0.7*old          │
│    c. Mark success, update reliability                  │
│    d. Recalculate composite score                       │
│ 5. On failure:                                          │
│    a. Increment consecutive failures                    │
│    b. Update reliability multiplier                     │
│    c. Enter cooldown with exponential backoff           │
│    d. If 5+ consecutive: auto-block                     │
│ 6. Loop back to 1                                       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  REBALANCE (every 30s)                   │
├─────────────────────────────────────────────────────────┤
│ 1. Recalculate composite scores for all servers         │
│ 2. Run allocation algorithm                             │
│ 3. Compare desired vs actual stream counts              │
│ 4. For under-allocated: launch new streams              │
│ 5. For over-allocated: set drain flag (natural EOF)     │
│ 6. Apply demotion/promotion rules                       │
│ 7. Persist scores to SQLite                             │
└─────────────────────────────────────────────────────────┘
```
