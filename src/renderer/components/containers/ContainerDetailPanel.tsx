import type { ReactElement, ReactNode } from 'react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { Copy, ExternalLink, ScrollText, SquareTerminal, X } from 'lucide-react'
import type { ContainerDetail, ContainerStats } from '@shared/schemas/domain'
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatPort
} from '@shared/utils/format'
import { cn } from '@/lib/cn'
import { useContainerDetail, useContainerStats } from '@/lib/queries'
import { useUiStore, type ContainerPanel } from '@/stores/ui'
import { Badge, Button, Skeleton, Tooltip } from '@/components/ui/primitives'
import { Tabs } from '@/components/ui/overlays'
import { HealthDot, StateBadge } from '@/components/common/StatusBits'
import { useToast } from '@/providers/ToastProvider'
import { ContainerActions } from './ContainerActions'

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 py-[7px]">
      <span className="shrink-0 text-xs text-ink-muted">{label}</span>
      <span className="min-w-0 text-right text-xs text-ink-secondary">{children}</span>
    </div>
  )
}

function CopyableId({ value }: { value: string }): ReactElement {
  const { toast } = useToast()
  return (
    <button
      type="button"
      className="selectable inline-flex items-center gap-1 font-mono text-[11px] text-ink-secondary hover:text-ink"
      onClick={() => {
        void navigator.clipboard.writeText(value)
        toast({ level: 'success', title: 'Copied to clipboard', message: value })
      }}
    >
      {value.slice(0, 12)}
      <Copy className="size-3 text-ink-muted" aria-hidden />
    </button>
  )
}

function Sparkline({
  data,
  dataKey,
  color,
  max
}: {
  data: ContainerStats[]
  dataKey: 'cpuPercent' | 'memoryUsage'
  color: string
  max?: number
}): ReactElement {
  if (data.length < 2) {
    return (
      <div className="flex h-12 items-center text-[11px] text-ink-muted">Collecting samples…</div>
    )
  }
  return (
    <div className="h-12">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, max ?? 'auto']} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${dataKey})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function DetailsTab({ detail }: { detail: ContainerDetail }): ReactElement {
  const { data } = useContainerStats(detail.id, detail.state === 'running')
  const stats = data?.latest
  const history = data?.history ?? []

  return (
    <div className="px-4 py-3">
      <div className="divide-y divide-line">
        <Field label="Status">
          <StateBadge state={detail.state} exitCode={detail.exitCode} />
        </Field>
        <Field label="Health">
          <HealthDot health={detail.health} />
        </Field>
        <Field label="Image">
          <span
            className="selectable block max-w-52 truncate font-mono text-[11px]"
            title={detail.image}
          >
            {detail.image}
          </span>
        </Field>
        <Field label="ID">
          <CopyableId value={detail.id} />
        </Field>
        <Field label="Created">{formatDateTime(detail.createdAt)}</Field>
        <Field label="Uptime">
          {detail.state === 'running' ? formatDuration(detail.uptimeSeconds) : '—'}
        </Field>
        <Field label="Ports">
          {detail.ports.length === 0 ? (
            '—'
          ) : (
            <span className="selectable font-mono text-[11px]">
              {detail.ports.map((port) => formatPort(port)).join(', ')}
            </span>
          )}
        </Field>
        <Field label="Command">
          <span
            className="selectable block max-w-52 truncate font-mono text-[11px]"
            title={detail.command}
          >
            {detail.command || '—'}
          </span>
        </Field>
        <Field label="Restart policy">{detail.restartPolicy || 'no'}</Field>
        <Field label="Restarts">{detail.restartCount}</Field>
        <Field label="Networks">
          {detail.networks.length > 0 ? detail.networks.join(', ') : '—'}
        </Field>
      </div>

      {detail.state === 'running' ? (
        <div className="mt-4 space-y-3">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-ink-secondary">CPU</span>
              <span className="text-xs text-ink tabular-nums">
                {stats ? formatPercent(stats.cpuPercent) : '—'}
              </span>
            </div>
            <Sparkline data={history} dataKey="cpuPercent" color="var(--hl-success)" />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-ink-secondary">Memory</span>
              <span className="text-xs text-ink tabular-nums">
                {stats ? formatBytes(stats.memoryUsage) : '—'}
              </span>
            </div>
            <Sparkline
              data={history}
              dataKey="memoryUsage"
              color="var(--hl-teal)"
              max={stats?.memoryLimit}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function InspectTab({ detail }: { detail: ContainerDetail }): ReactElement {
  const { toast } = useToast()
  const raw = JSON.stringify(detail, null, 2)

  return (
    <div className="p-3">
      <div className="mb-2 flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy className="size-3.5" />}
          onClick={() => {
            void navigator.clipboard.writeText(raw)
            toast({ level: 'success', title: 'Inspect output copied' })
          }}
        >
          Copy JSON
        </Button>
      </div>
      <pre className="selectable hl-scroll max-h-[60vh] rounded-control border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
        {raw}
      </pre>
    </div>
  )
}

function StatsTab({ detail }: { detail: ContainerDetail }): ReactElement {
  const { data, error } = useContainerStats(detail.id, detail.state === 'running')
  const stats = data?.latest

  if (detail.state !== 'running') {
    return (
      <p className="px-4 py-8 text-center text-xs text-ink-muted">
        Stats need a running container.
      </p>
    )
  }
  if (error) {
    return (
      <p className="selectable px-4 py-8 text-center text-xs text-danger-fg">{error.message}</p>
    )
  }
  if (!stats) return <Skeleton className="m-4 h-40" />

  const rows: [string, string][] = [
    ['CPU', formatPercent(stats.cpuPercent)],
    ['Memory', `${formatBytes(stats.memoryUsage)} / ${formatBytes(stats.memoryLimit)}`],
    ['Memory share', formatPercent(stats.memoryPercent)],
    ['Network RX', formatBytes(stats.networkRx)],
    ['Network TX', formatBytes(stats.networkTx)],
    ['Block read', formatBytes(stats.blockRead)],
    ['Block write', formatBytes(stats.blockWrite)],
    ['Processes', String(stats.pids)]
  ]

  return (
    <div className="divide-y divide-line px-4 py-3">
      {rows.map(([label, value]) => (
        <Field key={label} label={label}>
          <span className="tabular-nums">{value}</span>
        </Field>
      ))}
    </div>
  )
}

export function ContainerDetailPanel({ containerId }: { containerId: string }): ReactElement {
  const panel = useUiStore((state) => state.containerPanel)
  const setPanel = useUiStore((state) => state.setContainerPanel)
  const selectContainer = useUiStore((state) => state.selectContainer)
  const { data: detail, isLoading, error } = useContainerDetail(containerId)

  const tab: ContainerPanel = panel === 'logs' || panel === 'terminal' ? 'details' : panel

  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{detail?.name ?? 'Container'}</h2>
          {detail ? (
            <div className="mt-1 flex items-center gap-1.5">
              <Badge
                tone={detail.state === 'running' ? 'success' : 'neutral'}
                dot={detail.state === 'running'}
              >
                {detail.status}
              </Badge>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close details"
          onClick={() => selectContainer(null)}
          className="rounded p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="shrink-0 px-4">
        <Tabs
          size="sm"
          value={tab}
          onValueChange={(value) => setPanel(value as ContainerPanel)}
          tabs={[
            { value: 'details', label: 'Details' },
            { value: 'inspect', label: 'Inspect' },
            { value: 'stats', label: 'Stats' }
          ]}
        />
      </div>

      <div className="hl-scroll min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="selectable px-4 py-6 text-xs text-danger-fg">{error.message}</p>
        ) : detail ? (
          tab === 'details' ? (
            <DetailsTab detail={detail} />
          ) : tab === 'inspect' ? (
            <InspectTab detail={detail} />
          ) : (
            <StatsTab detail={detail} />
          )
        ) : null}
      </div>

      {detail ? (
        <div className="shrink-0 space-y-2 border-t border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Tooltip content="Open the log stream">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 justify-center"
                icon={<ScrollText className="size-3.5" />}
                onClick={() => setPanel('logs')}
              >
                Logs
              </Button>
            </Tooltip>
            <Tooltip content="Open an interactive shell">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 justify-center"
                disabled={detail.state !== 'running'}
                icon={<SquareTerminal className="size-3.5" />}
                onClick={() => setPanel('terminal')}
              >
                Terminal
              </Button>
            </Tooltip>
          </div>
          <ContainerActions containers={[detail]} layout="panel" />
        </div>
      ) : null}
    </aside>
  )
}

export function ContainerPanelPlaceholder(): ReactElement {
  return (
    <aside className="hidden w-[330px] shrink-0 flex-col items-center justify-center gap-2 border-l border-line bg-surface px-6 text-center xl:flex">
      <ExternalLink className={cn('size-5 text-ink-muted')} aria-hidden />
      <p className="text-xs text-ink-muted">
        Select a container to inspect its details, logs and terminal.
      </p>
    </aside>
  )
}
