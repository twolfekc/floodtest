import { useState, useEffect } from 'react'
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-zinc-400">Loading throttle events...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-red-400">{error}</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="bg-forge-surface rounded-xl border border-forge-border p-8 text-center">
        <p className="text-zinc-400">No throttle events detected</p>
      </div>
    )
  }

  return (
    <div className="bg-forge-surface rounded-xl border border-forge-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-forge-border text-left">
              <th className="px-4 py-3 text-zinc-500 text-xs uppercase tracking-wide font-medium">Time</th>
              <th className="px-4 py-3 text-zinc-500 text-xs uppercase tracking-wide font-medium">Direction</th>
              <th className="px-4 py-3 text-zinc-500 text-xs uppercase tracking-wide font-medium">Target Speed</th>
              <th className="px-4 py-3 text-zinc-500 text-xs uppercase tracking-wide font-medium">Actual Speed</th>
              <th className="px-4 py-3 text-zinc-500 text-xs uppercase tracking-wide font-medium">Duration</th>
              <th className="px-4 py-3 text-zinc-500 text-xs uppercase tracking-wide font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, i) => {
              const isActive = event.resolvedAt === null
              return (
                <tr
                  key={event.id}
                  className={`border-b border-forge-border last:border-b-0 ${
                    isActive
                      ? 'border-l-2 border-l-red-600 bg-red-950/20'
                      : i % 2 === 0
                      ? 'bg-forge-surface'
                      : 'bg-forge-base'
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-zinc-500 text-xs whitespace-nowrap">
                    {formatTimestamp(event.timestamp)}
                  </td>
                  <td className="px-4 py-3 text-zinc-300 capitalize">
                    {event.direction}
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-300">
                    {formatSpeed(event.targetBps)}
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-300">
                    {formatSpeed(event.actualBps)}
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-300">
                    {isActive ? (
                      <span className="text-red-400">Ongoing</span>
                    ) : (
                      formatDuration(event.durationSeconds)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isActive ? (
                      <span className="bg-red-600/20 text-red-400 text-xs rounded-full px-2 py-0.5 inline-flex items-center gap-1.5 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                        Active
                      </span>
                    ) : (
                      <span className="bg-zinc-800 text-zinc-400 text-xs rounded-full px-2 py-0.5 inline-flex items-center font-medium">
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
