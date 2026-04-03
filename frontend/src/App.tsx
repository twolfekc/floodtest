import { Suspense, lazy, useEffect, useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { Gauge, BarChart3, Clock, Settings as SettingsIcon, RefreshCw, Server, Flame, Menu, X } from 'lucide-react'
import { api } from './api/client'
import { useWebSocket } from './hooks/useWebSocket'
import Dashboard from './components/Dashboard'

const Charts = lazy(() => import('./components/Charts'))
const SchedulePage = lazy(() => import('./components/Schedule'))
const SettingsPage = lazy(() => import('./components/Settings'))
const SetupWizard = lazy(() => import('./components/SetupWizard'))
const UpdatesPage = lazy(() => import('./components/Updates'))
const ServerHealth = lazy(() => import('./components/ServerHealth'))

const mainNav = [
  { to: '/', icon: Gauge, label: 'Dashboard' },
  { to: '/charts', icon: BarChart3, label: 'Charts' },
  { to: '/schedule', icon: Clock, label: 'Schedule' },
  { to: '/servers', icon: Server, label: 'Servers' },
]
const bottomNav = [
  { to: '/settings', icon: SettingsIcon, label: 'Settings' },
  { to: '/updates', icon: RefreshCw, label: 'Updates' },
]

function NavItem({ to, icon: Icon, label, onClick }: { to: string; icon: typeof Gauge; label: string; onClick?: () => void }) {
  const location = useLocation()
  const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={`nav-indicator group relative flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
        isActive
          ? 'active bg-amber-500/10 text-amber-400'
          : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]'
      }`}
    >
      <div className={`relative transition-transform duration-200 ${isActive ? '' : 'group-hover:scale-110'}`}>
        <Icon size={18} strokeWidth={isActive ? 2.5 : 1.8} />
        {isActive && <div className="absolute inset-0 blur-md bg-amber-500/40" />}
      </div>
      <span className="relative">{label}</span>
      {isActive && <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-amber-500 animate-breathe" />}
    </NavLink>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {/* Brand */}
      <div className="px-5 py-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Flame size={18} className="text-white" strokeWidth={2.5} />
            </div>
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 blur-lg opacity-30 animate-breathe" />
          </div>
          <div>
            <div className="text-base font-bold text-gradient-fire tracking-tight">FloodTest</div>
            <div className="text-[10px] text-zinc-600 font-medium tracking-widest uppercase">Forge Engine</div>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 flex flex-col px-3 py-4 gap-1">
        <div className="px-3 mb-2">
          <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.15em]">Monitor</span>
        </div>
        {mainNav.map((item) => (
          <NavItem key={item.to} {...item} onClick={onNavigate} />
        ))}
      </nav>

      {/* Bottom nav */}
      <nav className="px-3 py-3 border-t border-white/[0.06] flex flex-col gap-1">
        <div className="px-3 mb-1">
          <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.15em]">System</span>
        </div>
        {bottomNav.map((item) => (
          <NavItem key={item.to} {...item} onClick={onNavigate} />
        ))}
      </nav>

      {/* Version badge */}
      <div className="px-5 py-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] text-zinc-600 font-mono">System Online</span>
        </div>
      </div>
    </>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const closeMobile = useCallback(() => setMobileMenuOpen(false), [])

  return (
    <div className="min-h-screen bg-forge-base">
      {/* Ambient background glow */}
      <div className="fixed top-0 left-0 lg:left-56 right-0 h-[300px] bg-gradient-to-b from-amber-500/[0.03] to-transparent pointer-events-none" />

      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 h-14 bg-forge-surface/90 backdrop-blur-lg border-b border-white/[0.06] flex items-center justify-between px-4 z-50 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <Flame size={16} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-bold text-gradient-fire">FloodTest</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="w-9 h-9 rounded-lg bg-forge-raised flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={closeMobile}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <aside
            className="absolute top-14 left-0 bottom-0 w-64 bg-forge-surface border-r border-white/[0.06] flex flex-col animate-slide-in-left overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent onNavigate={closeMobile} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed top-0 left-0 h-screen w-56 glass border-r border-white/[0.06] flex-col z-40 hidden lg:flex">
        <SidebarContent />
      </aside>

      {/* Main content */}
      <main className="pt-14 lg:pt-0 lg:ml-56 p-4 lg:p-6 relative">
        {children}
      </main>
    </div>
  )
}

function ScreenLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-forge-base">
      <div className="text-center animate-fade-in">
        <div className="relative inline-block mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center animate-float">
            <Flame size={24} className="text-white" strokeWidth={2.5} />
          </div>
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 blur-xl opacity-40 animate-breathe" />
        </div>
        <div className="text-lg font-bold text-gradient-fire mb-1">FloodTest</div>
        <div className="text-zinc-500 text-sm">Initializing engine...</div>
      </div>
    </div>
  )
}

export default function App() {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [setupDone, setSetupDone] = useState(false)
  const ws = useWebSocket()

  useEffect(() => {
    api.isSetupRequired()
      .then((r) => setSetupRequired(r.required))
      .catch(() => setSetupRequired(false))
  }, [])

  if (setupRequired === null) {
    return <ScreenLoader />
  }

  if (setupRequired && !setupDone) {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <SetupWizard onComplete={() => setSetupDone(true)} />
      </Suspense>
    )
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<ScreenLoader />}>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard ws={ws} />} />
            <Route path="/charts" element={<Charts />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/updates" element={<UpdatesPage />} />
            <Route path="/servers" element={<ServerHealth />} />
          </Routes>
        </Layout>
      </Suspense>
    </BrowserRouter>
  )
}
