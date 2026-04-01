import { useState, useEffect } from 'react'
import { WsStats } from '../hooks/useWebSocket'
import { api, UsageCounters } from '../api/client'
import ServerHealth from './ServerHealth'

interface DashboardProps {
  ws: { stats: WsStats; connected: boolean }
}

function formatSpeed(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`
  return `${(bps / 1e3).toFixed(2)} Kbps`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${(bytes / 1e6).toFixed(2)} MB`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}h ${m}m ${s}s`
}

export default function Dashboard({ ws }: DashboardProps) {
  const { stats, connected } = ws
  const [usage, setUsage] = useState<UsageCounters | null>(null)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    const fetchUsage = () => {
      api.getUsage().then(setUsage).catch(() => {})
    }
    fetchUsage()
    const interval = setInterval(fetchUsage, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleToggle = async () => {
    setToggling(true)
    try {
      if (stats.running) {
        await api.stop()
      } else {
        await api.start()
      }
    } catch {
      // ignore errors
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header row: title + connection indicator */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">FloodTest Dashboard</h2>
        <div className="flex items-center gap-4">
          {stats.totalServers > 0 && (
            <div className="flex items-center gap-1.5">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  stats.healthyServers === stats.totalServers
                    ? 'bg-green-500'
                    : stats.healthyServers < stats.totalServers * 0.5
                      ? 'bg-red-500'
                      : 'bg-yellow-500'
                }`}
              />
              <span className="text-sm text-gray-400">
                {stats.healthyServers}/{stats.totalServers} servers
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-sm text-gray-400">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* Start/Stop button + uptime */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleToggle}
          disabled={toggling}
          className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 ${
            stats.running
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {toggling ? '...' : stats.running ? 'Stop' : 'Start'}
        </button>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
              stats.running
                ? 'bg-green-900/50 text-green-400 border border-green-800'
                : 'bg-gray-800 text-gray-400 border border-gray-700'
            }`}
          >
            {stats.running ? 'Running' : 'Stopped'}
          </span>
        </div>
        {stats.running && stats.uptimeSeconds > 0 && (
          <span className="text-sm text-gray-400">
            Uptime: {formatDuration(stats.uptimeSeconds)}
          </span>
        )}
      </div>

      {/* Speed cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Download speed */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-400 uppercase tracking-wide">
              Download
            </span>
            <svg
              className="w-5 h-5 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
          </div>
          <div className="text-4xl font-bold text-green-400">
            {formatSpeed(stats.downloadBps)}
          </div>
          <div className="mt-2 text-sm text-gray-500">
            {stats.downloadStreams} stream{stats.downloadStreams !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Upload speed */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-400 uppercase tracking-wide">
              Upload
            </span>
            <svg
              className="w-5 h-5 text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 10l7-7m0 0l7 7m-7-7v18"
              />
            </svg>
          </div>
          <div className="text-4xl font-bold text-blue-400">
            {formatSpeed(stats.uploadBps)}
          </div>
          <div className="mt-2 text-sm text-gray-500">
            {stats.uploadStreams} stream{stats.uploadStreams !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Cumulative usage */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-3">Cumulative Usage</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(
            [
              { label: 'Session', key: 'session' },
              { label: 'Today', key: 'today' },
              { label: 'This Month', key: 'month' },
              { label: 'All-Time', key: 'allTime' },
            ] as const
          ).map(({ label, key }) => (
            <div
              key={key}
              className="bg-gray-900 rounded-xl border border-gray-800 p-4"
            >
              <div className="text-sm font-medium text-gray-400 mb-2">
                {label}
              </div>
              {usage ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Down</span>
                    <span className="text-sm font-semibold text-green-400">
                      {formatBytes(usage[key].downloadBytes)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Up</span>
                    <span className="text-sm font-semibold text-blue-400">
                      {formatBytes(usage[key].uploadBytes)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600">Loading...</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Server Health */}
      <ServerHealth
        speedTestRunning={ws.stats.speedTestRunning}
        speedTestCompleted={ws.stats.speedTestCompleted}
        speedTestTotal={ws.stats.speedTestTotal}
      />
    </div>
  )
}
