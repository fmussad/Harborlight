import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis
} from 'recharts'
import { Boxes, Cpu, HardDrive, MemoryStick, Plug, ServerCog } from 'lucide-react'
import type { ContainerSummary } from '@shared/schemas/domain'
import { formatBytes, formatDuration, formatPercent } from '@shared/utils/format'
import { cn } from '@/lib/cn'
import { describeEngine } from '@/lib/engine'
import {
  useContainers,
  useDiskUsage,
  useEngineStatus,
  useSettings,
  useUsageHistory
} from '@/lib/queries'
import { useUiStore } from '@/stores/ui'
import { Card, EmptyState, Select, Skeleton } from '@/components/ui/primitives'
import { DataTable, PageHeader, type Column } from '@/components/ui/table'
import { HealthDot, MonoText, PortsCell, StateBadge } from '@/components/common/StatusBits'

function StatCard({
  icon,
  label,
  value,
  caption,
  accent
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  caption: ReactNode
  accent: 'brand' | 'accent' | 'teal' | 'success'
}): ReactElement {
  const accents = {
    brand: 'bg-brand-soft text-brand',
    accent: 'bg-accent-soft text-accent',
    teal: 'bg-teal-soft text-teal',
    success: 'bg-success-soft text-success-fg'
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2.5">
        <span className={cn('flex size-7 items-center justify-center rounded-md', accents[accent])}>
          {icon}
        </span>
        <span className="text-xs font-medium text-ink-secondary">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] text-ink-muted">{caption}</p>
    </Card>
  )
}

const WINDOWS = [
  { value: '6', label: 'Last 6 hours' },
  { value: '12', label: 'Last 12 hours' },
  { value: '24', label: 'Last 24 hours' },
  { value: '72', label: 'Last 3 days' }
]

function UsageChart(): ReactElement {
  const [windowHours, setWindowHours] = useState('24')
  const { data: samples = [], isLoading } = useUsageHistory(Number(windowHours))

  const data = useMemo(
    () =>
      samples.map((sample) => ({
        time: new Date(sample.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        }),
        cpu: Number(sample.cpuPercent.toFixed(1)),
        memory: Number((sample.memoryBytes / 1024 ** 3).toFixed(2)),
        disk: Number((sample.diskBytes / 1024 ** 3).toFixed(2))
      })),
    [samples]
  )

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Resource usage history</h2>
          <div className="mt-2 flex items-center gap-4 text-[11px] text-ink-muted">
            <Legend color="var(--hl-accent)" label="CPU (%)" />
            <Legend color="var(--hl-teal)" label="Memory (GB)" />
            <Legend color="var(--hl-brand)" label="Disk (GB)" />
          </div>
        </div>
        <Select
          ariaLabel="History window"
          value={windowHours}
          onChange={setWindowHours}
          options={WINDOWS}
          className="w-36"
        />
      </div>

      <div className="mt-4 h-56">
        {isLoading && data.length === 0 ? (
          <Skeleton className="size-full" />
        ) : data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-muted">
            History starts building as soon as Harborlight can reach the engine.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <defs>
                {[
                  ['cpu', 'var(--hl-accent)'],
                  ['memory', 'var(--hl-teal)'],
                  ['disk', 'var(--hl-brand)']
                ].map(([key, color]) => (
                  <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="var(--hl-chart-grid)" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: 'var(--hl-text-muted)' }}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--hl-text-muted)' }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <ChartTooltip
                contentStyle={{
                  background: 'var(--hl-surface)',
                  border: '1px solid var(--hl-border)',
                  borderRadius: 8,
                  fontSize: 12,
                  boxShadow: 'var(--hl-shadow-pop)'
                }}
                labelStyle={{ color: 'var(--hl-text-secondary)' }}
              />
              <Area
                type="monotone"
                dataKey="cpu"
                name="CPU (%)"
                stroke="var(--hl-accent)"
                strokeWidth={1.75}
                fill="url(#fill-cpu)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="memory"
                name="Memory (GB)"
                stroke="var(--hl-teal)"
                strokeWidth={1.75}
                fill="url(#fill-memory)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="disk"
                name="Disk (GB)"
                stroke="var(--hl-brand)"
                strokeWidth={1.75}
                fill="url(#fill-disk)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

function Legend({ color, label }: { color: string; label: string }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </span>
  )
}

export function OverviewPage(): ReactElement {
  const { data: settings } = useSettings()
  const { data: status } = useEngineStatus(settings?.pollIntervalMs ?? 5000)
  const { data: containers = [], isLoading } = useContainers(settings?.pollIntervalMs ?? 5000)
  const { data: disk } = useDiskUsage()
  const { data: samples = [] } = useUsageHistory(24)
  const navigate = useUiStore((state) => state.navigate)
  const selectContainer = useUiStore((state) => state.selectContainer)

  const engine = describeEngine(status)
  const latest = samples.at(-1)
  const running = containers.filter((container) => container.state === 'running')

  // Compared against the oldest sample in the window rather than wall-clock
  // "now", so the number stays stable between renders.
  const earliest = samples[0]

  const diskTotal = disk
    ? disk.images.size + disk.containers.size + disk.volumes.size + disk.buildCache.size
    : null

  const columns: Column<ContainerSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
      cell: (row) => <span className="font-medium text-ink">{row.name}</span>
    },
    {
      id: 'image',
      header: 'Image',
      sortValue: (row) => row.image,
      cell: (row) => (
        <MonoText className="block max-w-[280px] truncate" title={row.image}>
          {row.image}
        </MonoText>
      )
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-32',
      sortValue: (row) => row.state,
      cell: (row) => <StateBadge state={row.state} exitCode={row.exitCode} />
    },
    {
      id: 'health',
      header: 'Health',
      width: 'w-28',
      cell: (row) => <HealthDot health={row.health} />
    },
    { id: 'ports', header: 'Ports', width: 'w-40', cell: (row) => <PortsCell ports={row.ports} /> },
    {
      id: 'uptime',
      header: 'Uptime',
      width: 'w-24',
      align: 'right',
      sortValue: (row) => row.uptimeSeconds ?? -1,
      cell: (row) => (
        <span className="text-xs text-ink-secondary tabular-nums">
          {row.state === 'running' ? formatDuration(row.uptimeSeconds) : '—'}
        </span>
      )
    }
  ]

  return (
    <div className="min-h-full">
      <PageHeader
        title="Overview"
        actions={
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-muted">Engine</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-1">
              <span className={cn('size-1.5 rounded-full', engine.dotClass)} aria-hidden />
              <span className="font-medium text-ink-secondary">{engine.label}</span>
            </span>
            <MonoText className="text-[11px]">{status?.socketPath ?? '—'}</MonoText>
          </div>
        }
      />

      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            accent="brand"
            icon={<Boxes className="size-4" />}
            label="Running containers"
            value={running.length}
            caption={`${containers.length} total · ${containers.length - running.length} stopped`}
          />
          <StatCard
            accent="accent"
            icon={<Cpu className="size-4" />}
            label="CPU usage"
            value={latest ? formatPercent(latest.cpuPercent, 0) : '—'}
            caption={
              earliest && latest && earliest !== latest
                ? `${latest.cpuPercent >= earliest.cpuPercent ? '+' : ''}${(latest.cpuPercent - earliest.cpuPercent).toFixed(1)} pts over the window`
                : 'Sum across running containers'
            }
          />
          <StatCard
            accent="teal"
            icon={<MemoryStick className="size-4" />}
            label="Memory usage"
            value={latest ? formatBytes(latest.memoryBytes) : '—'}
            caption={
              status?.memoryTotal
                ? `${formatBytes(latest?.memoryBytes ?? 0)} / ${formatBytes(status.memoryTotal)}`
                : 'Sum across running containers'
            }
          />
          <StatCard
            accent="success"
            icon={<HardDrive className="size-4" />}
            label="Disk usage"
            value={diskTotal === null ? '—' : formatBytes(diskTotal)}
            caption={
              disk
                ? `${formatBytes(disk.images.reclaimable + disk.containers.reclaimable + disk.volumes.reclaimable + disk.buildCache.reclaimable)} reclaimable`
                : 'Reading docker system df…'
            }
          />
        </div>

        <UsageChart />

        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold text-ink">Container activity</h2>
            <button
              type="button"
              onClick={() => navigate('containers')}
              className="text-xs font-medium text-brand hover:underline"
            >
              View all containers
            </button>
          </div>
          <DataTable
            rows={containers.slice(0, 8)}
            columns={columns}
            rowKey={(row) => row.id}
            loading={isLoading}
            onRowClick={(row) => {
              navigate('containers')
              selectContainer(row.id, 'details')
            }}
            defaultSort={{ columnId: 'status', direction: 'asc' }}
            empty={
              <EmptyState
                icon={
                  status?.connected ? <Boxes className="size-5" /> : <Plug className="size-5" />
                }
                title={status?.connected ? 'No containers yet' : 'Not connected to Docker'}
                description={
                  status?.connected
                    ? 'Run a container or bring up a Compose project to see it here.'
                    : (status?.errorHint ??
                      'Start the Docker daemon, then retry from the banner above.')
                }
                action={
                  <button
                    type="button"
                    onClick={() => navigate(status?.connected ? 'images' : 'settings')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                  >
                    <ServerCog className="size-3.5" />
                    {status?.connected ? 'Browse images' : 'Open engine settings'}
                  </button>
                }
              />
            }
          />
        </Card>
      </div>
    </div>
  )
}
