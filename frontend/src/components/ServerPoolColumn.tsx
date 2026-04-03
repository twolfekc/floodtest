import { Server, CheckCircle, AlertCircle, Globe, Waves } from 'lucide-react'
import { WsStats } from '../hooks/useWebSocket'

interface ServerPoolColumnProps {
  stats: WsStats
  providerCount: number
}

export default function ServerPoolColumn({ stats, providerCount }: ServerPoolColumnProps) {
  const healthy = stats.healthyServers
  const total = stats.totalServers
  const unhealthy = total - healthy
  const healthPct = total > 0 ? Math.round((healthy / total) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Server size={14} className="text-zinc-500" />
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Server Pool</h3>
      </div>

      {/* Health ring visual */}
      <div className="flex items-center gap-4">
        <div className="relative w-14 h-14">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#27272a" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15" fill="none"
              stroke={healthPct >= 90 ? '#22c55e' : healthPct >= 60 ? '#f59e0b' : '#ef4444'}
              strokeWidth="3"
              strokeDasharray={`${healthPct * 0.942} 100`}
              strokeLinecap="round"
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold font-mono text-zinc-200">{healthPct}%</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <CheckCircle size={13} className="text-emerald-500" />
            <span className="text-sm font-medium text-zinc-300">{healthy} healthy</span>
          </div>
          {unhealthy > 0 && (
            <div className="flex items-center gap-2">
              <AlertCircle size={13} className="text-amber-500" />
              <span className="text-sm font-medium text-zinc-400">{unhealthy} degraded</span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2 pt-1 border-t border-white/[0.04]">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Globe size={13} className="text-zinc-500" />
          <span>{providerCount} providers</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Waves size={13} className="text-zinc-500" />
          <span>{stats.downloadStreams + stats.uploadStreams} active streams</span>
        </div>
      </div>
    </div>
  )
}
