import { ArrowDown, ArrowUp, Gauge, Zap } from 'lucide-react'
import { WsStats } from '../hooks/useWebSocket'

interface ThroughputColumnProps {
  stats: WsStats
  mode: string
}

function formatSpeed(bps: number): string {
  const gbps = bps / 1_000_000_000
  if (gbps >= 1) return `${gbps.toFixed(2)} Gbps`
  return `${(bps / 1_000_000).toFixed(0)} Mbps`
}

export default function ThroughputColumn({ stats, mode }: ThroughputColumnProps) {
  const targetBps = stats.measuredDownloadMbps * 1_000_000 * 0.9
  const efficiency = targetBps > 0 ? Math.min(100, Math.round((stats.downloadBps / targetBps) * 100)) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Gauge size={14} className="text-zinc-500" />
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Throughput</h3>
      </div>

      <div className="space-y-3">
        {/* Download speed */}
        <div className="group">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-md bg-orange-500/10 flex items-center justify-center">
              <ArrowDown size={12} className="text-orange-400" />
            </div>
            <span className="text-2xl font-bold text-orange-400 font-mono tabular-nums leading-none">
              {formatSpeed(stats.downloadBps)}
            </span>
          </div>
          {(stats.peakDownloadBps ?? 0) > 0 && (
            <span className="text-[10px] text-zinc-600 font-mono ml-7">peak {formatSpeed(stats.peakDownloadBps!)}</span>
          )}
        </div>

        {/* Upload speed */}
        <div className="group">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-md bg-slate-500/10 flex items-center justify-center">
              <ArrowUp size={12} className="text-slate-400" />
            </div>
            <span className="text-2xl font-bold text-slate-400 font-mono tabular-nums leading-none">
              {formatSpeed(stats.uploadBps)}
            </span>
          </div>
          {(stats.peakUploadBps ?? 0) > 0 && (
            <span className="text-[10px] text-zinc-600 font-mono ml-7">peak {formatSpeed(stats.peakUploadBps!)}</span>
          )}
        </div>
      </div>

      {/* Efficiency bar */}
      {mode === 'reliable' && targetBps > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500 font-mono">Target: {formatSpeed(targetBps)}</span>
            <span className={`font-bold font-mono ${efficiency >= 90 ? 'text-emerald-400' : efficiency >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
              {efficiency}%
            </span>
          </div>
          <div className="relative h-2 bg-forge-raised rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                efficiency >= 90 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                : efficiency >= 70 ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                : 'bg-gradient-to-r from-red-500 to-red-400'
              }`}
              style={{ width: `${Math.min(100, efficiency)}%` }}
            />
          </div>
        </div>
      )}

      {mode === 'max' && (
        <div className="flex items-center gap-1.5">
          <Zap size={12} className="text-red-400" />
          <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Unlimited</span>
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-zinc-500 font-mono pt-1 border-t border-white/[0.04]">
        <span className="flex items-center gap-1">
          <ArrowDown size={10} className="text-orange-400" />
          {stats.downloadStreams}
        </span>
        <span className="flex items-center gap-1">
          <ArrowUp size={10} className="text-slate-400" />
          {stats.uploadStreams}
        </span>
        <span className="text-zinc-600">streams</span>
      </div>
    </div>
  )
}
