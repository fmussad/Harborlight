import { useMemo, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { Download, Layers, MoreHorizontal, Search, ShieldCheck, Tag, Trash2 } from 'lucide-react'
import type { ImageSummary, ScanResult } from '@shared/schemas/domain'
import { formatBytes, formatRelativeTime, shortenId } from '@shared/utils/format'
import { invoke } from '@/lib/bridge'
import { queryKeys, useDiskUsage, useImages, useScanAvailability } from '@/lib/queries'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Tooltip
} from '@/components/ui/primitives'
import { ConfirmDialog, Dialog, DropdownMenu, type ConfirmRequest } from '@/components/ui/overlays'
import { DataTable, PageHeader, type Column } from '@/components/ui/table'
import { MonoText } from '@/components/common/StatusBits'
import { CleanupCard } from '@/components/images/CleanupCard'
import { PullImageDialog } from '@/components/images/PullImageDialog'
import { useToast } from '@/providers/ToastProvider'

const FILTERS = [
  { value: 'all', label: 'All images' },
  { value: 'used', label: 'In use' },
  { value: 'unused', label: 'Unused' },
  { value: 'dangling', label: 'Dangling' }
]

const SORTS = [
  { value: 'size', label: 'Sort by size' },
  { value: 'name', label: 'Sort by name' },
  { value: 'created', label: 'Sort by date' }
]

function DiskDonut(): ReactElement {
  const { data: disk, isLoading, error } = useDiskUsage()

  if (error) {
    return (
      <Card className="p-4">
        <h2 className="text-[13px] font-semibold text-ink">Disk usage</h2>
        <p className="selectable mt-2 text-xs text-danger-fg">{error.message}</p>
      </Card>
    )
  }

  if (isLoading || !disk) {
    return (
      <Card className="p-4">
        <h2 className="text-[13px] font-semibold text-ink">Disk usage</h2>
        <Skeleton className="mt-4 h-36 w-full" />
      </Card>
    )
  }

  const slices = [
    { name: 'Images', value: disk.images.size, color: 'var(--hl-accent)' },
    { name: 'Containers', value: disk.containers.size, color: 'var(--hl-teal)' },
    { name: 'Volumes', value: disk.volumes.size, color: 'var(--hl-brand)' },
    { name: 'Build cache', value: disk.buildCache.size, color: 'var(--hl-warning)' }
  ]
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)

  return (
    <Card className="p-4">
      <h2 className="text-[13px] font-semibold text-ink">Disk usage</h2>
      <div className="mt-2 flex items-center gap-4">
        <div className="relative size-32 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={
                  total > 0 ? slices : [{ name: 'Empty', value: 1, color: 'var(--hl-surface-3)' }]
                }
                dataKey="value"
                innerRadius="68%"
                outerRadius="100%"
                paddingAngle={total > 0 ? 2 : 0}
                stroke="none"
                isAnimationActive={false}
              >
                {(total > 0 ? slices : [{ color: 'var(--hl-surface-3)' }]).map((slice, index) => (
                  <Cell key={index} fill={slice.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-semibold text-ink tabular-nums">
              {formatBytes(total)}
            </span>
            <span className="text-[10px] text-ink-muted">total</span>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-1.5">
          {slices.map((slice) => (
            <li key={slice.name} className="flex items-center gap-2 text-xs">
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: slice.color }}
              />
              <span className="flex-1 text-ink-secondary">{slice.name}</span>
              <span className="text-ink tabular-nums">{formatBytes(slice.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function ScanDialog({
  reference,
  onClose
}: {
  reference: string | null
  onClose(): void
}): ReactElement {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const start = async (target: string): Promise<void> => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      setResult(await invoke('images.scan', { reference: target }))
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={reference !== null}
      onOpenChange={(open) => {
        if (!open) {
          setResult(null)
          setError(null)
          onClose()
        }
      }}
      width="lg"
      title="Vulnerability scan"
      description={reference ?? ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            loading={loading}
            disabled={!reference}
            onClick={() => reference && void start(reference)}
          >
            {result ? 'Scan again' : 'Run scan'}
          </Button>
        </>
      }
    >
      {error ? <p className="selectable text-xs text-danger-fg">{error}</p> : null}

      {result && !result.available ? (
        <p className="text-xs text-ink-secondary">{result.reason}</p>
      ) : null}

      {result?.available ? (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="danger">{result.counts.critical} critical</Badge>
            <Badge tone="warning">{result.counts.high} high</Badge>
            <Badge tone="neutral">{result.counts.medium} medium</Badge>
            <Badge tone="neutral">{result.counts.low} low</Badge>
            <span className="ml-auto text-[11px] text-ink-muted">
              scanned {formatRelativeTime(result.scannedAt)}
            </span>
          </div>
          {result.findings.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-muted">No findings reported.</p>
          ) : (
            <div className="hl-scroll max-h-80 rounded-control border border-line">
              <table className="w-full text-[11px]">
                <thead className="bg-surface-2">
                  <tr className="text-left text-ink-muted">
                    <th className="px-2 py-1.5 font-medium">Severity</th>
                    <th className="px-2 py-1.5 font-medium">ID</th>
                    <th className="px-2 py-1.5 font-medium">Package</th>
                    <th className="px-2 py-1.5 font-medium">Installed</th>
                    <th className="px-2 py-1.5 font-medium">Fixed in</th>
                  </tr>
                </thead>
                <tbody>
                  {result.findings.map((finding) => (
                    <tr key={`${finding.id}-${finding.package}`} className="border-t border-line">
                      <td className="px-2 py-1.5">
                        <Badge
                          tone={
                            finding.severity === 'CRITICAL'
                              ? 'danger'
                              : finding.severity === 'HIGH'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {finding.severity}
                        </Badge>
                      </td>
                      <td className="selectable px-2 py-1.5 font-mono text-ink-secondary">
                        {finding.id}
                      </td>
                      <td className="selectable px-2 py-1.5 text-ink-secondary">
                        {finding.package}
                      </td>
                      <td className="selectable px-2 py-1.5 font-mono text-ink-muted">
                        {finding.installedVersion}
                      </td>
                      <td className="selectable px-2 py-1.5 font-mono text-ink-muted">
                        {finding.fixedVersion ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {!result && !error && !loading ? (
        <p className="text-xs text-ink-muted">
          Harborlight shells out to the Trivy CLI. Nothing is uploaded; the scan runs locally.
        </p>
      ) : null}
    </Dialog>
  )
}

export function ImagesPage(): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: images = [], isLoading } = useImages()
  const { data: scanAvailability } = useScanAvailability()

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('size')
  const [pullOpen, setPullOpen] = useState(false)
  const [scanTarget, setScanTarget] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [tagTarget, setTagTarget] = useState<ImageSummary | null>(null)
  const [newTag, setNewTag] = useState('')

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = images.filter((image) => {
      if (filter === 'used' && image.containers === 0) return false
      if (filter === 'unused' && !image.unused) return false
      if (filter === 'dangling' && !image.dangling) return false
      if (!needle) return true
      return `${image.repository} ${image.tag} ${image.id}`.toLowerCase().includes(needle)
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.repository.localeCompare(b.repository)
      if (sort === 'created')
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      return b.size - a.size
    })
  }, [filter, images, search, sort])

  const removeImage = (image: ImageSummary): void => {
    setConfirm({
      title: `Remove ${image.reference}?`,
      description:
        image.containers > 0
          ? 'Containers still reference this image. Removing it requires force and can break them.'
          : 'The image layers are deleted unless another tag still points at them.',
      resources: [image.reference, shortenId(image.id.replace('sha256:', ''), 19)],
      destructive: true,
      confirmLabel: image.containers > 0 ? 'Force remove' : 'Remove image',
      requireTyped: image.containers > 0 ? image.repository : undefined,
      onConfirm: async () => {
        try {
          await invoke('images.remove', {
            id: image.id,
            force: image.containers > 0,
            pruneChildren: false
          })
          await client.invalidateQueries({ queryKey: queryKeys.images })
          await client.invalidateQueries({ queryKey: queryKeys.cleanup })
          toast({ level: 'success', title: `Removed ${image.reference}` })
        } catch (error) {
          toastError(error, 'Could not remove the image')
        }
      }
    })
  }

  const columns: Column<ImageSummary>[] = [
    {
      id: 'repository',
      header: 'Image',
      sortValue: (row) => row.repository,
      cell: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-ink">{row.repository}</span>
          <MonoText className="text-[11px]">
            {shortenId(row.id.replace('sha256:', ''), 12)}
          </MonoText>
        </div>
      )
    },
    {
      id: 'tag',
      header: 'Tag',
      width: 'w-32',
      cell: (row) => (
        <span className="font-mono text-xs text-ink-secondary">
          {row.dangling ? <Badge tone="warning">dangling</Badge> : row.tag}
        </span>
      )
    },
    {
      id: 'size',
      header: 'Size',
      width: 'w-24',
      align: 'right',
      sortValue: (row) => row.size,
      cell: (row) => <span className="text-xs tabular-nums">{formatBytes(row.size)}</span>
    },
    {
      id: 'containers',
      header: 'In use',
      width: 'w-20',
      align: 'right',
      sortValue: (row) => row.containers,
      cell: (row) =>
        row.containers > 0 ? (
          <span className="text-xs text-ink-secondary tabular-nums">{row.containers}</span>
        ) : (
          <Badge tone="neutral">unused</Badge>
        )
    },
    {
      id: 'created',
      header: 'Created',
      width: 'w-28',
      align: 'right',
      sortValue: (row) => new Date(row.createdAt).getTime(),
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
              label: 'Scan for vulnerabilities',
              icon: <ShieldCheck className="size-3.5" />,
              disabled: !scanAvailability?.available,
              onSelect: () => setScanTarget(row.reference)
            },
            {
              label: 'Add a tag…',
              icon: <Tag className="size-3.5" />,
              onSelect: () => {
                setTagTarget(row)
                setNewTag(row.repository)
              }
            },
            {
              label: 'Remove…',
              icon: <Trash2 className="size-3.5" />,
              destructive: true,
              separatorBefore: true,
              onSelect: () => removeImage(row)
            }
          ]}
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${row.reference}`}
              onClick={(event) => event.stopPropagation()}
              className="rounded p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <MoreHorizontal className="size-4" />
            </button>
          }
        />
      )
    }
  ]

  return (
    <div className="min-h-full">
      <PageHeader
        title="Images"
        description={`${images.length} images · ${formatBytes(images.reduce((sum, image) => sum + image.size, 0))}`}
        actions={
          <>
            <Tooltip
              content={
                scanAvailability?.available
                  ? `Trivy ${scanAvailability.version ?? ''}`
                  : (scanAvailability?.reason ?? 'Trivy is not installed')
              }
            >
              <span>
                <Button
                  variant="secondary"
                  icon={<ShieldCheck className="size-3.5" />}
                  disabled={!scanAvailability?.available || rows.length === 0}
                  onClick={() => setScanTarget(rows[0]?.reference ?? null)}
                >
                  Scan for vulnerabilities
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="primary"
              icon={<Download className="size-3.5" />}
              onClick={() => setPullOpen(true)}
            >
              Pull image
            </Button>
          </>
        }
      />

      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search images…"
                icon={<Search className="size-3.5" />}
                wrapperClassName="w-64"
                aria-label="Search images"
              />
              <Select
                ariaLabel="Filter images"
                value={filter}
                onChange={setFilter}
                options={FILTERS}
                className="w-36"
              />
              <Select
                ariaLabel="Sort images"
                value={sort}
                onChange={setSort}
                options={SORTS}
                className="w-40"
              />
            </div>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              loading={isLoading}
              empty={
                <EmptyState
                  icon={<Layers className="size-5" />}
                  title={images.length === 0 ? 'No images yet' : 'No images match the filters'}
                  description={
                    images.length === 0
                      ? 'Pull an image to get started, or build one from a Compose project.'
                      : 'Try a different search or filter.'
                  }
                  action={
                    images.length === 0 ? (
                      <Button size="sm" variant="primary" onClick={() => setPullOpen(true)}>
                        Pull an image
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </Card>

          <div className="space-y-4">
            <DiskDonut />
            <CleanupCard />
          </div>
        </div>
      </div>

      <PullImageDialog open={pullOpen} onOpenChange={setPullOpen} />
      <ScanDialog reference={scanTarget} onClose={() => setScanTarget(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />

      <Dialog
        open={tagTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTagTarget(null)
        }}
        title={`Tag ${tagTarget?.reference ?? ''}`}
        description="Add another reference pointing at the same image."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTagTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newTag.trim()}
              onClick={() => {
                const target = tagTarget
                if (!target) return
                setTagTarget(null)
                void (async () => {
                  try {
                    await invoke('images.tag', { id: target.id, reference: newTag.trim() })
                    await client.invalidateQueries({ queryKey: queryKeys.images })
                    toast({ level: 'success', title: `Tagged as ${newTag.trim()}` })
                  } catch (error) {
                    toastError(error, 'Could not tag the image')
                  }
                })()
              }}
            >
              Add tag
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={newTag}
          onChange={(event) => setNewTag(event.target.value)}
          className="font-mono"
          placeholder="registry/name:tag"
          aria-label="New reference"
        />
      </Dialog>
    </div>
  )
}
