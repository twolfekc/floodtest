import { useState, useEffect, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts'
import { api, HistoryPoint, ThrottleEvent } from '../api/client'
import ThrottleLog from './ThrottleLog'

type Range = '24h' | '7d' | '30d' | '90d'

const RANGES: Range[] = ['24h', '7d', '30d', '90d']

function formatChartSpeed(bps: number): string {
  if (bps >= 1_000_000_000) {
    return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  }
  return `${(bps / 1_000_000).toFixed(1)} Mbps`
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
  payload?: { value: number; name: string; color: string }[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-lg">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
          {entry.name === 'downloadBps' ? 'Download' : 'Upload'}:{' '}
          {formatChartSpeed(entry.value)}
        </p>
      ))}
    </div>
  )
}

export default function Charts() {
  const [range, setRange] = useState<Range>('24h')
  const [history, setHistory] = useState<ChartDataPoint[]>([])
  const [throttleEvents, setThrottleEvents] = useState<ThrottleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Throughput History</h2>
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-80">
            <p className="text-gray-400">Loading chart data...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-80">
            <p className="text-red-400">{error}</p>
          </div>
        ) : history.length === 0 ? (
          <div className="flex items-center justify-center h-80">
            <p className="text-gray-400">No history data available for this range.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={history} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(ts) => formatXAxis(ts, range)}
                stroke="#6b7280"
                tick={{ fill: '#9ca3af', fontSize: 12 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={yTickFormatter}
                stroke="#6b7280"
                tick={{ fill: '#9ca3af', fontSize: 12 }}
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
                    fillOpacity={0.15}
                    stroke="#ef4444"
                    strokeOpacity={0.3}
                  />
                )
              })}

              <Line
                type="monotone"
                dataKey="downloadBps"
                stroke="#4ade80"
                strokeWidth={2}
                dot={false}
                name="downloadBps"
              />
              <Line
                type="monotone"
                dataKey="uploadBps"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
                name="uploadBps"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex items-center gap-6 text-sm text-gray-400">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-400" />
          Download
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-400" />
          Upload
        </div>
        {filteredEvents.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 opacity-50" />
            Throttle Event
          </div>
        )}
      </div>

      <ThrottleLog />
    </div>
  )
}
