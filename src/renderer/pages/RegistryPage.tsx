import { useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, LogIn, LogOut, Plus, ServerCog, ShieldAlert, Trash2 } from 'lucide-react'
import type { RegistryEntry, RegistryKind } from '@shared/schemas/domain'
import { formatRelativeTime } from '@shared/utils/format'
import { invoke } from '@/lib/bridge'
import { queryKeys, useRegistries, useRegistryStatus } from '@/lib/queries'
import { Badge, Button, Card, EmptyState, Input, Select } from '@/components/ui/primitives'
import { ConfirmDialog, Dialog, type ConfirmRequest } from '@/components/ui/overlays'
import { PageHeader } from '@/components/ui/table'
import { MonoText } from '@/components/common/StatusBits'
import { useToast } from '@/providers/ToastProvider'

const KIND_LABEL: Record<RegistryKind, string> = {
  dockerhub: 'Docker Hub',
  ghcr: 'GitHub Container Registry',
  custom: 'Custom registry'
}

const KIND_DEFAULT_ADDRESS: Record<RegistryKind, string> = {
  dockerhub: 'https://index.docker.io/v1/',
  ghcr: 'ghcr.io',
  custom: ''
}

function AddRegistryDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange(open: boolean): void
}): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const [kind, setKind] = useState<RegistryKind>('dockerhub')
  const [name, setName] = useState('Docker Hub')
  const [serverAddress, setServerAddress] = useState(KIND_DEFAULT_ADDRESS.dockerhub)
  const [busy, setBusy] = useState(false)

  const changeKind = (next: RegistryKind): void => {
    setKind(next)
    setName(KIND_LABEL[next])
    setServerAddress(KIND_DEFAULT_ADDRESS[next])
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a registry"
      description="Credentials are stored separately, encrypted with the desktop keyring."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim() || !serverAddress.trim()}
            onClick={() => {
              setBusy(true)
              void (async () => {
                try {
                  await invoke('registry.add', {
                    name: name.trim(),
                    kind,
                    serverAddress: serverAddress.trim()
                  })
                  await client.invalidateQueries({ queryKey: queryKeys.registries })
                  toast({ level: 'success', title: `Added ${name.trim()}` })
                  onOpenChange(false)
                } catch (error) {
                  toastError(error, 'Could not add the registry')
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Add registry
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">Type</span>
          <Select
            ariaLabel="Registry type"
            value={kind}
            onChange={(value) => changeKind(value as RegistryKind)}
            options={[
              { value: 'dockerhub', label: KIND_LABEL.dockerhub },
              { value: 'ghcr', label: KIND_LABEL.ghcr },
              { value: 'custom', label: KIND_LABEL.custom }
            ]}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">Display name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">Server address</span>
          <Input
            value={serverAddress}
            onChange={(event) => setServerAddress(event.target.value)}
            className="font-mono"
            placeholder="registry.example.com"
          />
        </label>
      </div>
    </Dialog>
  )
}

function LoginDialog({
  entry,
  onClose
}: {
  entry: RegistryEntry | null
  onClose(): void
}): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) {
          setUsername('')
          setSecret('')
          onClose()
        }
      }}
      title={`Sign in to ${entry?.name ?? ''}`}
      description="Use a personal access token rather than your account password where possible."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!username.trim() || !secret}
            onClick={() => {
              if (!entry) return
              setBusy(true)
              void (async () => {
                try {
                  await invoke('registry.login', {
                    id: entry.id,
                    username: username.trim(),
                    secret
                  })
                  await client.invalidateQueries({ queryKey: queryKeys.registries })
                  toast({ level: 'success', title: `Signed in to ${entry.name}` })
                  setUsername('')
                  setSecret('')
                  onClose()
                } catch (error) {
                  toastError(error, 'Sign-in failed')
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Sign in
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">Username</span>
          <Input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">
            Password or token
          </span>
          <Input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
        <p className="rounded-control border border-line bg-surface-2 p-2 text-[11px] text-ink-muted">
          The token never reaches the renderer again: it is encrypted in the main process and only
          used when pulling from this registry.
        </p>
      </div>
    </Dialog>
  )
}

export function RegistryPage(): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: registries = [], isLoading } = useRegistries()
  const { data: storage } = useRegistryStatus()

  const [addOpen, setAddOpen] = useState(false)
  const [loginTarget, setLoginTarget] = useState<RegistryEntry | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  return (
    <div className="min-h-full">
      <PageHeader
        title="Registry"
        description="Sign in to registries so Harborlight can pull private images."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-3.5" />}
            onClick={() => setAddOpen(true)}
          >
            Add registry
          </Button>
        }
      />

      <div className="space-y-4 p-5">
        {storage && !storage.available ? (
          <Card className="flex items-start gap-3 border-warning-line bg-warning-soft p-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden />
            <div>
              <p className="text-[13px] font-medium text-warning-fg">
                Secure storage is unavailable
              </p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {storage.reason ??
                  'Harborlight cannot reach a keyring, so credentials cannot be stored safely.'}{' '}
                Install <code className="font-mono">gnome-keyring</code> and sign in again.
              </p>
            </div>
          </Card>
        ) : null}

        {isLoading ? null : registries.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ServerCog className="size-5" />}
              title="No registries configured"
              description="Add Docker Hub, GHCR or a private registry to pull images that need authentication."
              action={
                <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
                  Add a registry
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {registries.map((entry) => (
              <Card key={entry.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-[13px] font-semibold text-ink">{entry.name}</h2>
                      <Badge tone={entry.hasCredentials ? 'success' : 'neutral'}>
                        {entry.hasCredentials ? 'signed in' : 'anonymous'}
                      </Badge>
                    </div>
                    <MonoText className="mt-1 block truncate">{entry.serverAddress}</MonoText>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {KIND_LABEL[entry.kind]}
                      {entry.username ? ` · ${entry.username}` : ''}
                      {entry.lastLoginAt
                        ? ` · signed in ${formatRelativeTime(entry.lastLoginAt)}`
                        : ''}
                    </p>
                  </div>
                  <KeyRound className="size-4 shrink-0 text-ink-muted" aria-hidden />
                </div>

                <div className="mt-3 flex items-center gap-2">
                  {entry.hasCredentials ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<LogOut className="size-3.5" />}
                      onClick={() => {
                        void (async () => {
                          try {
                            await invoke('registry.logout', { id: entry.id })
                            await client.invalidateQueries({ queryKey: queryKeys.registries })
                            toast({ level: 'success', title: `Signed out of ${entry.name}` })
                          } catch (error) {
                            toastError(error, 'Sign-out failed')
                          }
                        })()
                      }}
                    >
                      Sign out
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<LogIn className="size-3.5" />}
                      disabled={storage ? !storage.available : false}
                      onClick={() => setLoginTarget(entry)}
                    >
                      Sign in
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="size-3.5" />}
                    onClick={() =>
                      setConfirm({
                        title: `Remove ${entry.name}?`,
                        description:
                          'The registry entry and any stored credentials are deleted from this machine.',
                        resources: [entry.serverAddress],
                        destructive: true,
                        confirmLabel: 'Remove registry',
                        onConfirm: async () => {
                          try {
                            await invoke('registry.remove', { id: entry.id })
                            await client.invalidateQueries({ queryKey: queryKeys.registries })
                            toast({ level: 'success', title: `Removed ${entry.name}` })
                          } catch (error) {
                            toastError(error, 'Could not remove the registry')
                          }
                        }
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AddRegistryDialog open={addOpen} onOpenChange={setAddOpen} />
      <LoginDialog entry={loginTarget} onClose={() => setLoginTarget(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
