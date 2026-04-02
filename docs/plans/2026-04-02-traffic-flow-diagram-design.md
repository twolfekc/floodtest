# Real-Time Traffic Flow Diagram Design

**Date:** 2026-04-02
**Status:** Approved

## Goal

Replace the Dashboard speed cards with a Sankey-style animated flow diagram showing real-time traffic flowing from download servers (grouped by provider) through the user's machine to upload targets, with particle animations proportional to throughput.

## Architecture

Canvas-based renderer driven by `requestAnimationFrame`, decoupled from React's reconciliation. WebSocket provides 1-second speed/stream/session data; REST polls provide 5-second per-server health data. Page Visibility API pauses/resumes the animation loop for tab switching without requiring refresh.

## Layout

Three-column Sankey flow on a full-width Canvas (~300px tall):

```
[Download Providers]  ──particles→  [Your Machine]  ──particles→  [Upload Targets]
     Left column          Pipes         Center           Pipes        Right column
```

### Left Column — Download Server Groups

- Servers grouped by provider (Hetzner, Vultr, Leaseweb, OVH, Clouvider, etc.)
- Each node: provider name, active stream count, aggregate speed
- Stacked vertically, sized proportional to throughput contribution
- Only providers with active streams shown
- Data: `/api/server-health` polled every 5s, grouped by hostname pattern client-side

### Right Column — Upload Targets

- Nodes for each upload endpoint (e.g., "Cloudflare", "Tele2")
- Same format: name, streams, speed
- Data: `/api/upload-server-health` polled every 5s

### Center — "Your Machine" Node

Larger rounded rectangle showing:
- Total download speed + total upload speed
- Download / upload stream counts
- Uptime
- Session bytes transferred (down + up)
- Healthy server counts (e.g., "42/55 servers")
- Data: WebSocket WsStats (1-second updates)

### Pipes

- Bezier curves connecting provider nodes to center, center to upload targets
- Width proportional to throughput (min 2px, max 16px, scaled relative to highest pipe)
- Download pipes: cyan (#22d3ee)
- Upload pipes: violet (#a78bfa)

## Particle Animation

- Small circles (3-4px radius) flowing along bezier curves
- Speed proportional to throughput — faster data = faster particles
- Density proportional to throughput — more bandwidth = more particles
- Download: cyan particles with slight glow, flowing left → center
- Upload: violet particles with slight glow, flowing center → right
- Zero-throughput pipes: no particles, pipe dims to 20% opacity

### Animation Loop

- Single `requestAnimationFrame` loop for the entire Canvas
- Each frame: clear → draw nodes → draw pipes → advance particles → draw particles
- Target 60fps; data updates every 1s, particles interpolate smoothly between updates
- Particle positions stored in flat arrays outside React state

### Tab Visibility

- `usePageVisibility` hook via Page Visibility API
- Tab hidden: cancel rAF loop, WebSocket stays connected
- Tab visible: restart rAF, particles resume from current data instantly
- No backlog replay, no stale animation, no refresh needed

## Responsive Behavior

- Canvas width = container width via `ResizeObserver`
- Desktop: ~300px height, horizontal three-column layout
- Mobile (<640px): ~400px height, vertical stack (download top, machine center, upload bottom, pipes flow vertically)
- Node positions recalculated on resize

## Dashboard Redesign

### Removed
- Download speed card
- Upload speed card
(Both absorbed into center machine node)

### New Layout (top to bottom)
1. Header row (title + connection indicator)
2. Mode selector cards (Reliable / Max)
3. Start/Stop button + status line
4. **Traffic Flow Diagram** (new hero element, ~300px)
5. ISP speed test progress bar (only during test)
6. Cumulative usage grid
7. Server health tables

### When Stopped
- Diagram shows all nodes, no particles
- Pipes at 20% opacity
- Center node shows "Stopped"

## Component Structure

```
Dashboard.tsx
├── ModeSelector (existing)
├── StartStop (existing)
├── TrafficFlow.tsx (new — React wrapper for Canvas)
│   ├── usePageVisibility.ts (new hook)
│   └── trafficFlowRenderer.ts (pure Canvas drawing, no React)
├── UsageGrid (existing, moved down)
└── ServerHealth (existing)
```

`trafficFlowRenderer.ts` is a plain TypeScript module — takes a canvas context and data, draws everything. Animation loop lives here, completely outside React reconciliation.

## Data Sources

| Data | Source | Frequency | Used For |
|------|--------|-----------|----------|
| Download/upload Bps | WebSocket WsStats | 1s | Pipe widths, particle speeds, center node speeds |
| Stream counts | WebSocket WsStats | 1s | Center node display |
| Uptime, session bytes | WebSocket WsStats | 1s | Center node display |
| Server health counts | WebSocket WsStats | 1s | Center node "X/Y servers" |
| Per-server details | REST /api/server-health | 5s | Provider grouping, per-provider speeds/streams |
| Upload server details | REST /api/upload-server-health | 5s | Upload target nodes |

## Provider Grouping

Client-side hostname parsing:
- `*.hetzner.com` → "Hetzner"
- `*.vultr.com` → "Vultr"
- `*.leaseweb.net` → "Leaseweb"
- `*.ovh.net` → "OVH"
- `*.clouvider.net` → "Clouvider"
- `*.linode.com` → "Linode"
- `*.tele2.net` → "Tele2"
- `*.fdcservers.net` → "FDC"
- `*.belwue.net` → "BelWü"
- `*.online.net` → "Online.net"
- `*.serverius.net` → "Serverius"
- `*.worldstream.nl` → "Worldstream"
- `*.thinkbroadband.com` → "ThinkBroadband"
- `*.cloudflare.com` → "Cloudflare"
- Fallback: extract second-level domain

## Colors

Following project color conventions:
- Background: slate-900 (#0f172a)
- Download/cyan: #22d3ee
- Upload/violet: #a78bfa
- Success/healthy: #34d399
- Node backgrounds: gray-800 (#1e293b)
- Node borders: gray-700 (#374151)
- Text: white and gray-400
- Stopped state: gray-600

## Out of Scope

- Drag/zoom on the flow diagram
- Click-to-drill-down on individual servers
- Historical flow playback
- Changes to Charts, Schedule, Settings, or Updates pages
- Changes to backend/Go code
