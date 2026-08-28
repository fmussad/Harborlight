import { useMemo, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import type { CommandInput } from '@shared/contracts/commands'
import { invoke } from '@/lib/bridge'
import { queryKeys, useImages } from '@/lib/queries'
import { Button, Checkbox, Input, Select } from '@/components/ui/primitives'
import { Dialog } from '@/components/ui/overlays'
import { useToast } from '@/providers/ToastProvider'

type RunInput = CommandInput<'containers.run'>

interface PortRow {
  hostPort: string
  containerPort: string
  protocol: 'tcp' | 'udp'
}

interface EnvRow {
  key: string
  value: string
}

interface VolumeRow {
  source: string
  target: string
  readOnly: boolean
}

const RESTART_OPTIONS = [
  { value: 'no', label: 'No restart' },
  { value: 'on-failure', label: 'On failure' },
  { value: 'always', label: 'Always' },
  { value: 'unless-stopped', label: 'Unless stopped' }
]

function RowList({
  label,
  onAdd,
  children
}: {
  label: string
  onAdd(): void
  children: ReactElement | ReactElement[]
}): ReactElement {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-ink-secondary">{label}</span>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={onAdd}>
          Add
        </Button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

/**
 * `docker run` equivalent.
 *
 * Values are sent as structured fields, never as a shell string, so nothing the
 * user types can be interpreted as a command.
 */
export function RunContainerDialog({
  open,
  onOpenChange,
  initialImage
}: {
  open: boolean
  onOpenChange(open: boolean): void
  initialImage?: string
}): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: images = [] } = useImages(false)

  const [image, setImage] = useState(initialImage ?? '')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [restartPolicy, setRestartPolicy] = useState('no')
  const [autoRemove, setAutoRemove] = useState(false)
  const [ports, setPorts] = useState<PortRow[]>([])
  const [env, setEnv] = useState<EnvRow[]>([])
  const [volumes, setVolumes] = useState<VolumeRow[]>([])
  const [submitting, setSubmitting] = useState(false)

  const suggestions = useMemo(
    () => images.flatMap((entry) => entry.repoTags).filter((tag) => tag && tag !== '<none>:<none>'),
    [images]
  )

  const reset = (): void => {
    setImage(initialImage ?? '')
    setName('')
    setCommand('')
    setRestartPolicy('no')
    setAutoRemove(false)
    setPorts([])
    setEnv([])
    setVolumes([])
  }

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    try {
      const payload: RunInput = {
        image: image.trim(),
        name: name.trim() || undefined,
        command: command.trim() || undefined,
        restartPolicy: restartPolicy as RunInput['restartPolicy'],
        autoRemove,
        detach: true,
        ports: ports
          .filter((row) => row.hostPort && row.containerPort)
          .map((row) => ({
            hostPort: Number(row.hostPort),
            containerPort: Number(row.containerPort),
            protocol: row.protocol
          })),
        env: env
          .filter((row) => row.key.trim())
          .map((row) => ({ key: row.key.trim(), value: row.value })),
        volumes: volumes
          .filter((row) => row.source.trim() && row.target.trim())
          .map((row) => ({
            source: row.source.trim(),
            target: row.target.trim(),
            readOnly: row.readOnly
          }))
      }

      const result = await invoke('containers.run', payload)
      await client.invalidateQueries({ queryKey: queryKeys.containers })
      toast({ level: 'success', title: `Started ${result.name}`, message: image })
      reset()
      onOpenChange(false)
    } catch (error) {
      toastError(error, 'Could not run the container')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title="Run a container"
      description="Harborlight passes these values to the Docker API as structured arguments."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!image.trim()}
            loading={submitting}
            onClick={() => void submit()}
          >
            Run container
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-secondary">Image</span>
            <Input
              autoFocus
              list="harborlight-image-suggestions"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              placeholder="ghcr.io/org/app:1.0.0"
            />
            <datalist id="harborlight-image-suggestions">
              {suggestions.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-secondary">
              Name (optional)
            </span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-service"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">
            Command override (optional)
          </span>
          <Input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="npm run start"
            className="font-mono"
          />
          <span className="mt-1 block text-[11px] text-ink-muted">
            Split into arguments by Harborlight. Shell operators such as | or &amp;&amp; are
            rejected.
          </span>
        </label>

        <RowList
          label="Published ports"
          onAdd={() =>
            setPorts((rows) => [...rows, { hostPort: '', containerPort: '', protocol: 'tcp' }])
          }
        >
          {ports.length === 0 ? (
            <p className="text-[11px] text-ink-muted">No ports published.</p>
          ) : (
            ports.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={row.hostPort}
                  inputMode="numeric"
                  placeholder="8080"
                  aria-label="Host port"
                  wrapperClassName="w-28"
                  onChange={(event) =>
                    setPorts((rows) =>
                      rows.map((entry, position) =>
                        position === index ? { ...entry, hostPort: event.target.value } : entry
                      )
                    )
                  }
                />
                <span className="text-ink-muted">:</span>
                <Input
                  value={row.containerPort}
                  inputMode="numeric"
                  placeholder="80"
                  aria-label="Container port"
                  wrapperClassName="w-28"
                  onChange={(event) =>
                    setPorts((rows) =>
                      rows.map((entry, position) =>
                        position === index ? { ...entry, containerPort: event.target.value } : entry
                      )
                    )
                  }
                />
                <Select
                  ariaLabel="Protocol"
                  className="w-24"
                  value={row.protocol}
                  options={[
                    { value: 'tcp', label: 'TCP' },
                    { value: 'udp', label: 'UDP' }
                  ]}
                  onChange={(value) =>
                    setPorts((rows) =>
                      rows.map((entry, position) =>
                        position === index ? { ...entry, protocol: value as 'tcp' | 'udp' } : entry
                      )
                    )
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove port"
                  onClick={() =>
                    setPorts((rows) => rows.filter((_, position) => position !== index))
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </RowList>

        <RowList
          label="Environment variables"
          onAdd={() => setEnv((rows) => [...rows, { key: '', value: '' }])}
        >
          {env.length === 0 ? (
            <p className="text-[11px] text-ink-muted">No environment variables.</p>
          ) : (
            env.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={row.key}
                  placeholder="KEY"
                  aria-label="Variable name"
                  wrapperClassName="w-44"
                  className="font-mono"
                  onChange={(event) =>
                    setEnv((rows) =>
                      rows.map((entry, position) =>
                        position === index ? { ...entry, key: event.target.value } : entry
                      )
                    )
                  }
                />
                <Input
                  value={row.value}
                  placeholder="value"
                  aria-label="Variable value"
                  wrapperClassName="flex-1"
                  className="font-mono"
                  onChange={(event) =>
                    setEnv((rows) =>
                      rows.map((entry, position) =>
                        position === index ? { ...entry, value: event.target.value } : entry
                      )
                    )
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove variable"
                  onClick={() => setEnv((rows) => rows.filter((_, position) => position !== index))}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </RowList>

        <RowList
          label="Volumes"
          onAdd={() => setVolumes((rows) => [...rows, { source: '', target: '', readOnly: false }])}
        >
          {volumes.length === 0 ? (
            <p className="text-[11px] text-ink-muted">No volumes mounted.</p>
          ) : (
            volumes.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={row.source}
                  placeholder="volume-name or /host/path"
                  aria-label="Source"
                  wrapperClassName="flex-1"
                  className="font-mono"
                  onChange={(event) =>
                    setVolumes((rows) =>
                      rows.map((entry, position) =>
                        position === index ? { ...entry, source: event.target.value } : entry
                      )
                    )
                  }
                />
                <Input
                  value={row.target}
                  placeholder="/data"
                  aria-label="Target"
                  wrapperClassName="flex-1"
                  className="font-mono"
                  onChange={(event) =>
                    setVolumes((rows) =>
                      rows.map((entry, position) =>
                        position === index ? { ...entry, target: event.target.value } : entry
                      )
                    )
                  }
                />
                <Checkbox
                  checked={row.readOnly}
                  onCheckedChange={(checked) =>
                    setVolumes((rows) =>
                      rows.map((entry, position) =>
                        position === index ? { ...entry, readOnly: checked } : entry
                      )
                    )
                  }
                  label="ro"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove volume"
                  onClick={() =>
                    setVolumes((rows) => rows.filter((_, position) => position !== index))
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </RowList>

        <div className="flex items-center gap-6 border-t border-line pt-3">
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-ink-secondary">Restart policy</span>
            <Select
              ariaLabel="Restart policy"
              className="w-40"
              value={restartPolicy}
              onChange={setRestartPolicy}
              options={RESTART_OPTIONS}
            />
          </label>
          <Checkbox
            checked={autoRemove}
            onCheckedChange={setAutoRemove}
            label="Remove when it exits"
            description="Equivalent to --rm."
          />
        </div>
      </div>
    </Dialog>
  )
}
