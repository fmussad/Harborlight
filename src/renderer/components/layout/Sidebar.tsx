import type { ComponentType, ReactElement } from 'react'
import {
  Boxes,
  Database,
  Gauge,
  Layers,
  Network,
  Server,
  Settings as SettingsIcon,
  SquareStack
} from 'lucide-react'
import type { EngineStatus } from '@shared/schemas/domain'
import { cn } from '@/lib/cn'
import { describeEngine } from '@/lib/engine'
import { useUiStore, type Section } from '@/stores/ui'
import { LogoWordmark } from './Logo'

interface NavItem {
  section: Section
  label: string
  icon: ComponentType<{ className?: string }>
}

const PRIMARY_NAV: NavItem[] = [
  { section: 'overview', label: 'Overview', icon: Gauge },
  { section: 'containers', label: 'Containers', icon: Boxes },
  { section: 'compose', label: 'Compose', icon: SquareStack },
  { section: 'images', label: 'Images', icon: Layers },
  { section: 'volumes', label: 'Volumes', icon: Database },
  { section: 'networks', label: 'Networks', icon: Network },
  { section: 'registry', label: 'Registry', icon: Server }
]

const SETTINGS_NAV: NavItem = { section: 'settings', label: 'Settings', icon: SettingsIcon }

function NavButton({ item }: { item: NavItem }): ReactElement {
  const active = useUiStore((state) => state.section === item.section)
  const navigate = useUiStore((state) => state.navigate)
  const Icon = item.icon

  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => navigate(item.section)}
      className={cn(
        'flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-[13px] font-medium transition-colors',
        active
          ? 'bg-nav-active text-nav-active-fg'
          : 'text-ink-secondary hover:bg-surface-2 hover:text-ink'
      )}
    >
      <Icon className={cn('size-4 shrink-0', active ? 'text-nav-active-fg' : 'text-ink-muted')} />
      {item.label}
    </button>
  )
}

function EngineIndicator({
  status,
  version
}: {
  status?: EngineStatus
  version: string
}): ReactElement {
  const engine = describeEngine(status)
  return (
    <div className="rounded-card border border-line bg-surface-2 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className={cn('size-2 shrink-0 rounded-full', engine.dotClass)} aria-hidden />
        <span className="truncate text-xs font-medium text-ink-secondary">{engine.label}</span>
      </div>
      <p className="mt-1 pl-4 text-[11px] text-ink-muted">v{version}</p>
    </div>
  )
}

export function Sidebar({
  engineStatus,
  version
}: {
  engineStatus?: EngineStatus
  version: string
}): ReactElement {
  return (
    <nav
      aria-label="Main"
      className="flex w-[212px] shrink-0 flex-col border-r border-line bg-sidebar"
    >
      <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
        <LogoWordmark />
      </div>

      <div className="hl-scroll flex-1 px-2.5 py-3">
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => (
            <li key={item.section}>
              <NavButton item={item} />
            </li>
          ))}
        </ul>

        <div className="my-3 h-px bg-line" />

        <NavButton item={SETTINGS_NAV} />
      </div>

      <div className="shrink-0 p-2.5">
        <EngineIndicator status={engineStatus} version={version} />
      </div>
    </nav>
  )
}
