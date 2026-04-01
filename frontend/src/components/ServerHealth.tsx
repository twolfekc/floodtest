import { useState, useEffect } from 'react'
import { api, ServerHealth as ServerHealthData } from '../api/client'

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
  return `${(bytes / 1e6).toFixed(2)} MB`
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

export default function ServerHealth() {
  const [servers, setServers] = useState<ServerHealthData[]>([])
  const [loading, setLoading] = useState(true)

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
    const interval = setInterval(fetchHealth, 10000)
    return () => clearInterval(interval)
  }, [])

  const sorted = [...servers].sort((a, b) => {
    if (a.healthy !== b.healthy) return a.healthy ? 1 : -1
    return b.totalDownloads - a.totalDownloads
  })

  const healthyCount = servers.filter((s) => s.healthy).length
  const totalCount = servers.length

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="text-sm text-gray-500">Loading server health...</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">Server Health</h3>
        <span className="text-sm text-gray-400">
          {healthyCount} / {totalCount} servers healthy
        </span>
      </div>

      <div className="space-y-3">
        {sorted.map((server) => {
          const cooldown = server.unhealthyUntil
            ? timeUntil(server.unhealthyUntil)
            : ''
          const isCooldown = !server.healthy && cooldown !== ''

          return (
            <div
              key={server.url}
              className={`bg-gray-900 rounded-xl border border-gray-800 p-4 ${
                !server.healthy ? 'border-l-4 border-l-red-500' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-white">
                    {formatUrl(server.url)}
                  </span>
                  {server.healthy ? (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/50 text-green-400 border border-green-800">
                      Healthy
                    </span>
                  ) : isCooldown ? (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900/50 text-yellow-400 border border-yellow-800">
                      Cooldown
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/50 text-red-400 border border-red-800">
                      Blocked
                    </span>
                  )}
                </div>
                {isCooldown && (
                  <span className="text-xs text-yellow-400">
                    back in {cooldown}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {server.consecutiveFailures > 0 && (
                  <div>
                    <span className="text-gray-500">Failures: </span>
                    <span className="text-red-400">
                      {server.consecutiveFailures}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-gray-500">Downloads: </span>
                  <span className="text-gray-300">
                    {server.totalDownloads}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Data: </span>
                  <span className="text-gray-300">
                    {formatBytes(server.bytesDownloaded)}
                  </span>
                </div>
                {server.lastError && (
                  <div className="col-span-2 md:col-span-4 truncate">
                    <span className="text-gray-500">Last error: </span>
                    <span className="text-red-400 text-xs">
                      {server.lastError.length > 80
                        ? server.lastError.slice(0, 80) + '...'
                        : server.lastError}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {sorted.length === 0 && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 text-center">
            <span className="text-sm text-gray-500">
              No download servers configured
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
