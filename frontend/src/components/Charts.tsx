import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts'
import { api, HistoryPoint, ThrottleEvent, DailyUsageEntry, SpeedTestHistoryEntry } from '../api/client'
import ThrottleLog from './ThrottleLog'

type Range = '24h' | '7d' | '30d' | '90d'

const RANGES: Range[] = ['24h', '7d', '30d', '90d']

function formatChartSpeed(bps: number): string {
  if (bps >= 1_000_000_000) {
    return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  }
  return `${(bps / 1_000_000).toFixed(1)} Mbps`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_099_511_627_776) {
    return `${(bytes / 1_099_511_627_776).toFixed(1)} TB`
  }
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  }
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`
  }
  return `${(bytes / 1024).toFixed(1)} KB`
}

function formatXAxis(timestamp: string, range: Range): string {
  const d = new Date(timestamp)
  if (range === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

interface ChartDataPoint {
  timestamp: string
  downloadBps: number
  uploadBps: number
  label: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: { value: number; name: string }[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null
  const dlEntry = payload.find((e) => e.name === 'downloadBps')
  const ulEntry = payload.find((e) => e.name === 'uploadBps')
  return (
    <div className="bg-forge-surface border border-amber-500/30 rounded-lg p-2 shadow-lg">
      <p className="text-xs text-zinc-500 font-mono">{label}</p>
      {dlEntry && (
        <p className="text-sm font-mono text-orange-400">↓ {formatChartSpeed(dlEntry.value)}</p>
      )}
      {ulEntry && (
        <p className="text-sm font-mono text-slate-400">↑ {formatChartSpeed(ulEntry.value)}</p>
      )}
    </div>
  )
}

export default function Charts() {
  const [range, setRange] = useState<Range>('24h')
  const [history, setHistory] = useState<ChartDataPoint[]>([])
  const [throttleEvents, setThrottleEvents] = useState<ThrottleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dailyUsage, setDailyUsage] = useState<DailyUsageEntry[]>([])
  const [speedtestHistory, setSpeedtestHistory] = useState<SpeedTestHistoryEntry[]>([])

  const loadData = useCallback(async (r: Range) => {
    setLoading(true)
    setError(null)
    try {
      const [historyData, events] = await Promise.all([
        api.getHistory(r),
        api.getThrottleEvents(),
      ])
      const mapped = historyData.map((p: HistoryPoint) => ({
        ...p,
        label: new Date(p.timestamp).toLocaleString(),
      }))
      setHistory(mapped)
      setThrottleEvents(events)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData(range)
  }, [range, loadData])

  useEffect(() => {
    api.getDailyUsage(30).then(setDailyUsage).catch(() => {})
    api.getSpeedtestHistory().then(setSpeedtestHistory).catch(() => {})
  }, [])

  const rangeStart = (): Date => {
    const now = new Date()
    switch (range) {
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000)
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    }
  }

  const filteredEvents = throttleEvents.filter((e) => {
    const ts = new Date(e.timestamp)
    return ts >= rangeStart()
  })

  const yTickFormatter = (value: number) => formatChartSpeed(value)

  const avgDownload = history.reduce((s, p) => s + p.downloadBps, 0) / (history.length || 1)
  const avgUpload = history.reduce((s, p) => s + p.uploadBps, 0) / (history.length || 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r
                  ? 'bg-amber-500 text-zinc-950'
                  : 'bg-forge-raised text-zinc-500 hover:text-zinc-300 hover:bg-forge-border-strong'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className="bg-forge-surface rounded-lg border border-forge-border p-3">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">Avg ↓ Speed</span>
          <p className="text-lg font-mono font-bold text-orange-400">{formatChartSpeed(avgDownload)}</p>
        </div>
        <div className="bg-forge-surface rounded-lg border border-forge-border p-3">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">Avg ↑ Speed</span>
          <p className="text-lg font-mono font-bold text-slate-400">{formatChartSpeed(avgUpload)}</p>
        </div>
        <div className="bg-forge-surface rounded-lg border border-forge-border p-3">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">Data Points</span>
          <p className="text-lg font-mono font-bold text-zinc-300">{history.length.toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-forge-surface rounded-xl border border-forge-border p-4">
        {loading ? (
          <div className="flex items-center justify-center h-80">
            <p className="text-zinc-400">Loading chart data...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-80">
            <p className="text-red-400">{error}</p>
          </div>
        ) : history.length === 0 ? (
          <div className="flex items-center justify-center h-80">
            <p className="text-zinc-400">No history data available for this range.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={history} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
              <defs>
                <linearGradient id="downloadGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#94a3b8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(ts) => formatXAxis(ts, range)}
                stroke="#27272a"
                tick={{ fill: '#71717a', fontSize: 12 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={yTickFormatter}
                stroke="#27272a"
                tick={{ fill: '#71717a', fontSize: 12 }}
                width={80}
              />
              <Tooltip content={<CustomTooltip />} />

              {filteredEvents.map((event) => {
                const start = event.timestamp
                const endTs = event.resolvedAt
                  ? event.resolvedAt
                  : new Date(
                      new Date(event.timestamp).getTime() +
                        event.durationSeconds * 1000
                    ).toISOString()
                return (
                  <ReferenceArea
                    key={event.id}
                    x1={start}
                    x2={endTs}
                    fill="#ef4444"
                    fillOpacity={0.1}
                    stroke="#ef4444"
                    strokeOpacity={0.3}
                  />
                )
              })}

              <Area
                type="monotone"
                dataKey="downloadBps"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="url(#downloadGradient)"
                dot={false}
                name="downloadBps"
              />
              <Area
                type="monotone"
                dataKey="uploadBps"
                stroke="#94a3b8"
                strokeWidth={2}
                fill="url(#uploadGradient)"
                dot={false}
                name="uploadBps"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex items-center gap-6 text-sm text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-500" />
          Download
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-slate-400" />
          Upload
        </div>
        {filteredEvents.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 opacity-50" />
            Throttle Event
          </div>
        )}
      </div>

      {dailyUsage.length > 0 && (
        <div className="bg-forge-surface rounded-lg border border-forge-border p-3 mt-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wide mb-2 block">Daily Usage</span>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dailyUsage}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#71717a', fontSize: 10 }}
                stroke="#27272a"
                tickFormatter={(d: string) => {
                  const date = new Date(d + 'T00:00:00')
                  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                }}
              />
              <YAxis
                tick={{ fill: '#71717a', fontSize: 10 }}
                stroke="#27272a"
                tickFormatter={(v: number) => formatBytes(v)}
              />
              <Bar dataKey="downloadBytes" fill="#f59e0b" radius={[2, 2, 0, 0]} name="Download" />
              <Bar dataKey="uploadBytes" fill="#94a3b8" radius={[2, 2, 0, 0]} name="Upload" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {speedtestHistory.length > 0 && (
        <div className="bg-forge-surface rounded-lg border border-forge-border p-3 mt-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wide mb-2 block">ISP Speed Tests</span>
          <ResponsiveContainer width="100%" height={160}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="timestamp"
                tick={{ fill: '#71717a', fontSize: 10 }}
                stroke="#27272a"
                tickFormatter={(t: string) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              />
              <YAxis
                tick={{ fill: '#71717a', fontSize: 10 }}
                stroke="#27272a"
                unit=" Mbps"
              />
              <Scatter
                data={speedtestHistory}
                dataKey="downloadMbps"
                fill="#f59e0b"
                name="Download"
              />
              <Scatter
                data={speedtestHistory}
                dataKey="uploadMbps"
                fill="#94a3b8"
                name="Upload"
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      <ThrottleLog />
    </div>
  )
}
