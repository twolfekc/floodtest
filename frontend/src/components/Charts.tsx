import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
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
import {
  BarChart3, ArrowDown, ArrowUp, Database, TrendingUp, Activity, AlertTriangle,
} from 'lucide-react'
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
  if (range === '7d') {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric' })
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
    <div className="glass-strong rounded-xl p-2 shadow-lg">
      <p className="text-xs text-zinc-500 font-mono">{label}</p>
      {dlEntry && (
        <p className="text-sm font-mono text-cyan-400">↓ {formatChartSpeed(dlEntry.value)}</p>
      )}
      {ulEntry && (
        <p className="text-sm font-mono text-amber-400">↑ {formatChartSpeed(ulEntry.value)}</p>
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
    <div className="space-y-6 max-w-[1400px]">
      {/* Page Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0, duration: 0.4 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Charts</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Historical throughput analysis</p>
        </div>
        <div className="inline-flex rounded-xl glass-inset p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                range === r
                  ? 'bg-cyan-500 text-zinc-950 shadow-sm shadow-cyan-500/25'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Summary Stats */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.4 }} className="grid grid-cols-3 gap-3">
        <div className="group glass-card border-cyan-500/20 p-4 card-hover relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.07] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
              <ArrowDown className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Avg Download</span>
              <p className="text-sm sm:text-lg font-mono font-bold text-cyan-400">{formatChartSpeed(avgDownload)}</p>
            </div>
          </div>
        </div>
        <div className="group glass-card border-amber-500/20 p-4 card-hover relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/[0.07] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <ArrowUp className="w-4 h-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Avg Upload</span>
              <p className="text-sm sm:text-lg font-mono font-bold text-amber-400">{formatChartSpeed(avgUpload)}</p>
            </div>
          </div>
        </div>
        <div className="group glass-card border-zinc-500/20 p-4 card-hover relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-500/[0.07] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-zinc-500/10 flex items-center justify-center shrink-0">
              <Database className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Data Points</span>
              <p className="text-lg font-mono font-bold text-zinc-300 truncate">{history.length.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Main Throughput Chart */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.4 }} className="glass-card card-hover p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
          </div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Throughput History</h2>
        </div>
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
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(ts) => formatXAxis(ts, range)}
                stroke="#27272a"
                tick={{ fill: '#71717a', fontSize: 12 }}
                minTickGap={50}
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
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#downloadGradient)"
                dot={false}
                name="downloadBps"
              />
              <Area
                type="monotone"
                dataKey="uploadBps"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="url(#uploadGradient)"
                dot={false}
                name="uploadBps"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* Legend */}
        <div className="flex items-center gap-5 mt-3 pt-3 border-t border-forge-border">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
            Download
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            Upload
          </div>
          {filteredEvents.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-50" />
              Throttle Event
            </div>
          )}
        </div>
      </motion.div>

      {/* Daily Usage */}
      {dailyUsage.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24, duration: 0.4 }} className="glass-card card-hover p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Daily Usage</h2>
          </div>
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
              <Bar dataKey="downloadBytes" fill="#06b6d4" radius={[2, 2, 0, 0]} name="Download" />
              <Bar dataKey="uploadBytes" fill="#f59e0b" radius={[2, 2, 0, 0]} name="Upload" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* ISP Speed Tests */}
      {speedtestHistory.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32, duration: 0.4 }} className="glass-card card-hover p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Activity className="w-4 h-4 text-violet-400" />
            </div>
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">ISP Speed Tests</h2>
          </div>
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
                fill="#06b6d4"
                name="Download"
              />
              <Scatter
                data={speedtestHistory}
                dataKey="uploadMbps"
                fill="#f59e0b"
                name="Upload"
              />
            </ScatterChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      <ThrottleLog />
    </div>
  )
}
