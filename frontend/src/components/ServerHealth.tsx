import { useState, useEffect, useMemo } from 'react'
import { api, ServerHealth as ServerHealthData, SpeedTestResult } from '../api/client'

interface Props {
  speedTestRunning?: boolean
  speedTestCompleted?: number
  speedTestTotal?: number
}

type SortKey = 'server' | 'location' | 'status' | 'speed' | 'streams' | 'downloaded' | 'error'
type SortDir = 'asc' | 'desc'

function formatUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`
  return `${(bytes / 1e3).toFixed(1)} KB`
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return '\u2014'
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`
  return `${(bps / 1e6).toFixed(1)} Mbps`
}

function timeUntil(isoString: string): string {
  const target = new Date(isoString).getTime()
  const now = Date.now()
  const diffMs = target - now
  if (diffMs <= 0) return ''
  const totalSeconds = Math.ceil(diffMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

function statusColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-900/50 text-green-400 border-green-800'
    case 'testing':
      return 'bg-blue-900/50 text-blue-400 border-blue-800'
    case 'cooldown':
      return 'bg-yellow-900/50 text-yellow-400 border-yellow-800'
    case 'failed':
      return 'bg-red-900/50 text-red-400 border-red-800'
    default:
      return 'bg-gray-800 text-gray-400 border-gray-700'
  }
}

function rowBg(server: ServerHealthData): string {
  switch (server.status) {
    case 'testing':
      return 'bg-blue-900/10'
    case 'cooldown':
      return 'bg-yellow-900/10'
    case 'failed':
      return 'bg-red-900/10'
    default:
      return ''
  }
}

export default function ServerHealth({ speedTestRunning, speedTestCompleted, speedTestTotal }: Props) {
  const [servers, setServers] = useState<ServerHealthData[]>([])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [lastTestTime, setLastTestTime] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('speed')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Track externally-reported speed test state
  const isRunning = speedTestRunning || testing

  useEffect(() => {
    const fetchHealth = () => {
      api
        .getServerHealth()
        .then((data) => {
          setServers(data)
          setLoading(false)
        })
        .catch(() => {
          setLoading(false)
        })
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleSpeedTest = async () => {
    setTesting(true)
    try {
      const _results: SpeedTestResult[] = await api.runSpeedTest()
      void _results
      setLastTestTime(new Date().toISOString())
      // Re-fetch health data after test completes
      const data = await api.getServerHealth()
      setServers(data)
    } catch {
      // ignore errors
    } finally {
      setTesting(false)
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'speed' || key === 'downloaded' || key === 'streams' ? 'desc' : 'asc')
    }
  }

  const sorted = useMemo(() => {
    const list = [...servers]
    const dir = sortDir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      switch (sortKey) {
        case 'server':
          return dir * formatUrl(a.url).localeCompare(formatUrl(b.url))
        case 'location':
          return dir * (a.location || '').localeCompare(b.location || '')
        case 'status': {
          const order: Record<string, number> = { healthy: 0, testing: 1, cooldown: 2, failed: 3 }
          return dir * ((order[a.status] ?? 4) - (order[b.status] ?? 4))
        }
        case 'speed':
          return dir * (a.speedBps - b.speedBps)
        case 'streams':
          return dir * (a.activeStreams - b.activeStreams)
        case 'downloaded':
          return dir * (a.bytesDownloaded - b.bytesDownloaded)
        case 'error':
          return dir * (a.lastError || '').localeCompare(b.lastError || '')
        default:
          return 0
      }
    })
    return list
  }, [servers, sortKey, sortDir])

  const maxSpeed = useMemo(() => {
    return Math.max(...servers.map((s) => s.speedBps), 1)
  }, [servers])

  const counts = useMemo(() => {
    const total = servers.length
    const healthy = servers.filter((s) => s.status === 'healthy').length
    const cooldown = servers.filter((s) => s.status === 'cooldown').length
    const failed = servers.filter((s) => s.status === 'failed').length
    const testingCount = servers.filter((s) => s.status === 'testing').length
    return { total, healthy, cooldown, failed, testing: testingCount }
  }, [servers])

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="text-sm text-gray-500">Loading server health...</div>
      </div>
    )
  }

  const completed = speedTestCompleted ?? 0
  const total = speedTestTotal ?? 0
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div>
      {/* Summary Bar */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-400">
              <span className="text-white font-medium">{counts.total}</span> Total
            </span>
            {counts.healthy > 0 && (
              <span className="text-sm text-green-400">
                <span className="font-medium">{counts.healthy}</span> Healthy
              </span>
            )}
            {counts.cooldown > 0 && (
              <span className="text-sm text-yellow-400">
                <span className="font-medium">{counts.cooldown}</span> Cooldown
              </span>
            )}
            {counts.failed > 0 && (
              <span className="text-sm text-red-400">
                <span className="font-medium">{counts.failed}</span> Failed
              </span>
            )}
            {counts.testing > 0 && (
              <span className="text-sm text-blue-400">
                <span className="font-medium">{counts.testing}</span> Testing
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {lastTestTime && (
              <span className="text-xs text-gray-500">
                Last test: {new Date(lastTestTime).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={handleSpeedTest}
              disabled={isRunning}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Testing...' : 'Run Speed Test'}
            </button>
          </div>
        </div>
      </div>

      {/* Speed Test Progress Bar */}
      {isRunning && total > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">
              Testing servers... {completed}/{total} complete
            </span>
            <span className="text-sm text-gray-500">{pct}%</span>
          </div>
          <div className="bg-gray-800 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Server Table */}
      {sorted.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 text-center">
          <span className="text-sm text-gray-500">No download servers configured</span>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
                  {(
                    [
                      { key: 'server' as SortKey, label: 'Server' },
                      { key: 'location' as SortKey, label: 'Location' },
                      { key: 'status' as SortKey, label: 'Status' },
                      { key: 'speed' as SortKey, label: 'Speed' },
                      { key: 'streams' as SortKey, label: 'Streams' },
                      { key: 'downloaded' as SortKey, label: 'Downloaded' },
                      { key: 'error' as SortKey, label: 'Error' },
                    ]
                  ).map(({ key, label }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className="px-4 py-3 font-medium cursor-pointer hover:text-gray-300 select-none whitespace-nowrap"
                    >
                      {label}{sortArrow(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {sorted.map((server) => {
                  const cooldown = server.unhealthyUntil ? timeUntil(server.unhealthyUntil) : ''
                  const speedPct = maxSpeed > 0 ? (server.speedBps / maxSpeed) * 100 : 0

                  return (
                    <tr key={server.url} className={rowBg(server)}>
                      <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                        {formatUrl(server.url)}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {server.location || '\u2014'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(server.status)}`}>
                          {server.status === 'cooldown' && cooldown
                            ? `Cooldown (${cooldown})`
                            : server.status.charAt(0).toUpperCase() + server.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-300 min-w-[80px]">
                            {formatSpeed(server.speedBps)}
                          </span>
                          <div className="bg-gray-800 rounded-full h-1.5 w-20 flex-shrink-0">
                            <div
                              className="bg-green-500 h-1.5 rounded-full"
                              style={{ width: `${speedPct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-center">
                        {server.activeStreams}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {formatBytes(server.bytesDownloaded)}
                      </td>
                      <td className="px-4 py-3 text-red-400 text-xs max-w-[200px] truncate">
                        {server.lastError
                          ? server.lastError.length > 60
                            ? server.lastError.slice(0, 60) + '...'
                            : server.lastError
                          : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
