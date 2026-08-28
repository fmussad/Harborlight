import { useMemo, useState, type ReactElement } from 'react'
import { Boxes, LayoutGrid, List, Play, Plug, Search } from 'lucide-react'
import type { ContainerSummary } from '@shared/schemas/domain'
import { formatDuration, pluralize } from '@shared/utils/format'
import { cn } from '@/lib/cn'
import { useContainers, useEngineStatus, useSettings } from '@/lib/queries'
import { useUiStore } from '@/stores/ui'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SegmentedControl,
  Select
} from '@/components/ui/primitives'
import { DataTable, PageHeader, type Column } from '@/components/ui/table'
import { HealthDot, MonoText, PortsCell, StateBadge } from '@/components/common/StatusBits'
import { ContainerActions } from '@/components/containers/ContainerActions'
import {
  ContainerDetailPanel,
  ContainerPanelPlaceholder
} from '@/components/containers/ContainerDetailPanel'
import { ContainerWorkspace } from '@/components/containers/ContainerWorkspace'
import { RunContainerDialog } from '@/components/containers/RunContainerDialog'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'exited', label: 'Stopped' },
  { value: 'paused', label: 'Paused' },
  { value: 'unhealthy', label: 'Unhealthy' }
]

function ContainerCard({
  container,
  active,
  onSelect
}: {
  container: ContainerSummary
  active: boolean
  onSelect(): void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'hl-card w-full p-3 text-left transition-colors hover:border-line-strong',
        active && 'border-accent'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-ink">{container.name}</span>
        <StateBadge state={container.state} exitCode={container.exitCode} />
      </div>
      <MonoText className="mt-1 block truncate">{container.image}</MonoText>
      <div className="mt-2.5 flex items-center justify-between">
        <PortsCell ports={container.ports} />
        <span className="text-[11px] text-ink-muted tabular-nums">
          {container.state === 'running' ? formatDuration(container.uptimeSeconds) : '—'}
        </span>
      </div>
    </button>
  )
}

export function ContainersPage(): ReactElement {
  const { data: settings } = useSettings()
  const { data: status } = useEngineStatus(settings?.pollIntervalMs ?? 5000)
  const { data: containers = [], isLoading } = useContainers(settings?.pollIntervalMs ?? 5000)

  const search = useUiStore((state) => state.containerSearch)
  const setSearch = useUiStore((state) => state.setContainerSearch)
  const stack = useUiStore((state) => state.containerStack)
  const setStack = useUiStore((state) => state.setContainerStack)
  const statusFilter = useUiStore((state) => state.containerStatus)
  const setStatusFilter = useUiStore((state) => state.setContainerStatus)
  const view = useUiStore((state) => state.containerView)
  const setView = useUiStore((state) => state.setContainerView)
  const selectedId = useUiStore((state) => state.selectedContainerId)
  const selectContainer = useUiStore((state) => state.selectContainer)
  const panel = useUiStore((state) => state.containerPanel)

  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [runOpen, setRunOpen] = useState(false)

  const stacks = useMemo(() => {
    const names = new Set<string>()
    for (const container of containers) {
      if (container.composeProject) names.add(container.composeProject)
    }
    return [
      { value: 'all', label: 'All stacks' },
      { value: 'none', label: 'No stack' },
      ...[...names].sort().map((name) => ({ value: name, label: name }))
    ]
  }, [containers])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return containers.filter((container) => {
      if (stack === 'none' && container.composeProject) return false
      if (stack !== 'all' && stack !== 'none' && container.composeProject !== stack) return false

      if (statusFilter === 'unhealthy' && container.health !== 'unhealthy') return false
      if (statusFilter === 'exited' && container.state === 'running') return false
      if (
        statusFilter !== 'all' &&
        statusFilter !== 'unhealthy' &&
        statusFilter !== 'exited' &&
        container.state !== statusFilter
      ) {
        return false
      }

      if (!needle) return true
      return `${container.name} ${container.image} ${container.id} ${container.composeService ?? ''}`
        .toLowerCase()
        .includes(needle)
    })
  }, [containers, search, stack, statusFilter])

  const selected = useMemo(
    () => containers.filter((container) => selection.has(container.id)),
    [containers, selection]
  )
  const activeContainer = containers.find((container) => container.id === selectedId) ?? null

  if (activeContainer && (panel === 'logs' || panel === 'terminal')) {
    return <ContainerWorkspace container={activeContainer} />
  }

  const columns: Column<ContainerSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-ink">{row.name}</span>
          {row.composeService ? (
            <span className="text-[11px] text-ink-muted">{row.composeService}</span>
          ) : null}
        </div>
      )
    },
    {
      id: 'image',
      header: 'Image',
      sortValue: (row) => row.image,
      cell: (row) => (
        <MonoText className="block max-w-[260px] truncate" title={row.image}>
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
    { id: 'ports', header: 'Ports', width: 'w-44', cell: (row) => <PortsCell ports={row.ports} /> },
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
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          title="Containers"
          description={`${pluralize(containers.length, 'container')} · ${
            containers.filter((container) => container.state === 'running').length
          } running`}
          actions={
            <>
              <Button
                variant="primary"
                icon={<Play className="size-3.5" />}
                onClick={() => setRunOpen(true)}
              >
                Run container
              </Button>
              <ContainerActions
                containers={selected}
                layout="toolbar"
                onDone={() => setSelection(new Set())}
              />
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search containers, images, IDs…"
              icon={<Search className="size-3.5" />}
              wrapperClassName="w-72"
              aria-label="Search containers"
            />
            <Select
              ariaLabel="Filter by stack"
              value={stack}
              onChange={setStack}
              options={stacks}
              className="w-44"
            />
            <Select
              ariaLabel="Filter by status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_OPTIONS}
              className="w-40"
            />
            {selection.size > 0 ? <Badge tone="accent">{selection.size} selected</Badge> : null}
            <div className="ml-auto">
              <SegmentedControl
                ariaLabel="View mode"
                value={view}
                onChange={setView}
                options={[
                  { value: 'list', label: <List className="size-3.5" />, title: 'List view' },
                  { value: 'cards', label: <LayoutGrid className="size-3.5" />, title: 'Card view' }
                ]}
              />
            </div>
          </div>
        </PageHeader>

        <div className="hl-scroll min-h-0 flex-1">
          {view === 'cards' ? (
            filtered.length === 0 ? (
              <EmptyState
                icon={<Boxes className="size-5" />}
                title="No containers match the filters"
                description="Adjust the search or filters above."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3">
                {filtered.map((container) => (
                  <ContainerCard
                    key={container.id}
                    container={container}
                    active={container.id === selectedId}
                    onSelect={() => selectContainer(container.id, 'details')}
                  />
                ))}
              </div>
            )
          ) : (
            <Card className="m-4 overflow-hidden">
              <DataTable
                rows={filtered}
                columns={columns}
                rowKey={(row) => row.id}
                loading={isLoading}
                selection={{ selected: selection, onChange: setSelection }}
                onRowClick={(row) => selectContainer(row.id, 'details')}
                isRowActive={(row) => row.id === selectedId}
                groupBy={
                  stack === 'all'
                    ? {
                        key: (row) => row.composeProject ?? 'Standalone',
                        label: (key, rows) => (
                          <span className="flex items-center gap-2">
                            {key}
                            <span className="text-ink-muted">({rows.length})</span>
                          </span>
                        )
                      }
                    : undefined
                }
                empty={
                  <EmptyState
                    icon={
                      status?.connected ? <Boxes className="size-5" /> : <Plug className="size-5" />
                    }
                    title={
                      containers.length === 0
                        ? status?.connected
                          ? 'No containers yet'
                          : 'Not connected to Docker'
                        : 'No containers match the filters'
                    }
                    description={
                      containers.length === 0
                        ? status?.connected
                          ? 'Run an image or bring up a Compose project to get started.'
                          : (status?.errorHint ??
                            'Start the Docker daemon and retry from the banner above.')
                        : 'Adjust the search or filters above.'
                    }
                    action={
                      containers.length === 0 && status?.connected ? (
                        <Button variant="primary" size="sm" onClick={() => setRunOpen(true)}>
                          Run a container
                        </Button>
                      ) : undefined
                    }
                  />
                }
              />
            </Card>
          )}
        </div>
      </div>

      {activeContainer ? (
        <ContainerDetailPanel containerId={activeContainer.id} />
      ) : (
        <ContainerPanelPlaceholder />
      )}

      <RunContainerDialog open={runOpen} onOpenChange={setRunOpen} />
    </div>
  )
}
