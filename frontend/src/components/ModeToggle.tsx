import { Shield, Zap } from 'lucide-react'

interface ModeToggleProps {
  mode: string
  onChange: (mode: string) => void
  compact?: boolean
}

export default function ModeToggle({ mode, onChange, compact }: ModeToggleProps) {
  const modes = [
    { key: 'reliable', label: 'Reliable', icon: Shield },
    { key: 'max', label: 'Max', icon: Zap },
  ]

  return (
    <div className={`inline-flex rounded-xl bg-forge-inset border border-white/[0.06] p-1 ${compact ? 'text-xs' : 'text-sm'}`}>
      {modes.map(m => {
        const Icon = m.icon
        const isActive = mode === m.key
        return (
          <button
            key={m.key}
            onClick={() => onChange(m.key)}
            className={`flex items-center gap-1.5 rounded-lg font-medium transition-all duration-200 ${
              compact ? 'px-3 py-1.5' : 'px-4 py-2'
            } ${
              isActive
                ? m.key === 'max'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/20 shadow-sm shadow-red-500/10'
                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/20 shadow-sm shadow-amber-500/10'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
          >
            <Icon size={compact ? 12 : 14} strokeWidth={isActive ? 2.5 : 2} />
            <span>{m.label}</span>
          </button>
        )
      })}
    </div>
  )
}
