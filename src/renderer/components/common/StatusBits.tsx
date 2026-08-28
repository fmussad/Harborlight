import type { ReactElement, ReactNode } from 'react'
import type { ContainerState, HealthState, PortBinding } from '@shared/schemas/domain'
import { formatPort } from '@shared/utils/format'
import { cn } from '@/lib/cn'
import { Badge, Tooltip } from '@/components/ui/primitives'

const STATE_TONE: Record<ContainerState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  running: 'success',
  restarting: 'warning',
  paused: 'warning',
  created: 'neutral',
  removing: 'warning',
  exited: 'neutral',
  dead: 'danger'
}

const STATE_LABEL: Record<ContainerState, string> = {
  running: 'Running',
  restarting: 'Restarting',
  paused: 'Paused',
  created: 'Created',
  removing: 'Removing',
  exited: 'Exited',
  dead: 'Dead'
}

export function StateBadge({
  state,
  exitCode
}: {
  state: ContainerState
  exitCode?: number | null
}): ReactElement {
  const label =
    state === 'exited' && typeof exitCode === 'number' ? `Exited (${exitCode})` : STATE_LABEL[state]
  return (
    <Badge tone={STATE_TONE[state]} dot={state === 'running'}>
      {label}
    </Badge>
  )
}

export function HealthDot({ health }: { health: HealthState }): ReactElement | null {
  if (health === 'none') return <span className="text-xs text-ink-muted">—</span>

  const tone =
    health === 'healthy' ? 'bg-success' : health === 'unhealthy' ? 'bg-danger' : 'bg-warning'
  const label = health === 'healthy' ? 'Healthy' : health === 'unhealthy' ? 'Unhealthy' : 'Starting'

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
      <span
        className={cn('size-1.5 rounded-full', tone, health === 'starting' && 'animate-pulse')}
      />
      {label}
    </span>
  )
}

/** Shows the first published port and rolls the rest into a tooltip. */
export function PortsCell({ ports }: { ports: PortBinding[] }): ReactElement {
  const published = ports.filter((port) => port.publicPort)
  if (published.length === 0) return <span className="text-ink-muted">—</span>

  const [first, ...rest] = published
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span className="text-ink-secondary">{formatPort(first!)}</span>
      {rest.length > 0 ? (
        <Tooltip content={<span className="font-mono">{rest.map(formatPort).join(', ')}</span>}>
          <span className="cursor-default rounded bg-surface-2 px-1 text-[10px] text-ink-muted">
            +{rest.length}
          </span>
        </Tooltip>
      ) : null}
    </span>
  )
}

export function MonoText({
  children,
  className,
  title
}: {
  children: ReactNode
  className?: string
  title?: string
}): ReactElement {
  return (
    <span
      title={title}
      className={cn('selectable font-mono text-xs text-ink-secondary', className)}
    >
      {children}
    </span>
  )
}
