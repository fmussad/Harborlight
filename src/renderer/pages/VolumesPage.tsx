import { useMemo, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Database, Eye, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import type { VolumeSummary } from '@shared/schemas/domain'
import { formatBytes, formatRelativeTime } from '@shared/utils/format'
import { invoke } from '@/lib/bridge'
import { queryKeys, useVolumes } from '@/lib/queries'
import { Badge, Button, Card, EmptyState, Input, Select } from '@/components/ui/primitives'
import { ConfirmDialog, DropdownMenu, type ConfirmRequest } from '@/components/ui/overlays'
import { DataTable, PageHeader, type Column } from '@/components/ui/table'
import { MonoText } from '@/components/common/StatusBits'
import { RawInspectDialog } from '@/components/common/RawInspectDialog'
import { useToast } from '@/providers/ToastProvider'

const FILTERS = [
  { value: 'all', label: 'All volumes' },
  { value: 'used', label: 'In use' },
  { value: 'unused', label: 'Unused' }
]

export function VolumesPage(): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: volumes = [], isLoading } = useVolumes()

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [inspect, setInspect] = useState<{
    name: string
    raw: string | null
    error: string | null
  } | null>(null)

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return volumes.filter((volume) => {
      if (filter === 'used' && !volume.inUse) return false
      if (filter === 'unused' && volume.inUse) return false
      if (!needle) return true
      return `${volume.name} ${volume.driver} ${volume.composeProject ?? ''}`
        .toLowerCase()
        .includes(needle)
    })
  }, [filter, search, volumes])

  const openInspect = (volume: VolumeSummary): void => {
    setInspect({ name: volume.name, raw: null, error: null })
    void invoke('volumes.inspect', { name: volume.name })
      .then((result) => setInspect({ name: volume.name, raw: result.raw, error: null }))
      .catch((error: Error) => setInspect({ name: volume.name, raw: null, error: error.message }))
  }

  const removeVolume = (volume: VolumeSummary): void => {
    setConfirm({
      title: `Remove ${volume.name}?`,
      description: volume.inUse
        ? 'This volume is attached to containers. Removing it deletes the data they rely on.'
        : 'Everything stored in this volume is deleted permanently. There is no undo.',
      resources: [
        volume.mountpoint,
        ...volume.containers.map((container) => `used by ${container.name}`)
      ],
      destructive: true,
      confirmLabel: 'Delete volume',
      requireTyped: volume.name,
      onConfirm: async () => {
        try {
          await invoke('volumes.remove', { name: volume.name, force: volume.inUse })
          await client.invalidateQueries({ queryKey: queryKeys.volumes })
          await client.invalidateQueries({ queryKey: queryKeys.cleanup })
          toast({ level: 'success', title: `Removed ${volume.name}` })
        } catch (error) {
          toastError(error, 'Could not remove the volume')
        }
      }
    })
  }

  const columns: Column<VolumeSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-ink">{row.name}</span>
          <MonoText className="block truncate text-[11px]" title={row.mountpoint}>
            {row.mountpoint}
          </MonoText>
        </div>
      )
    },
    {
      id: 'project',
      header: 'Stack',
      width: 'w-36',
      sortValue: (row) => row.composeProject ?? '',
      cell: (row) =>
        row.composeProject ? (
          <Badge tone="accent">{row.composeProject}</Badge>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        )
    },
    {
      id: 'driver',
      header: 'Driver',
      width: 'w-24',
      cell: (row) => <span className="text-xs text-ink-secondary">{row.driver}</span>
    },
    {
      id: 'size',
      header: 'Size',
      width: 'w-24',
      align: 'right',
      sortValue: (row) => row.size ?? -1,
      cell: (row) => (
        <span className="text-xs tabular-nums">
          {row.size === null ? '—' : formatBytes(row.size)}
        </span>
      )
    },
    {
      id: 'inUse',
      header: 'Usage',
      width: 'w-32',
      sortValue: (row) => (row.inUse ? 1 : 0),
      cell: (row) =>
        row.inUse ? (
          <span className="text-xs text-ink-secondary">
            {row.containers.length > 0
              ? row.containers.map((container) => container.name).join(', ')
              : 'attached'}
          </span>
        ) : (
          <Badge tone="warning">unused</Badge>
        )
    },
    {
      id: 'created',
      header: 'Created',
      width: 'w-28',
      align: 'right',
      sortValue: (row) => (row.createdAt ? new Date(row.createdAt).getTime() : 0),
      cell: (row) => (
        <span className="text-xs text-ink-muted">{formatRelativeTime(row.createdAt)}</span>
      )
    },
    {
      id: 'actions',
      header: '',
      width: 'w-10',
      cell: (row) => (
        <DropdownMenu
          items={[
            {
              label: 'Inspect',
              icon: <Eye className="size-3.5" />,
              onSelect: () => openInspect(row)
            },
            {
              label: 'Remove…',
              icon: <Trash2 className="size-3.5" />,
              destructive: true,
              separatorBefore: true,
              onSelect: () => removeVolume(row)
            }
          ]}
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${row.name}`}
              className="rounded p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <MoreHorizontal className="size-4" />
            </button>
          }
        />
      )
    }
  ]

  const unused = volumes.filter((volume) => !volume.inUse)

  return (
    <div className="min-h-full">
      <PageHeader
        title="Volumes"
        description={`${volumes.length} volumes · ${unused.length} unused`}
        actions={
          <Button
            variant="secondary"
            disabled={unused.length === 0}
            icon={<Trash2 className="size-3.5" />}
            onClick={() =>
              setConfirm({
                title: `Remove ${unused.length} unused volumes?`,
                description:
                  'Unused volumes still hold data. Anything inside them is deleted permanently.',
                resources: unused.map((volume) => volume.name),
                destructive: true,
                confirmLabel: 'Delete volumes',
                requireTyped: 'delete volumes',
                onConfirm: async () => {
                  try {
                    await invoke('cleanup.run', { categories: ['unusedVolumes'], dryRun: false })
                    await client.invalidateQueries({ queryKey: queryKeys.volumes })
                    toast({ level: 'success', title: 'Unused volumes removed' })
                  } catch (error) {
                    toastError(error, 'Could not prune volumes')
                  }
                }
              })
            }
          >
            Prune unused
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search volumes…"
            icon={<Search className="size-3.5" />}
            wrapperClassName="w-72"
            aria-label="Search volumes"
          />
          <Select
            ariaLabel="Filter volumes"
            value={filter}
            onChange={setFilter}
            options={FILTERS}
            className="w-40"
          />
        </div>
      </PageHeader>

      <div className="p-5">
        <Card className="overflow-hidden">
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.name}
            loading={isLoading}
            defaultSort={{ columnId: 'size', direction: 'desc' }}
            empty={
              <EmptyState
                icon={<Database className="size-5" />}
                title={volumes.length === 0 ? 'No volumes' : 'No volumes match the filters'}
                description={
                  volumes.length === 0
                    ? 'Volumes appear here once a container or Compose project creates one.'
                    : 'Try a different search or filter.'
                }
              />
            }
          />
        </Card>
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <RawInspectDialog
        title={inspect?.name ?? null}
        raw={inspect?.raw ?? null}
        loading={Boolean(inspect) && !inspect?.raw && !inspect?.error}
        error={inspect?.error ?? null}
        onClose={() => setInspect(null)}
      />
    </div>
  )
}
