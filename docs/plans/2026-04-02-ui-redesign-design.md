# UI Redesign — "Forge" Theme

**Date:** 2026-04-02
**Approach:** Theme-First Refactor (Approach A)
**Scope:** Complete visual redesign of all pages + backend data enrichment + GitHub branding

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| Color direction | Automotive/Performance — carbon black + crimson/copper |
| Idle Dashboard | Compact hero card (no flow diagram when idle) |
| Flow diagram | Keep but redesign (thinner lines, amber/steel colors, tighter spacing) |
| Typography | Geist Sans (UI) + Geist Mono (data/numbers) |
| Charts | Restyle Recharts (gradient fills, custom tooltips, new color scheme) |
| Navigation | Minimal icon-only top tab bar with tooltip on hover |
| Density | Dense/packed — tight padding, every pixel earns its place |
| Data enrichment | Full — new DB tables, new API endpoints, richer data on every page |

---

## 1. Color System — "Forge" Palette

### Backgrounds (warm-shifted zinc, not cold gray)

| Token | Hex | Tailwind | Use |
|-------|-----|----------|-----|
| base | #09090b | zinc-950 | Page background |
| surface | #18181b | zinc-900 | Cards, panels |
| surface-raised | #27272a | zinc-800 | Elevated panels, dropdowns |
| inset | #0f0f11 | custom | Input fields, code blocks |

### Accent Colors

| Role | Hex | Tailwind | Use |
|------|-----|----------|-----|
| Primary | #f59e0b | amber-500 | CTAs, active states, mode toggles, nav active |
| Primary hover | #d97706 | amber-600 | Hover states, borders |
| Primary glow | #f59e0b/15 | — | Subtle glow behind active elements |
| Download | #ea580c | orange-600 | Download throughput, hot metrics |
| Upload | #94a3b8 | slate-400 | Upload throughput (cool contrast) |
| Danger/Stop | #dc2626 | red-600 | Errors, throttle events, stop button |
| Success | #22c55e | green-500 | Running state, healthy servers |
| Warning | #f59e0b | amber-500 | Attention without alarm |

### Borders

| Element | Hex | Tailwind |
|---------|-----|----------|
| Default | #27272a | zinc-800 |
| Subtle | #1e1e22 | custom |
| Strong/active | #3f3f46 | zinc-700 |
| Accent glow | #d97706/20 | amber-600 at 20% opacity |

### Text

| Level | Hex | Tailwind |
|-------|-----|----------|
| Primary | #fafafa | zinc-50 |
| Secondary | #a1a1aa | zinc-400 |
| Tertiary | #71717a | zinc-500 |
| Disabled | #52525b | zinc-600 |

### Semantic Data Colors

| Metric | Color | Hex |
|--------|-------|-----|
| Download speed | Amber→Orange gradient | #f59e0b → #ea580c |
| Upload speed | Cool Steel | #94a3b8 |
| Healthy | Green | #22c55e |
| Warning/Cooldown | Amber | #f59e0b |
| Error/Throttle | Crimson | #dc2626 |
| Idle/Off | Zinc | #52525b |

---

## 2. Typography

- **UI text:** Geist Sans via `@fontsource-variable/geist`
- **Data/numbers:** Geist Mono via `@fontsource-variable/geist-mono`
- **Base size:** `text-sm` (14px) for body, `text-xs` (12px) for secondary data
- **Headings:** `text-base` to `text-lg` (no jumbo headers)
- All throughput numbers, byte counters, timestamps, speeds render in Geist Mono

---

## 3. Navigation — Minimal Icon Tab Bar

- Icon-only top bar, ~40px height
- Tooltip on hover reveals page name
- Active page: amber underline + amber icon tint
- Inactive: zinc-500 icon color
- Icons from lucide-react: Gauge (Dashboard), BarChart3 (Charts), Clock (Schedule), Settings (Settings), RefreshCw (Updates), Server (Server Health)
- "FloodTest" wordmark omitted from nav (or small right-aligned if desired)

---

## 4. Density Rules

| Element | Old | New |
|---------|-----|-----|
| Card padding | p-6 | p-3 |
| Card gaps | gap-4/gap-6 | gap-2 |
| Section spacing | space-y-6 | space-y-2 |
| Page titles | "FloodTest Dashboard" etc | Removed (nav indicates page) |
| Table row padding | py-4 | py-2 |
| Font sizes | text-base default | text-sm default |

---

## 5. Dashboard — Idle State

### Layout
```
┌──────────────────────────────────────────────────────┐
│ [icon nav bar]                                        │
├──────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐  │
│  │  ⚡ READY                     44/44 healthy      │  │
│  │  ISP: ↓3452 / ↑3452 Mbps    [Reliable] [Max]   │  │
│  │  Tested: 2h ago                                  │  │
│  │  Next scheduled: Today 8:00 PM (in 3h)          │  │
│  │              [ ████ LAUNCH ████ ]                │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌──────────┐ ┌────────┐ ┌────────┐ ┌─────────────┐  │
│  │ SESSION  │ │ TODAY  │ │ MONTH  │ │ ALL TIME    │  │
│  │ ↓122 GB  │ │↓240 GB │ │↓4.5 TB │ │ ↓4.5 TB    │  │
│  │ ↑209 GB  │ │↑432 GB │ │↑16.3TB │ │ ↑16.3 TB   │  │
│  │          │ │Peak:   │ │        │ │             │  │
│  │          │ │ 2.8Gbps│ │        │ │             │  │
│  └──────────┘ └────────┘ └────────┘ └─────────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  LAST 24H  ▁▂▅▇█▇▅▂▁___▁▃▅▇█▇▆▄▂▁  avg 1.8G  │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Key elements
- **Hero card**: Amber accent border, contains ISP info, mode selector, server health, next schedule, Launch button
- **No flow diagram when idle** — hidden entirely
- **Usage stats row**: 4 cards with Geist Mono numbers. Today card includes peak speed.
- **Mini sparkline**: Last 24h throughput using Recharts tiny area chart with amber gradient
- **Launch button**: Crimson/red (#dc2626), large, centered

---

## 6. Dashboard — Running State

### Layout
```
┌──────────────────────────────────────────────────────┐
│ [icon nav bar]                                        │
├──────────────────────────────────────────────────────┤
│ ● Reliable · 45s            [Reliable][Max] [■ STOP] │
├──────────────┬──────────────┬────────────────────────┤
│ THROUGHPUT   │ SERVER POOL  │ ENGINE LOG             │
│ ↓ 1.24 Gbps │ ● 28 healthy │ events...              │
│   peak 2.8G │ ● 16 cooldown│                        │
│ ↑ 2.26 Gbps │ 9 providers  │                        │
│   peak 2.3G │ 66 streams   │                        │
│ Target ██░ 39% │            │                        │
│ 3.11 Gbps   │ Top: Hetzner │                        │
│ 34↓ · 32↑   │      Vultr   │                        │
│ 36M/stream   │              │                        │
├──────────────┴──────────────┴────────────────────────┤
│  DOWNLOAD              Your Machine         UPLOAD   │
│  [providers] ──══════──[center box]──══════──[upload] │
│  (canvas-animated flow diagram, redesigned)          │
├──────────┬────────┬─────────┬────────────────────────┤
│ SESSION  │ TODAY  │ MONTH   │ ALL TIME               │
└──────────┴────────┴─────────┴────────────────────────┘
```

### Flow diagram redesign
- Connection lines: 1.5px width (down from 3px), animated dashes
- Download lines: amber/orange gradient (#f59e0b → #ea580c)
- Upload lines: slate (#94a3b8)
- Line thickness varies by throughput (1px to 3px range)
- Provider boxes: zinc-900 bg, left-edge accent bar (amber for active)
- Compact provider labels: `Hetzner 9·328M` (single line)
- "Your Machine" box: amber border glow, largest element
- Diagram takes ~40% viewport height (down from ~60%)
- Providers sorted by throughput (highest first)

### Running state additions
- Peak speed per direction (tracked in stats collector)
- Per-stream efficiency (computed: speed / streams)
- Top providers in server pool summary
- Stop button: crimson, top-right

---

## 7. Charts Page (enriched)

### Layout
```
┌──────────────────────────────────────────────────────┐
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │
│  │ AVG ↓ SPEED │ │ AVG ↑ SPEED │ │UPTIME TODAY │    │
│  │  1.82 Gbps  │ │  2.14 Gbps  │ │  14h 22m    │    │
│  │  ▲ +12% 7d  │ │  ▲ +3% 7d   │ │  78% of day │    │
│  └─────────────┘ └─────────────┘ └─────────────┘    │
├──────────────────────────────────────────────────────┤
│  THROUGHPUT                 [24h] [7d] [30d] [90d]   │
│  (Recharts area chart, amber/orange download fill,   │
│   slate upload fill, red throttle markers)            │
├──────────────────────────────────────────────────────┤
│  DAILY USAGE                                         │
│  (Stacked bar chart — download + upload per day,     │
│   last 30 days, computed from throughput_history)     │
├──────────────────────────────────────────────────────┤
│  ISP SPEED TESTS                                     │
│  (Scatter plot of ISP test results over time,        │
│   amber dots = download, steel dots = upload,        │
│   with trend lines)                                  │
├──────────────────────────────────────────────────────┤
│  THROTTLE EVENTS                                     │
│  (Restyled table with colored status dots)           │
└──────────────────────────────────────────────────────┘
```

### Chart restyling
- Download line: amber/orange gradient fill (15% opacity) under line
- Upload line: slate gradient fill
- Grid lines: zinc-800
- Tooltip: zinc-900 bg, amber border, Geist Mono numbers
- Time range buttons: amber active, zinc-800 inactive
- Throttle reference areas: red-500 at 10% opacity

### New charts
- **Daily usage bar chart**: GROUP BY date on throughput_history
- **ISP speedtest scatter plot**: requires new `speedtest_history` table

---

## 8. Server Health Page (enriched)

### Layout
```
┌──────────────────────────────────────────────────────┐
│  PROVIDER BREAKDOWN                                   │
│  Hetzner  ████████████░  328 Mbps  92% reliability   │
│  Vultr    ██████████████  397 Mbps  88% reliability  │
│  Linode   ████████░░░░░  180 Mbps  95% reliability   │
│  ...                                                  │
├──────────────────────────────────────────────────────┤
│  ▸ Hetzner (9 servers · 3 healthy)                   │
│    fra1.de  ● 72 Mbps · 0 fails · 12.4 GB           │
│    ams1.nl  ● 65 Mbps · 2 fails · 8.7 GB            │
│  ▸ Vultr (11 servers · 8 healthy)                    │
│    ...                                                │
└──────────────────────────────────────────────────────┘
```

### New data surfaced
- Provider throughput summary bars (aggregated from per-server speedBps)
- Reliability % per provider (totalDownloads - totalFailures / totalDownloads)
- Per-server bytes downloaded shown inline

---

## 9. Schedule Page (enriched)

### Layout
```
┌──────────────────────────────────────────────────────┐
│  NEXT: Tonight 8:00 PM (in 3h) · Reliable 3.1 Gbps │
├──────────────────────────────────────────────────────┤
│  ● Mon-Fri 8:00 PM → 6:00 AM                        │
│    ↓3100 ↑3100 Mbps              [Edit] [Delete]    │
│  ○ Sat-Sun All Day (disabled)                        │
│    ↓5000 ↑5000 Mbps              [Edit] [Delete]    │
├──────────────────────────────────────────────────────┤
│  [ + Add Schedule ]                                  │
└──────────────────────────────────────────────────────┘
```

### New data
- **Next scheduled event** banner with countdown
- Day-of-week visual indicators
- Active/disabled state via colored dot (green/zinc)

---

## 10. Settings Page

- Form inputs: zinc-900 bg, zinc-700 border, amber focus ring
- Section dividers: zinc-800
- "Test Connection" button: amber outline style
- Speed target inputs: Geist Mono with inline Mbps label
- No structural changes, just reskinning

---

## 11. Updates Page

- Version card: amber accent border (top edge)
- SHA256 hashes: truncated to 8 chars, click to copy full
- Status badges: green/red dots instead of colored text
- "Check for Updates" button: amber style
- Auto-update toggle: amber when on
- Compact table rows

---

## 12. GitHub README Branding

- Hero SVG: Replace blue gradients with amber/orange (#f59e0b → #ea580c)
- Architecture diagram: zinc backgrounds + amber accent lines
- Shields.io badges: `?color=f59e0b` for amber
- Icon accents: amber variants
- Tagline unchanged: "Detect ISP throttling, saturate your WAN, know the truth."

---

## 13. Backend Work Required

### New SQLite Tables

**`speedtest_history`** — Store ISP speedtest results:
```sql
CREATE TABLE speedtest_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    download_mbps REAL NOT NULL,
    upload_mbps REAL NOT NULL,
    streams INTEGER NOT NULL
);
```

### New API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/speedtest-history` | Last 100 ISP test results for scatter plot |
| `GET /api/usage/daily?days=30` | Daily aggregated usage (GROUP BY date) |

### Modified API Responses

| Endpoint | New Fields |
|----------|-----------|
| `GET /api/status` | `nextScheduledEvent`, `nextScheduledTime`, `peakDownloadBps`, `peakUploadBps` |
| WebSocket broadcast | `peakDownloadBps`, `peakUploadBps` |

### Stats Collector Changes

- Track `peakDownloadBps` and `peakUploadBps` per session (reset on engine start)
- Expose via `CurrentRate()` or new method

### Scheduler Changes

- Add `NextEvent()` method returning `{action: "start"|"stop", time: time.Time, scheduleName: string}`
- Expose in status API

### ISP Speedtest Changes

- After each ISP test, INSERT into `speedtest_history` table
- Keep existing behavior of updating config with latest result

---

## 14. Implementation Dependencies

```
Tailwind theme config (colors, fonts)
  └─→ Nav bar redesign
  └─→ Dashboard idle state
  │     └─→ Dashboard running state (requires idle first)
  └─→ Charts page restyle
  │     └─→ Daily usage chart (requires API)
  │     └─→ ISP scatter plot (requires DB + API)
  └─→ Server Health page
  └─→ Schedule page (requires scheduler API)
  └─→ Settings page
  └─→ Updates page
  └─→ GitHub README branding

Backend (parallel track):
  speedtest_history table + migration
  daily usage API endpoint
  peak speed tracking in stats
  next event in scheduler
```

---

## 15. npm Dependencies

### Add
- `@fontsource-variable/geist` — Geist Sans font
- `@fontsource-variable/geist-mono` — Geist Mono font
- `lucide-react` — Icon library for nav and UI icons

### Keep
- `recharts` — Chart library (restyled, not replaced)
- `react-router-dom` — Routing

### No new major dependencies
The redesign is primarily CSS/Tailwind changes + Recharts restyling. No new component library.
