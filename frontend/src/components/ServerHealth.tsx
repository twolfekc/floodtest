import { useState, useEffect, useMemo, useCallback } from 'react'
import { api, ServerHealth as ServerHealthData, UploadServerHealth as UploadServerHealthData, SpeedTestResult } from '../api/client'

interface Props {
  speedTestRunning?: boolean
  speedTestCompleted?: number
  speedTestTotal?: number
}

// Normalized shape used by the shared table component
interface NormalizedServer {
  url: string
  location: string
  healthy: boolean
  blocked: boolean
  consecutiveFailures: number
  totalFailures: number
  totalCount: number
  lastError?: string
  lastErrorTime?: string
  unhealthyUntil?: string
  bytesTransferred: number
  speedBps: number
  activeStreams: number
  status: string
}

type SortKey = 'server' | 'location' | 'status' | 'speed' | 'streams' | 'transferred' | 'error'
type SortDir = 'asc' | 'desc'
type SectionType = 'download' | 'upload'

// ── Helper functions ──────────────────────────────────────────────────

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
    case 'blocked':
      return 'bg-red-900/50 text-red-400 border-red-800'
    default:
      return 'bg-gray-800 text-gray-400 border-gray-700'
  }
}

function rowBg(server: NormalizedServer): string {
  switch (server.status) {
    case 'testing':
      return 'bg-blue-900/10'
    case 'cooldown':
      return 'bg-yellow-900/10'
    case 'failed':
      return 'bg-red-900/10'
    case 'blocked':
      return 'bg-red-950/20 opacity-60'
    default:
      return ''
  }
}

function normalizeDownload(s: ServerHealthData): NormalizedServer {
  return {
    url: s.url,
    location: s.location,
    healthy: s.healthy,
    blocked: s.blocked,
    consecutiveFailures: s.consecutiveFailures,
    totalFailures: s.totalFailures,
    totalCount: s.totalDownloads,
    lastError: s.lastError,
    lastErrorTime: s.lastErrorTime,
    unhealthyUntil: s.unhealthyUntil,
    bytesTransferred: s.bytesDownloaded,
    speedBps: s.speedBps,
    activeStreams: s.activeStreams,
    status: s.status,
  }
}

function normalizeUpload(s: UploadServerHealthData): NormalizedServer {
  return {
    url: s.url,
    location: s.location,
    healthy: s.healthy,
    blocked: s.blocked,
    consecutiveFailures: s.consecutiveFailures,
    totalFailures: s.totalFailures,
    totalCount: s.totalUploads,
    lastError: s.lastError,
    lastErrorTime: s.lastErrorTime,
    unhealthyUntil: s.unhealthyUntil,
    bytesTransferred: s.bytesUploaded,
    speedBps: s.speedBps,
    activeStreams: s.activeStreams,
    status: s.status,
  }
}

function getCollapsed(section: SectionType): boolean {
  try {
    return localStorage.getItem(`serverHealth.${section}.collapsed`) === 'true'
  } catch {
    return false
  }
}

function setCollapsed(section: SectionType, collapsed: boolean) {
  try {
    localStorage.setItem(`serverHealth.${section}.collapsed`, String(collapsed))
  } catch {
    // ignore storage errors
  }
}

// ── Status counts ─────────────────────────────────────────────────────

interface StatusCounts {
  total: number
  healthy: number
  cooldown: number
  failed: number
  blocked: number
  testing: number
}

function computeCounts(servers: NormalizedServer[]): StatusCounts {
  return {
    total: servers.length,
    healthy: servers.filter((s) => s.status === 'healthy').length,
    cooldown: servers.filter((s) => s.status === 'cooldown').length,
    failed: servers.filter((s) => s.status === 'failed').length,
    blocked: servers.filter((s) => s.status === 'blocked').length,
    testing: servers.filter((s) => s.status === 'testing').length,
  }
}

// ── Inline status badges for the header ───────────────────────────────

function InlineStatusCounts({ counts }: { counts: StatusCounts }) {
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-gray-400">
        <span className="text-white font-medium">{counts.total}</span> Total
      </span>
      {counts.healthy > 0 && (
        <span className="text-green-400">
          <span className="font-medium">{counts.healthy}</span> Healthy
        </span>
      )}
      {counts.cooldown > 0 && (
        <span className="text-yellow-400">
          <span className="font-medium">{counts.cooldown}</span> Cooldown
        </span>
      )}
      {counts.failed > 0 && (
        <span className="text-red-400">
          <span className="font-medium">{counts.failed}</span> Failed
        </span>
      )}
      {counts.blocked > 0 && (
        <span className="text-red-400">
          <span className="font-medium">{counts.blocked}</span> Blocked
        </span>
      )}
      {counts.testing > 0 && (
        <span className="text-blue-400">
          <span className="font-medium">{counts.testing}</span> Testing
        </span>
      )}
    </span>
  )
}

// ── Sortable server table ─────────────────────────────────────────────

interface ServerTableProps {
  servers: NormalizedServer[]
  section: SectionType
  onUnblock: (url: string) => void
}

function ServerTable({ servers, section, onUnblock }: ServerTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('speed')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'speed' || key === 'transferred' || key === 'streams' ? 'desc' : 'asc')
    }
  }

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  const sorted = useMemo(() => {
    return [...servers].sort((a, b) => {
      // Three-tier: healthy/testing first, then cooldown, then blocked
      const tierOrder: Record<string, number> = { healthy: 0, testing: 0, cooldown: 1, blocked: 2, failed: 2 }
      const aTier = tierOrder[a.status] ?? 1
      const bTier = tierOrder[b.status] ?? 1
      if (aTier !== bTier) return aTier - bTier

      // Within same tier, apply column sort
      const dir = sortDir === 'asc' ? 1 : -1
      let cmp = 0
      switch (sortKey) {
        case 'server':
          cmp = formatUrl(a.url).localeCompare(formatUrl(b.url)); break
        case 'location':
          cmp = (a.location || '').localeCompare(b.location || ''); break
        case 'status': {
          const order: Record<string, number> = { healthy: 0, testing: 1, cooldown: 2, failed: 3, blocked: 4 }
          cmp = (order[a.status] ?? 5) - (order[b.status] ?? 5); break
        }
        case 'speed':
          cmp = a.speedBps - b.speedBps; break
        case 'streams':
          cmp = a.activeStreams - b.activeStreams; break
        case 'transferred':
          cmp = a.bytesTransferred - b.bytesTransferred; break
        case 'error':
          cmp = (a.lastError || '').localeCompare(b.lastError || ''); break
      }
      return dir * cmp
    })
  }, [servers, sortKey, sortDir])

  const maxSpeed = useMemo(() => {
    return Math.max(...servers.map((s) => s.speedBps), 1)
  }, [servers])

  const speedBarColor = section === 'download' ? 'bg-cyan-500' : 'bg-violet-500'

  const columns: { key: SortKey; label: string }[] = [
    { key: 'server', label: 'Server' },
    { key: 'location', label: 'Location' },
    { key: 'status', label: 'Status' },
    { key: 'speed', label: 'Speed' },
    { key: 'streams', label: 'Streams' },
    { key: 'transferred', label: 'Transferred' },
    { key: 'error', label: 'Error' },
  ]

  if (servers.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <span className="text-sm text-gray-500">
          No {section} servers configured
        </span>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
            {columns.map(({ key, label }) => (
              <th
                key={key}
                onClick={() => handleSort(key)}
                className="px-4 py-2 font-medium cursor-pointer hover:text-gray-300 select-none whitespace-nowrap"
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
                <td className="px-4 py-2 text-white font-medium whitespace-nowrap">
                  {formatUrl(server.url)}
                </td>
                <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                  {server.location || '\u2014'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(server.status)}`}>
                    {server.status === 'cooldown' && cooldown
                      ? `Cooldown (${cooldown})`
                      : server.status.charAt(0).toUpperCase() + server.status.slice(1)}
                  </span>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-300 min-w-[80px]">
                      {formatSpeed(server.speedBps)}
                    </span>
                    <div className="bg-gray-800 rounded-full h-1.5 w-20 flex-shrink-0">
                      <div
                        className={`${speedBarColor} h-1.5 rounded-full`}
                        style={{ width: `${speedPct}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2 text-gray-400 text-center">
                  {server.activeStreams}
                </td>
                <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                  {formatBytes(server.bytesTransferred)}
                </td>
                <td className="px-4 py-2 text-xs max-w-[200px]">
                  {server.status === 'blocked' ? (
                    <button
                      onClick={() => onUnblock(server.url)}
                      className="px-2 py-1 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-300"
                    >
                      Unblock
                    </button>
                  ) : (
                    <span
                      className="text-red-400 max-w-xs truncate block"
                      title={server.lastError || undefined}
                    >
                      {server.lastError
                        ? server.lastError.length > 60
                          ? server.lastError.slice(0, 60) + '...'
                          : server.lastError
                        : ''}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────

export default function ServerHealth({ speedTestRunning, speedTestCompleted, speedTestTotal }: Props) {
  const [downloadServers, setDownloadServers] = useState<ServerHealthData[]>([])
  const [uploadServers, setUploadServers] = useState<UploadServerHealthData[]>([])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [lastTestTime, setLastTestTime] = useState<string | null>(null)
  const [downloadCollapsed, setDownloadCollapsed] = useState(() => getCollapsed('download'))
  const [uploadCollapsed, setUploadCollapsed] = useState(() => getCollapsed('upload'))

  const isRunning = speedTestRunning || testing

  // Fetch both download and upload health on same interval
  useEffect(() => {
    const fetchHealth = () => {
      Promise.all([
        api.getServerHealth(),
        api.getUploadServerHealth(),
      ]).then(([dl, ul]) => {
        setDownloadServers(dl)
        setUploadServers(ul)
        setLoading(false)
      }).catch(() => {
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
      const data = await api.getServerHealth()
      setDownloadServers(data)
    } catch {
      // ignore errors
    } finally {
      setTesting(false)
    }
  }

  const handleUnblockDownload = useCallback(async (url: string) => {
    try {
      await api.unblockServer(url)
    } catch (err) {
      console.error('Unblock failed:', err)
    }
  }, [])

  const handleUnblockAllDownloads = async () => {
    try {
      await api.unblockAll()
    } catch (err) {
      console.error('Unblock all failed:', err)
    }
  }

  const handleUnblockUpload = useCallback(async (url: string) => {
    try {
      await api.unblockUploadServer(url)
    } catch (err) {
      console.error('Unblock upload failed:', err)
    }
  }, [])

  const handleUnblockAllUploads = async () => {
    try {
      await api.unblockAllUploads()
    } catch (err) {
      console.error('Unblock all uploads failed:', err)
    }
  }

  const toggleDownload = () => {
    const next = !downloadCollapsed
    setDownloadCollapsed(next)
    setCollapsed('download', next)
  }

  const toggleUpload = () => {
    const next = !uploadCollapsed
    setUploadCollapsed(next)
    setCollapsed('upload', next)
  }

  // Normalize data
  const normalizedDownloads = useMemo(() => downloadServers.map(normalizeDownload), [downloadServers])
  const normalizedUploads = useMemo(() => uploadServers.map(normalizeUpload), [uploadServers])

  const downloadCounts = useMemo(() => computeCounts(normalizedDownloads), [normalizedDownloads])
  const uploadCounts = useMemo(() => computeCounts(normalizedUploads), [normalizedUploads])

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
    <div className="space-y-2">
      {/* Download Servers Section */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {/* Collapsible header */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-800/50 transition-colors border-b border-cyan-900/30"
          onClick={toggleDownload}
        >
          <div className="flex items-center gap-3">
            <span className="text-cyan-400 text-sm">
              {downloadCollapsed ? '\u25B8' : '\u25BE'}
            </span>
            <span className="text-sm font-semibold text-cyan-400">Download Servers</span>
            <InlineStatusCounts counts={downloadCounts} />
          </div>

          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {lastTestTime && (
              <span className="text-xs text-gray-500">
                Last test: {new Date(lastTestTime).toLocaleTimeString()}
              </span>
            )}
            {downloadCounts.blocked > 0 && (
              <button
                onClick={handleUnblockAllDownloads}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800"
              >
                Unblock All ({downloadCounts.blocked})
              </button>
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

        {/* Speed Test Progress Bar — between header and table */}
        {!downloadCollapsed && isRunning && total > 0 && (
          <div className="px-4 py-3 border-b border-gray-800">
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

        {/* Table */}
        {!downloadCollapsed && (
          <ServerTable
            servers={normalizedDownloads}
            section="download"
            onUnblock={handleUnblockDownload}
          />
        )}
      </div>

      {/* Upload Servers Section */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {/* Collapsible header */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-800/50 transition-colors border-b border-violet-900/30"
          onClick={toggleUpload}
        >
          <div className="flex items-center gap-3">
            <span className="text-violet-400 text-sm">
              {uploadCollapsed ? '\u25B8' : '\u25BE'}
            </span>
            <span className="text-sm font-semibold text-violet-400">Upload Servers</span>
            <InlineStatusCounts counts={uploadCounts} />
          </div>

          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {uploadCounts.blocked > 0 && (
              <button
                onClick={handleUnblockAllUploads}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800"
              >
                Unblock All ({uploadCounts.blocked})
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        {!uploadCollapsed && (
          <ServerTable
            servers={normalizedUploads}
            section="upload"
            onUnblock={handleUnblockUpload}
          />
        )}
      </div>
    </div>
  )
}
