import { useState, useMemo } from 'react'
import { ServerHealth, UploadServerHealth } from '../api/client'
import { extractProvider } from '../utils/providerGrouping'

// ── Types ────────────────────────────────────────────────────────────

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

interface ProviderSection {
  name: string
  color: string
  servers: NormalizedServer[]
  totalSpeed: number
  healthyCount: number
}

export interface ProviderAccordionProps {
  downloadServers?: ServerHealth[]
  uploadServers?: UploadServerHealth[]
  onUnblock?: (url: string) => void
}

// ── Color palette (Tailwind classes) ─────────────────────────────────

const PROVIDER_DOT_COLORS = [
  'bg-cyan-500', 'bg-violet-500', 'bg-emerald-500', 'bg-pink-500', 'bg-orange-500',
  'bg-yellow-500', 'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-red-500',
]

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeDownload(s: ServerHealth): NormalizedServer {
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

function normalizeUpload(s: UploadServerHealth): NormalizedServer {
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

// ── Grouping logic ───────────────────────────────────────────────────

function buildProviderSections(servers: NormalizedServer[]): ProviderSection[] {
  const groupMap = new Map<string, NormalizedServer[]>()

  for (const s of servers) {
    const provider = extractProvider(s.url)
    const list = groupMap.get(provider) || []
    list.push(s)
    groupMap.set(provider, list)
  }

  // Assign colors stably by provider name sorted alphabetically
  const providerNames = Array.from(groupMap.keys()).sort()
  const colorMap = new Map<string, string>()
  providerNames.forEach((name, i) => {
    colorMap.set(name, PROVIDER_DOT_COLORS[i % PROVIDER_DOT_COLORS.length])
  })

  const sections: ProviderSection[] = []
  for (const [name, srvs] of groupMap) {
    const totalSpeed = srvs.reduce((sum, s) => sum + s.speedBps, 0)
    const healthyCount = srvs.filter(s => s.status === 'healthy' || s.status === 'testing').length
    sections.push({
      name,
      color: colorMap.get(name) || 'bg-gray-500',
      servers: srvs,
      totalSpeed,
      healthyCount,
    })
  }

  // Sort: unhealthy providers (those with any non-healthy server) float to top,
  // then by total speed descending
  sections.sort((a, b) => {
    const aUnhealthy = a.servers.some(s => s.status === 'failed' || s.status === 'blocked' || s.status === 'cooldown')
    const bUnhealthy = b.servers.some(s => s.status === 'failed' || s.status === 'blocked' || s.status === 'cooldown')
    if (aUnhealthy !== bUnhealthy) return aUnhealthy ? -1 : 1
    return b.totalSpeed - a.totalSpeed
  })

  return sections
}

// ── Component ────────────────────────────────────────────────────────

export default function ProviderAccordion({ downloadServers, uploadServers, onUnblock }: ProviderAccordionProps) {
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(() => new Set())
  const [allExpanded, setAllExpanded] = useState(false)

  const normalized = useMemo(() => {
    if (downloadServers) return downloadServers.map(normalizeDownload)
    if (uploadServers) return uploadServers.map(normalizeUpload)
    return []
  }, [downloadServers, uploadServers])

  const sections = useMemo(() => buildProviderSections(normalized), [normalized])

  const toggleProvider = (name: string) => {
    setExpandedProviders(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedProviders(new Set())
      setAllExpanded(false)
    } else {
      setExpandedProviders(new Set(sections.map(s => s.name)))
      setAllExpanded(true)
    }
  }

  // Sync allExpanded state when individual toggles change
  const effectiveAllExpanded = sections.length > 0 && sections.every(s => expandedProviders.has(s.name))

  if (normalized.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <span className="text-sm text-gray-500">No servers configured</span>
      </div>
    )
  }

  return (
    <div>
      {/* Expand All / Collapse All */}
      <div className="flex justify-end px-4 py-2 border-b border-gray-800">
        <button
          onClick={toggleAll}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {effectiveAllExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Provider sections */}
      <div className="divide-y divide-gray-800">
        {sections.map(section => {
          const isExpanded = expandedProviders.has(section.name)

          return (
            <div key={section.name}>
              {/* Provider header */}
              <button
                onClick={() => toggleProvider(section.name)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 transition-colors text-left"
              >
                <span className="text-gray-500 text-xs w-3">
                  {isExpanded ? '\u25BE' : '\u25B8'}
                </span>
                <span className="text-sm font-medium text-white">{section.name}</span>
                <span className={`w-2.5 h-2.5 rounded-full ${section.color} flex-shrink-0`} />
                <span className="text-xs text-gray-500 flex items-center gap-1.5">
                  <span>{section.servers.length} server{section.servers.length !== 1 ? 's' : ''}</span>
                  <span className="text-gray-700">&middot;</span>
                  <span className="text-gray-400">{formatSpeed(section.totalSpeed)}</span>
                  <span className="text-gray-700">&middot;</span>
                  <span className={section.healthyCount === section.servers.length ? 'text-green-500' : 'text-yellow-500'}>
                    {section.healthyCount}/{section.servers.length}
                  </span>
                </span>
              </button>

              {/* Expanded server table */}
              {isExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
                        <th className="px-4 py-1.5 pl-10 font-medium">Server</th>
                        <th className="px-4 py-1.5 font-medium">Location</th>
                        <th className="px-4 py-1.5 font-medium">Speed</th>
                        <th className="px-4 py-1.5 font-medium">Streams</th>
                        <th className="px-4 py-1.5 font-medium">Transferred</th>
                        <th className="px-4 py-1.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {section.servers
                        .slice()
                        .sort((a, b) => b.speedBps - a.speedBps)
                        .map(server => {
                          const cooldown = server.unhealthyUntil ? timeUntil(server.unhealthyUntil) : ''
                          return (
                            <tr key={server.url} className={rowBg(server)}>
                              <td className="px-4 py-1.5 pl-10 text-white font-medium whitespace-nowrap">
                                {formatUrl(server.url)}
                              </td>
                              <td className="px-4 py-1.5 text-gray-400 whitespace-nowrap">
                                {server.location || '\u2014'}
                              </td>
                              <td className="px-4 py-1.5 text-gray-300 whitespace-nowrap">
                                {formatSpeed(server.speedBps)}
                              </td>
                              <td className="px-4 py-1.5 text-gray-400 text-center">
                                {server.activeStreams}
                              </td>
                              <td className="px-4 py-1.5 text-gray-400 whitespace-nowrap">
                                {formatBytes(server.bytesTransferred)}
                              </td>
                              <td className="px-4 py-1.5 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(server.status)}`}>
                                    {server.status === 'cooldown' && cooldown
                                      ? `Cooldown (${cooldown})`
                                      : server.status.charAt(0).toUpperCase() + server.status.slice(1)}
                                  </span>
                                  {server.status === 'blocked' && onUnblock && (
                                    <button
                                      onClick={() => onUnblock(server.url)}
                                      className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-300"
                                    >
                                      Unblock
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
