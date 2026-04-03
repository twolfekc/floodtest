import { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle, ArrowDown, ArrowUp, Loader2 } from 'lucide-react'
import { api, ThrottleEvent } from '../api/client'

function formatSpeed(bps: number): string {
  if (bps >= 1_000_000_000) {
    return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  }
  return `${(bps / 1_000_000).toFixed(1)} Mbps`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Returns a color class for actual speed relative to target */
function speedColor(actualBps: number, targetBps: number): string {
  if (targetBps <= 0) return 'text-zinc-300'
  const ratio = actualBps / targetBps
  if (ratio < 0.5) return 'text-red-400'
  if (ratio < 0.8) return 'text-amber-400'
  return 'text-zinc-300'
}

export default function ThrottleLog() {
  const [events, setEvents] = useState<ThrottleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getThrottleEvents()
      .then((data) => {
        setEvents(data)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load throttle events')
      })
      .finally(() => setLoading(false))
  }, [])

  const activeCount = events.filter(e => e.resolvedAt === null).length

  if (loading) {
    return (
      <div className="bg-forge-surface rounded-xl border border-forge-border p-8 animate-fade-in">
        <div className="flex flex-col items-center justify-center h-40 gap-3">
          <Loader2 size={24} className="text-zinc-600 animate-spin" />
          <p className="text-sm text-zinc-500">Loading throttle events...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-forge-surface rounded-xl border border-red-500/30 p-8 animate-fade-in">
        <div className="flex flex-col items-center justify-center h-40 gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <AlertTriangle size={20} className="text-red-400" />
          </div>
          <p className="text-sm text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="bg-forge-surface rounded-xl border border-forge-border animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle size={14} className="text-emerald-400" />
            </div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Throttle Events</h3>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
            Clear
          </span>
        </div>
        {/* Empty state */}
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle size={20} className="text-emerald-400" />
          </div>
          <p className="text-sm text-zinc-500">No throttling detected</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-forge-surface rounded-xl border overflow-hidden animate-fade-in ${
      activeCount > 0 ? 'border-red-500/30' : 'border-forge-border'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-3">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
            activeCount > 0 ? 'bg-red-500/10' : 'bg-emerald-500/10'
          }`}>
            {activeCount > 0
              ? <AlertTriangle size={14} className="text-red-400" />
              : <CheckCircle size={14} className="text-emerald-400" />}
          </div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Throttle Events</h3>
        </div>
        <div className="flex items-center gap-2">
          {activeCount > 0 ? (
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-red-500/15 text-red-400 border border-red-500/20 animate-pulse">
              {activeCount} Active
            </span>
          ) : (
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
              Clear
            </span>
          )}
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50">
            {events.length} Total
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Time</th>
              <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Direction</th>
              <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Target Speed</th>
              <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Actual Speed</th>
              <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Duration</th>
              <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, i) => {
              const isActive = event.resolvedAt === null
              return (
                <tr
                  key={event.id}
                  className={`transition-colors duration-150 ${
                    isActive
                      ? 'border-l-2 border-l-red-500 bg-red-500/[0.04]'
                      : i % 2 === 0
                      ? 'bg-forge-surface'
                      : 'bg-white/[0.01]'
                  } hover:bg-white/[0.02]`}
                >
                  <td className="px-4 py-2.5 font-mono text-zinc-500 text-xs whitespace-nowrap tabular-nums">
                    {formatTimestamp(event.timestamp)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {event.direction === 'download' ? (
                        <ArrowDown size={13} className="text-orange-400" />
                      ) : (
                        <ArrowUp size={13} className="text-slate-400" />
                      )}
                      <span className={`text-xs font-medium ${
                        event.direction === 'download' ? 'text-orange-400' : 'text-slate-400'
                      }`}>
                        {event.direction === 'download' ? 'Download' : 'Upload'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-zinc-400 text-xs tabular-nums">
                    {formatSpeed(event.targetBps)}
                  </td>
                  <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${speedColor(event.actualBps, event.targetBps)}`}>
                    {formatSpeed(event.actualBps)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums">
                    {isActive ? (
                      <span className="text-red-400">Ongoing</span>
                    ) : (
                      <span className="text-zinc-400">{formatDuration(event.durationSeconds)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {isActive ? (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-red-500/15 text-red-400 border border-red-500/20 inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-zinc-800 text-zinc-500 border border-zinc-700/50 inline-flex items-center">
                        Resolved
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
