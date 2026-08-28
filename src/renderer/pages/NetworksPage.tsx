import { useMemo, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, MoreHorizontal, Network as NetworkIcon, Search, Trash2 } from 'lucide-react'
import type { NetworkSummary } from '@shared/schemas/domain'
import { formatRelativeTime } from '@shared/utils/format'
import { invoke } from '@/lib/bridge'
import { queryKeys, useNetworks } from '@/lib/queries'
import { Badge, Button, Card, EmptyState, Input, Select } from '@/components/ui/primitives'
import { ConfirmDialog, DropdownMenu, type ConfirmRequest } from '@/components/ui/overlays'
import { DataTable, PageHeader, type Column } from '@/components/ui/table'
import { MonoText } from '@/components/common/StatusBits'
import { RawInspectDialog } from '@/components/common/RawInspectDialog'
import { useToast } from '@/providers/ToastProvider'

const FILTERS = [
  { value: 'all', label: 'All networks' },
  { value: 'custom', label: 'User defined' },
  { value: 'unused', label: 'Unused' }
]

export function NetworksPage(): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: networks = [], isLoading } = useNetworks()

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
    return networks.filter((network) => {
      if (filter === 'custom' && network.system) return false
      if (filter === 'unused' && (network.inUse || network.system)) return false
      if (!needle) return true
      return `${network.name} ${network.driver} ${network.composeProject ?? ''}`
        .toLowerCase()
        .includes(needle)
    })
  }, [filter, networks, search])

  const openInspect = (network: NetworkSummary): void => {
    setInspect({ name: network.name, raw: null, error: null })
    void invoke('networks.inspect', { id: network.id })
      .then((result) => setInspect({ name: network.name, raw: result.raw, error: null }))
      .catch((error: Error) => setInspect({ name: network.name, raw: null, error: error.message }))
  }

  const removeNetwork = (network: NetworkSummary): void => {
    setConfirm({
      title: `Remove ${network.name}?`,
      description: network.inUse
        ? 'Containers are still attached. Docker refuses to remove a network that is in use.'
        : 'Containers created later will no longer be able to join this network by name.',
      resources: [
        network.name,
        ...network.containers.map((container) => `attached: ${container.name}`)
      ],
      destructive: true,
      confirmLabel: 'Remove network',
      onConfirm: async () => {
        try {
          await invoke('networks.remove', { id: network.id })
          await client.invalidateQueries({ queryKey: queryKeys.networks })
          toast({ level: 'success', title: `Removed ${network.name}` })
        } catch (error) {
          toastError(error, 'Could not remove the network')
        }
      }
    })
  }

  const columns: Column<NetworkSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-ink">{row.name}</span>
          {row.system ? <Badge tone="neutral">system</Badge> : null}
        </div>
      )
    },
    {
      id: 'driver',
      header: 'Driver',
      width: 'w-28',
      sortValue: (row) => row.driver,
      cell: (row) => <span className="text-xs text-ink-secondary">{row.driver}</span>
    },
    {
      id: 'scope',
      header: 'Scope',
      width: 'w-24',
      cell: (row) => <span className="text-xs text-ink-secondary">{row.scope}</span>
    },
    {
      id: 'subnet',
      header: 'Subnet',
      width: 'w-44',
      cell: (row) =>
        row.subnets.length === 0 ? (
          <span className="text-xs text-ink-muted">—</span>
        ) : (
          <MonoText>{row.subnets.map((entry) => entry.subnet).join(', ')}</MonoText>
        )
    },
    {
      id: 'containers',
      header: 'Attached',
      width: 'w-28',
      align: 'right',
      sortValue: (row) => row.containers.length,
      cell: (row) =>
        row.containers.length > 0 ? (
          <span className="text-xs text-ink-secondary tabular-nums">{row.containers.length}</span>
        ) : (
          <Badge tone={row.system ? 'neutral' : 'warning'}>unused</Badge>
        )
    },
    {
      id: 'created',
      header: 'Created',
      width: 'w-28',
      align: 'right',
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
              disabled: row.system,
              onSelect: () => removeNetwork(row)
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

  const prunable = networks.filter((network) => !network.system && !network.inUse)

  return (
    <div className="min-h-full">
      <PageHeader
        title="Networks"
        description={`${networks.length} networks · ${prunable.length} unused`}
        actions={
          <Button
            variant="secondary"
            disabled={prunable.length === 0}
            icon={<Trash2 className="size-3.5" />}
            onClick={() =>
              setConfirm({
                title: `Remove ${prunable.length} unused networks?`,
                description: 'Only user-defined networks with no attached containers are removed.',
                resources: prunable.map((network) => network.name),
                destructive: true,
                confirmLabel: 'Remove networks',
                onConfirm: async () => {
                  try {
                    await invoke('cleanup.run', { categories: ['unusedNetworks'], dryRun: false })
                    await client.invalidateQueries({ queryKey: queryKeys.networks })
                    toast({ level: 'success', title: 'Unused networks removed' })
                  } catch (error) {
                    toastError(error, 'Could not prune networks')
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
            placeholder="Search networks…"
            icon={<Search className="size-3.5" />}
            wrapperClassName="w-72"
            aria-label="Search networks"
          />
          <Select
            ariaLabel="Filter networks"
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
            rowKey={(row) => row.id}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<NetworkIcon className="size-5" />}
                title={networks.length === 0 ? 'No networks' : 'No networks match the filters'}
                description="Compose projects create their own networks automatically."
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
