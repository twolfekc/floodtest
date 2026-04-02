import { useState, useEffect, useMemo, useCallback } from 'react'
import { api, ServerHealth as ServerHealthData, UploadServerHealth as UploadServerHealthData, SpeedTestResult } from '../api/client'
import ProviderAccordion from './ProviderAccordion'

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

type SectionType = 'download' | 'upload'

// ── Helper functions ──────────────────────────────────────────────────


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

        {/* Provider-grouped accordion */}
        {!downloadCollapsed && (
          <ProviderAccordion
            downloadServers={downloadServers}
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

        {/* Provider-grouped accordion */}
        {!uploadCollapsed && (
          <ProviderAccordion
            uploadServers={uploadServers}
            onUnblock={handleUnblockUpload}
          />
        )}
      </div>
    </div>
  )
}
