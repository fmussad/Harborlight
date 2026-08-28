import { useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  CircleStop,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Skull,
  Square,
  Trash2
} from 'lucide-react'
import type { ContainerSummary } from '@shared/schemas/domain'
import { invoke } from '@/lib/bridge'
import { queryKeys, useSettings } from '@/lib/queries'
import { Button, Checkbox, Input } from '@/components/ui/primitives'
import { ConfirmDialog, Dialog, DropdownMenu, type ConfirmRequest } from '@/components/ui/overlays'
import { useToast } from '@/providers/ToastProvider'

type Target = Pick<ContainerSummary, 'id' | 'name' | 'state'>

/**
 * Container lifecycle actions.
 *
 * Every destructive action goes through a confirmation that names the exact
 * containers involved; removing a running container additionally asks the user
 * to type its name.
 */
export function ContainerActions({
  containers,
  layout,
  onDone
}: {
  containers: Target[]
  layout: 'toolbar' | 'panel'
  onDone?(): void
}): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: settings } = useSettings()
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [renaming, setRenaming] = useState<Target | null>(null)
  const [newName, setNewName] = useState('')
  const [removeVolumes, setRemoveVolumes] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const running = containers.filter((container) => container.state === 'running')
  const paused = containers.filter((container) => container.state === 'paused')
  const stopped = containers.filter(
    (container) => container.state !== 'running' && container.state !== 'paused'
  )
  const single = containers.length === 1 ? containers[0]! : null
  const names = containers.map((container) => container.name)

  const refresh = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: queryKeys.containers })
    for (const container of containers) {
      await client.invalidateQueries({ queryKey: queryKeys.container(container.id) })
    }
  }

  const runBatch = async (
    label: string,
    targets: Target[],
    action: (target: Target) => Promise<unknown>
  ): Promise<void> => {
    if (targets.length === 0) return
    setBusy(label)
    const failures: string[] = []
    for (const target of targets) {
      try {
        await action(target)
      } catch (error) {
        failures.push(`${target.name}: ${(error as Error).message}`)
      }
    }
    setBusy(null)
    await refresh()
    onDone?.()

    if (failures.length === 0) {
      toast({
        level: 'success',
        title: `${label} ${targets.length === 1 ? targets[0]!.name : `${targets.length} containers`}`
      })
    } else if (failures.length === targets.length) {
      toast({ level: 'error', title: `${label} failed`, message: failures.join('\n') })
    } else {
      toast({
        level: 'warning',
        title: `${label} partially applied`,
        message: `${targets.length - failures.length} succeeded. ${failures.join(' ')}`
      })
    }
  }

  /**
   * The "confirm destructive actions" preference can silence recoverable
   * prompts, but a prompt that asks the user to type a name exists to prevent
   * data loss, so it is always shown.
   */
  const askOrRun = (request: ConfirmRequest): void => {
    const mustAsk = request.requireTyped !== undefined
    if (!mustAsk && settings?.confirmDestructive === false) {
      void request.onConfirm()
      return
    }
    setConfirm(request)
  }

  const removeAction = (): void => {
    const hasRunning = running.length > 0
    askOrRun({
      title:
        containers.length === 1
          ? `Remove ${single?.name}?`
          : `Remove ${containers.length} containers?`,
      description: hasRunning
        ? 'Running containers are force-removed. Any process inside is killed immediately.'
        : 'This deletes the container. Images and named volumes are kept unless you tick the option below.',
      resources: names,
      destructive: true,
      confirmLabel: hasRunning ? 'Force remove' : 'Remove',
      requireTyped: hasRunning && single ? single.name : undefined,
      extra: (
        <Checkbox
          checked={removeVolumes}
          onCheckedChange={setRemoveVolumes}
          label="Also remove anonymous volumes"
          description="Named volumes declared in Compose files are never touched."
        />
      ),
      onConfirm: () =>
        runBatch('Removed', containers, (target) =>
          invoke('containers.remove', { id: target.id, force: hasRunning, removeVolumes })
        )
    })
  }

  const killAction = (): void => {
    askOrRun({
      title:
        containers.length === 1 ? `Kill ${single?.name}?` : `Kill ${containers.length} containers?`,
      description: 'SIGKILL stops the process immediately, without letting it shut down cleanly.',
      resources: names,
      destructive: true,
      confirmLabel: 'Send SIGKILL',
      onConfirm: () =>
        runBatch('Killed', containers, (target) =>
          invoke('containers.kill', { id: target.id, signal: 'SIGKILL' })
        )
    })
  }

  const menuItems = [
    {
      label: 'Pause',
      icon: <Pause className="size-3.5" />,
      disabled: running.length === 0,
      onSelect: () =>
        void runBatch('Paused', running, (target) => invoke('containers.pause', { id: target.id }))
    },
    {
      label: 'Unpause',
      icon: <Play className="size-3.5" />,
      disabled: paused.length === 0,
      onSelect: () =>
        void runBatch('Unpaused', paused, (target) =>
          invoke('containers.unpause', { id: target.id })
        )
    },
    {
      label: 'Rename…',
      icon: <Pencil className="size-3.5" />,
      disabled: !single,
      onSelect: () => {
        if (!single) return
        setNewName(single.name)
        setRenaming(single)
      }
    },
    {
      label: 'Kill (SIGKILL)',
      icon: <Skull className="size-3.5" />,
      destructive: true,
      separatorBefore: true,
      disabled: running.length === 0,
      onSelect: killAction
    },
    {
      label: 'Remove…',
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
      disabled: containers.length === 0,
      onSelect: removeAction
    }
  ]

  const compact = layout === 'panel'

  return (
    <>
      <div className={compact ? 'flex items-center gap-2' : 'flex items-center gap-1.5'}>
        {compact ? (
          <>
            {running.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 justify-center"
                loading={busy === 'Stopped'}
                icon={<CircleStop className="size-3.5" />}
                onClick={() =>
                  void runBatch('Stopped', running, (target) =>
                    invoke('containers.stop', { id: target.id })
                  )
                }
              >
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 justify-center"
                loading={busy === 'Started'}
                icon={<Play className="size-3.5" />}
                onClick={() =>
                  void runBatch('Started', stopped, (target) =>
                    invoke('containers.start', { id: target.id })
                  )
                }
              >
                Start
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              className="flex-1 justify-center"
              loading={busy === 'Restarted'}
              icon={<RotateCw className="size-3.5" />}
              disabled={running.length === 0}
              onClick={() =>
                void runBatch('Restarted', running, (target) =>
                  invoke('containers.restart', { id: target.id })
                )
              }
            >
              Restart
            </Button>
            <DropdownMenu
              items={menuItems}
              trigger={
                <Button size="sm" variant="secondary" aria-label="More container actions">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              }
            />
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={stopped.length === 0}
              loading={busy === 'Started'}
              icon={<Play className="size-3.5" />}
              onClick={() =>
                void runBatch('Started', stopped, (target) =>
                  invoke('containers.start', { id: target.id })
                )
              }
            >
              Start
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={running.length === 0}
              loading={busy === 'Stopped'}
              icon={<Square className="size-3.5" />}
              onClick={() =>
                void runBatch('Stopped', running, (target) =>
                  invoke('containers.stop', { id: target.id })
                )
              }
            >
              Stop
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={running.length === 0}
              loading={busy === 'Restarted'}
              icon={<RotateCw className="size-3.5" />}
              onClick={() =>
                void runBatch('Restarted', running, (target) =>
                  invoke('containers.restart', { id: target.id })
                )
              }
            >
              Restart
            </Button>
            <DropdownMenu
              items={menuItems}
              trigger={
                <Button size="sm" variant="secondary" disabled={containers.length === 0}>
                  More
                  <ChevronDown className="size-3.5" />
                </Button>
              }
            />
          </>
        )}
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
        title={`Rename ${renaming?.name ?? ''}`}
        description="Docker names must start with a letter or digit and may contain letters, digits, dots, dashes and underscores."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newName.trim() || newName === renaming?.name}
              onClick={() => {
                const target = renaming
                if (!target) return
                setRenaming(null)
                void (async () => {
                  try {
                    await invoke('containers.rename', { id: target.id, name: newName.trim() })
                    await refresh()
                    toast({ level: 'success', title: `Renamed to ${newName.trim()}` })
                  } catch (error) {
                    toastError(error, 'Rename failed')
                  }
                })()
              }}
            >
              Rename
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          aria-label="New container name"
        />
      </Dialog>
    </>
  )
}
