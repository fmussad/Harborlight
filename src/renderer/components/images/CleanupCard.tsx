import { useMemo, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import type { CleanupCategory } from '@shared/schemas/domain'
import { formatBytes } from '@shared/utils/format'
import { invoke } from '@/lib/bridge'
import { useCleanupPlan } from '@/lib/queries'
import { Badge, Button, Card, Checkbox, Skeleton } from '@/components/ui/primitives'
import { ConfirmDialog, Tabs, type ConfirmRequest } from '@/components/ui/overlays'
import { useToast } from '@/providers/ToastProvider'

/**
 * Cleanup is opt-in per category and always previews what will be deleted.
 * Nothing is selected by default unless the engine reports it as safe waste.
 */
export function CleanupCard(): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const [tab, setTab] = useState('review')
  const [manualSelection, setManualSelection] = useState<Set<CleanupCategory> | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [running, setRunning] = useState(false)

  const { data: plan, isLoading, error, refetch, isFetching } = useCleanupPlan(true)

  // Until the user touches a checkbox, follow whatever the plan marks as safe waste.
  const defaultSelection = useMemo(
    () =>
      new Set(
        (plan?.categories ?? [])
          .filter((category) => category.defaultSelected && category.reclaimable > 0)
          .map((category) => category.category)
      ),
    [plan]
  )
  const selected = manualSelection ?? defaultSelection

  const total = useMemo(() => {
    if (!plan) return 0
    return plan.categories
      .filter((category) => selected.has(category.category))
      .reduce((sum, category) => sum + category.reclaimable, 0)
  }, [plan, selected])

  const toggle = (category: CleanupCategory, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) next.add(category)
    else next.delete(category)
    setManualSelection(next)
  }

  const run = (dryRun: boolean): void => {
    if (!plan || selected.size === 0) return
    const categories = [...selected]
    const chosen = plan.categories.filter((category) => selected.has(category.category))
    const dangerous = chosen.some((category) => category.dangerous)

    const execute = async (): Promise<void> => {
      setRunning(true)
      try {
        const result = await invoke('cleanup.run', { categories, dryRun })
        const failed = result.entries.filter((entry) => entry.status === 'failed')
        toast({
          level: failed.length > 0 ? 'warning' : 'success',
          title: dryRun ? 'Dry run finished' : `Reclaimed ${formatBytes(result.reclaimed)}`,
          message: result.entries.map((entry) => `${entry.category}: ${entry.message}`).join('\n')
        })
        await client.invalidateQueries()
      } catch (cause) {
        toastError(cause, 'Cleanup failed')
      } finally {
        setRunning(false)
      }
    }

    if (dryRun) {
      void execute()
      return
    }

    setConfirm({
      title: `Clean up ${formatBytes(total)}?`,
      description: dangerous
        ? 'This selection includes unused volumes. Data inside them cannot be recovered.'
        : 'Docker will delete the selected resources. Running containers are never affected.',
      resources: chosen.flatMap((category) =>
        category.items.slice(0, 12).map((item) => `${category.title}: ${item.label}`)
      ),
      destructive: true,
      confirmLabel: `Clean up ${formatBytes(total)}`,
      requireTyped: dangerous ? 'delete volumes' : undefined,
      onConfirm: execute
    })
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Cleanup</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Review what Docker can reclaim before anything is removed.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          loading={isFetching}
          icon={<RefreshCw className="size-3.5" />}
          onClick={() => void refetch()}
        >
          Re-analyze
        </Button>
      </div>

      <div className="px-4">
        <Tabs
          size="sm"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: 'review', label: 'Review' },
            { value: 'details', label: 'Details' }
          ]}
        />
      </div>

      {error ? (
        <p className="selectable px-4 py-6 text-xs text-danger-fg">{error.message}</p>
      ) : isLoading || !plan ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : tab === 'review' ? (
        <div className="space-y-2.5 p-4">
          {plan.categories.map((category) => (
            <div key={category.category} className="flex items-start justify-between gap-3">
              <Checkbox
                checked={selected.has(category.category)}
                disabled={category.items.length === 0}
                onCheckedChange={(checked) => toggle(category.category, checked)}
                label={
                  <span className="flex items-center gap-2">
                    {category.title}
                    <span className="text-ink-muted">({category.items.length})</span>
                    {category.dangerous ? (
                      <Badge tone="warning">
                        <AlertTriangle className="size-3" aria-hidden />
                        data loss
                      </Badge>
                    ) : null}
                  </span>
                }
                description={category.description}
              />
              <span className="shrink-0 text-xs text-ink-secondary tabular-nums">
                {formatBytes(category.reclaimable)}
              </span>
            </div>
          ))}

          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="text-[13px] font-medium text-ink">Total reclaimable</span>
            <span className="text-sm font-semibold text-ink tabular-nums">
              {formatBytes(total)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={selected.size === 0}
              onClick={() => run(true)}
            >
              Dry run
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={running}
              disabled={selected.size === 0 || total === 0}
              icon={<Sparkles className="size-3.5" />}
              onClick={() => run(false)}
            >
              Clean up {formatBytes(total)}
            </Button>
          </div>
        </div>
      ) : (
        <div className="hl-scroll max-h-80 p-4">
          {plan.categories.every((category) => category.items.length === 0) ? (
            <p className="py-6 text-center text-xs text-ink-muted">
              Nothing to reclaim. Well kept.
            </p>
          ) : (
            plan.categories
              .filter((category) => category.items.length > 0)
              .map((category) => (
                <div key={category.category} className="mb-4">
                  <p className="mb-1.5 text-xs font-medium text-ink-secondary">{category.title}</p>
                  <ul className="rounded-control border border-line bg-surface-2 p-2 font-mono text-[11px]">
                    {category.items.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-3 py-0.5">
                        <span
                          className="selectable truncate text-ink-secondary"
                          title={item.detail}
                        >
                          {item.label}
                        </span>
                        <span className="shrink-0 text-ink-muted tabular-nums">
                          {formatBytes(item.size)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
          )}
        </div>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </Card>
  )
}
