import { useEffect, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Task } from '@shared/schemas/domain'
import { subscribe } from '@/lib/bridge'
import { queryKeys, useCommand, useRegistries } from '@/lib/queries'
import { Button, Input, ProgressBar, Select } from '@/components/ui/primitives'
import { Dialog } from '@/components/ui/overlays'
import { useToast } from '@/providers/ToastProvider'

/** Pull with live progress; the pull itself runs as a cancellable main-process task. */
export function PullImageDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange(open: boolean): void
}): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: registries = [] } = useRegistries()
  const [reference, setReference] = useState('')
  const [registryId, setRegistryId] = useState('none')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [task, setTask] = useState<Task | null>(null)

  const pull = useCommand('images.pull', { invalidate: [queryKeys.images] })

  useEffect(() => {
    if (!taskId) return undefined
    return subscribe((event) => {
      if (event.type !== 'task:update' || event.payload.id !== taskId) return
      setTask(event.payload)
      if (event.payload.status === 'succeeded') {
        void client.invalidateQueries({ queryKey: queryKeys.images })
        toast({ level: 'success', title: 'Image pulled', message: event.payload.detail })
        setTaskId(null)
        setReference('')
        onOpenChange(false)
      } else if (event.payload.status === 'failed') {
        toast({
          level: 'error',
          title: 'Pull failed',
          message: event.payload.error ?? 'Unknown error'
        })
        setTaskId(null)
      } else if (event.payload.status === 'cancelled') {
        setTaskId(null)
      }
    })
  }, [client, onOpenChange, taskId, toast])

  const start = async (): Promise<void> => {
    try {
      const result = await pull.mutateAsync({
        reference: reference.trim(),
        registryId: registryId === 'none' ? null : registryId
      })
      setTaskId(result.taskId)
      setTask(null)
    } catch (error) {
      toastError(error, 'Could not start the pull')
    }
  }

  const busy = taskId !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title="Pull an image"
      description="Harborlight uses the credentials stored for the selected registry, if any."
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pull.isPending || busy}
            disabled={!reference.trim()}
            onClick={() => void start()}
          >
            Pull
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">Reference</span>
          <Input
            autoFocus
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="ghcr.io/org/app:1.4.2"
            className="font-mono"
            disabled={busy}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">Registry</span>
          <Select
            ariaLabel="Registry"
            value={registryId}
            onChange={setRegistryId}
            options={[
              { value: 'none', label: 'Anonymous / default' },
              ...registries.map((entry) => ({
                value: entry.id,
                label: `${entry.name}${entry.hasCredentials ? '' : ' (not signed in)'}`
              }))
            ]}
          />
        </label>

        {busy ? (
          <div className="rounded-control border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between text-xs text-ink-secondary">
              <span className="truncate">{task?.detail ?? 'Starting…'}</span>
              <span className="tabular-nums">
                {task?.progress === null ? '' : `${task?.progress ?? 0}%`}
              </span>
            </div>
            <ProgressBar className="mt-2" value={task?.progress ?? null} />
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
