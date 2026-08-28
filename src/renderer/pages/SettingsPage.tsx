import { useState, type ReactElement, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bug,
  CheckCircle2,
  ExternalLink,
  Monitor,
  Moon,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Sun
} from 'lucide-react'
import type { Settings } from '@shared/schemas/domain'
import { formatDateTime } from '@shared/utils/format'
import { cn } from '@/lib/cn'
import { invoke, isMockTransport } from '@/lib/bridge'
import { describeEngine } from '@/lib/engine'
import {
  queryKeys,
  useAppInfo,
  useEngineStatus,
  usePlatformInfo,
  useSettings,
  useSockets
} from '@/lib/queries'
import {
  Badge,
  Button,
  Card,
  Input,
  SegmentedControl,
  Select,
  Switch,
  Tooltip
} from '@/components/ui/primitives'
import { ConfirmDialog, type ConfirmRequest } from '@/components/ui/overlays'
import { PageHeader } from '@/components/ui/table'
import { MonoText } from '@/components/common/StatusBits'
import { useToast } from '@/providers/ToastProvider'

function Section({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}): ReactElement {
  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </Card>
  )
}

function Row({
  label,
  hint,
  control,
  className
}: {
  label: ReactNode
  hint?: ReactNode
  control: ReactNode
  className?: string
}): ReactElement {
  return (
    <div
      className={cn('flex items-start justify-between gap-6 py-3 first:pt-0 last:pb-0', className)}
    >
      <div className="min-w-0">
        <p className="text-[13px] text-ink">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export function SettingsPage(): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: settings } = useSettings()
  const { data: appInfo } = useAppInfo()
  const { data: platform } = usePlatformInfo()
  const { data: status } = useEngineStatus()
  const { data: sockets = [] } = useSockets()

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [customSocket, setCustomSocket] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [exporting, setExporting] = useState(false)

  const update = async (patch: Partial<Settings>): Promise<void> => {
    try {
      const next = await invoke('settings.update', patch)
      client.setQueryData(queryKeys.settings, next)
    } catch (error) {
      toastError(error, 'Could not save the setting')
    }
  }

  if (!settings) {
    return (
      <div className="min-h-full">
        <PageHeader title="Settings" />
      </div>
    )
  }

  const engine = describeEngine(status)
  const socketValue = settings.useCustomSocket ? 'custom' : settings.dockerSocket

  return (
    <div className="min-h-full">
      <PageHeader
        title="Settings"
        description="Preferences are stored per user under ~/.config/Harborlight."
        actions={
          <Button
            variant="secondary"
            icon={<RotateCcw className="size-3.5" />}
            onClick={() =>
              setConfirm({
                title: 'Reset all settings?',
                description:
                  'Every preference returns to its default. Registries and stored credentials are not touched.',
                confirmLabel: 'Reset settings',
                destructive: true,
                onConfirm: async () => {
                  try {
                    const next = await invoke('settings.reset')
                    client.setQueryData(queryKeys.settings, next)
                    toast({ level: 'success', title: 'Settings reset to defaults' })
                  } catch (error) {
                    toastError(error, 'Could not reset settings')
                  }
                }
              })
            }
          >
            Reset to defaults
          </Button>
        }
      />

      <div className="mx-auto max-w-3xl space-y-4 p-5">
        <Section title="Appearance">
          <Row
            label="Theme"
            hint="System follows the Ubuntu desktop preference."
            control={
              <SegmentedControl
                ariaLabel="Theme"
                value={settings.theme}
                onChange={(theme) => void update({ theme })}
                options={[
                  { value: 'light', label: <Sun className="size-3.5" />, title: 'Light' },
                  { value: 'dark', label: <Moon className="size-3.5" />, title: 'Dark' },
                  { value: 'system', label: <Monitor className="size-3.5" />, title: 'System' }
                ]}
              />
            }
          />
        </Section>

        <Section
          title="Docker engine"
          description={`${engine.label}${status?.version ? ` · Docker ${status.version}` : ''}`}
        >
          <Row
            label="Engine"
            hint="The demo engine serves deterministic sample data and never touches Docker."
            control={
              <SegmentedControl
                ariaLabel="Engine mode"
                value={settings.engineMode}
                onChange={(engineMode) => void update({ engineMode })}
                options={[
                  { value: 'docker', label: 'Docker' },
                  { value: 'mock', label: 'Demo data' }
                ]}
              />
            }
          />
          <Row
            label="Socket"
            hint={
              status?.rootless
                ? 'Rootless Docker detected.'
                : 'Harborlight connects to the Docker Engine API over a Unix socket.'
            }
            control={
              <div className="flex w-80 flex-col items-end gap-2">
                <Select
                  ariaLabel="Docker socket"
                  className="w-full"
                  value={socketValue}
                  onChange={(value) => {
                    if (value === 'custom') {
                      setCustomSocket(settings.dockerSocket)
                      void update({ useCustomSocket: true })
                    } else {
                      setCustomSocket(null)
                      void update({ useCustomSocket: false, dockerSocket: value })
                    }
                  }}
                  options={[
                    ...sockets.map((socket) => ({
                      value: socket.path,
                      label: `${socket.label}${socket.readable ? '' : ' (not readable)'}`
                    })),
                    { value: 'custom', label: 'Custom path…' }
                  ]}
                />
                {settings.useCustomSocket ? (
                  <Input
                    className="font-mono"
                    wrapperClassName="w-full"
                    aria-label="Custom socket path"
                    value={customSocket ?? settings.dockerSocket}
                    onChange={(event) => setCustomSocket(event.target.value)}
                    onBlur={() => {
                      if (customSocket && customSocket !== settings.dockerSocket) {
                        void update({ dockerSocket: customSocket })
                      }
                    }}
                  />
                ) : null}
              </div>
            }
          />
          <Row
            label="Refresh interval"
            hint="How often container and engine data is polled."
            control={
              <Select
                ariaLabel="Refresh interval"
                className="w-40"
                value={String(settings.pollIntervalMs)}
                onChange={(value) => void update({ pollIntervalMs: Number(value) })}
                options={[
                  { value: '2000', label: '2 seconds' },
                  { value: '5000', label: '5 seconds' },
                  { value: '10000', label: '10 seconds' },
                  { value: '30000', label: '30 seconds' }
                ]}
              />
            }
          />
          <Row
            label="Connection"
            hint={status?.error ?? status?.socketPath ?? ''}
            control={
              <Button
                variant="secondary"
                loading={reconnecting}
                icon={<PlugZap className="size-3.5" />}
                onClick={() => {
                  setReconnecting(true)
                  void (async () => {
                    try {
                      const next = await invoke('engine.reconnect')
                      client.setQueryData(queryKeys.engineStatus, next)
                      await client.invalidateQueries()
                      toast({
                        level: next.connected ? 'success' : 'warning',
                        title: next.connected ? 'Connected' : 'Still not connected',
                        message: next.error ?? undefined,
                        hint: next.errorHint
                      })
                    } catch (error) {
                      toastError(error, 'Reconnect failed')
                    } finally {
                      setReconnecting(false)
                    }
                  })()
                }}
              >
                Reconnect
              </Button>
            }
          />
        </Section>

        <Section title="Logs and terminal">
          <Row
            label="Tail lines"
            hint="How much history is requested when a log stream opens."
            control={
              <Select
                ariaLabel="Tail lines"
                className="w-32"
                value={String(settings.logTailLines)}
                onChange={(value) => void update({ logTailLines: Number(value) })}
                options={[
                  { value: '200', label: '200' },
                  { value: '500', label: '500' },
                  { value: '2000', label: '2000' },
                  { value: '10000', label: '10000' }
                ]}
              />
            }
          />
          <Row
            label="Show timestamps"
            control={
              <Switch
                ariaLabel="Show timestamps"
                checked={settings.logTimestamps}
                onCheckedChange={(logTimestamps) => void update({ logTimestamps })}
              />
            }
          />
          <Row
            label="Wrap long lines"
            control={
              <Switch
                ariaLabel="Word wrap"
                checked={settings.logWordWrap}
                onCheckedChange={(logWordWrap) => void update({ logWordWrap })}
              />
            }
          />
          <Row
            label="Default shell"
            hint="Harborlight falls back to sh when the preferred shell is missing in the image."
            control={
              <Select
                ariaLabel="Default shell"
                className="w-40"
                value={settings.defaultShell}
                onChange={(defaultShell) => void update({ defaultShell })}
                options={[
                  { value: '/bin/bash', label: '/bin/bash' },
                  { value: '/bin/sh', label: '/bin/sh' },
                  { value: '/bin/ash', label: '/bin/ash' },
                  { value: '/bin/zsh', label: '/bin/zsh' }
                ]}
              />
            }
          />
        </Section>

        <Section title="Desktop integration">
          <Row
            label="Keep running in the tray when the window closes"
            hint={
              platform && !platform.trayLikelySupported
                ? 'This desktop session may not show tray icons; GNOME needs the AppIndicator extension.'
                : undefined
            }
            control={
              <Switch
                ariaLabel="Close to tray"
                checked={settings.closeToTray}
                onCheckedChange={(closeToTray) => void update({ closeToTray })}
              />
            }
          />
          <Row
            label="Start Harborlight at login"
            hint="Writes a desktop entry to ~/.config/autostart."
            control={
              <Switch
                ariaLabel="Start at login"
                checked={settings.startAtLogin}
                onCheckedChange={(startAtLogin) => void update({ startAtLogin })}
              />
            }
          />
          <Row
            label="Start minimised to the tray"
            control={
              <Switch
                ariaLabel="Start minimised"
                checked={settings.startMinimized}
                disabled={!settings.startAtLogin}
                onCheckedChange={(startMinimized) => void update({ startMinimized })}
              />
            }
          />
          <Row
            label="Desktop notifications"
            hint="Used for finished pulls, Compose runs and cleanup results."
            control={
              <Switch
                ariaLabel="Desktop notifications"
                checked={settings.desktopNotifications}
                onCheckedChange={(desktopNotifications) => void update({ desktopNotifications })}
              />
            }
          />
        </Section>

        <Section title="Safety">
          <Row
            label="Confirm destructive actions"
            hint="Removals and prunes always list the affected resources first. Anything that can delete data keeps asking even when this is off."
            control={
              <Switch
                ariaLabel="Confirm destructive actions"
                checked={settings.confirmDestructive}
                onCheckedChange={(confirmDestructive) => void update({ confirmDestructive })}
              />
            }
          />
          <Row
            label="Redact secrets in environment variables"
            hint="Values of variables that look like tokens or passwords are masked in the UI and in diagnostics."
            control={
              <Switch
                ariaLabel="Redact secrets"
                checked={settings.redactEnvSecrets}
                onCheckedChange={(redactEnvSecrets) => void update({ redactEnvSecrets })}
              />
            }
          />
        </Section>

        <Section title="Updates">
          <Row
            label="Channel"
            control={
              <SegmentedControl
                ariaLabel="Update channel"
                value={settings.updateChannel}
                onChange={(updateChannel) => void update({ updateChannel })}
                options={[
                  { value: 'stable', label: 'Stable' },
                  { value: 'beta', label: 'Beta' }
                ]}
              />
            }
          />
          <Row
            label="Check for updates"
            hint="Harborlight only checks a version manifest; it never installs anything by itself."
            control={
              <Button
                variant="secondary"
                loading={checking}
                icon={<RefreshCw className="size-3.5" />}
                onClick={() => {
                  setChecking(true)
                  void (async () => {
                    try {
                      const info = await invoke('system.checkForUpdates')
                      toast({
                        level: info.updateAvailable ? 'info' : 'success',
                        title: info.updateAvailable
                          ? `Version ${info.latestVersion} is available`
                          : 'Harborlight is up to date',
                        message: info.message
                      })
                    } catch (error) {
                      toastError(error, 'Update check failed')
                    } finally {
                      setChecking(false)
                    }
                  })()
                }}
              >
                Check now
              </Button>
            }
          />
        </Section>

        <Section title="About">
          <Row
            label="Version"
            control={
              <div className="flex items-center gap-2">
                <MonoText>
                  {appInfo?.version ?? '—'}
                  {appInfo?.dirty ? '+dirty' : ''}
                </MonoText>
                <Badge tone={appInfo?.channel === 'beta' ? 'warning' : 'neutral'}>
                  {appInfo?.channel ?? 'stable'}
                </Badge>
              </div>
            }
          />
          <Row
            label="Build"
            control={
              <span className="text-right text-xs text-ink-muted">
                <MonoText>{appInfo?.gitSha?.slice(0, 12) ?? 'unknown'}</MonoText>
                <br />
                {formatDateTime(appInfo?.buildDate)}
              </span>
            }
          />
          <Row
            label="Runtime"
            control={
              <MonoText className="text-right">
                Electron {appInfo?.electron ?? '—'} · Chromium {appInfo?.chrome ?? '—'} · Node{' '}
                {appInfo?.node ?? '—'}
              </MonoText>
            }
          />
          <Row
            label="Platform"
            control={
              <span className="text-right text-xs text-ink-secondary">
                {platform
                  ? `${platform.distroName} ${platform.versionId} · ${platform.architecture}`
                  : '—'}
                {platform?.supported === false ? (
                  <Badge tone="warning" className="ml-2">
                    unsupported
                  </Badge>
                ) : null}
                <br />
                <span className="text-ink-muted">
                  {platform?.sessionType} · {platform?.desktop}
                  {platform?.inDockerGroup ? ' · docker group' : ''}
                </span>
              </span>
            }
          />
          <Row
            label="Installation"
            control={
              <span className="text-xs text-ink-secondary">
                {appInfo?.installKind ?? 'unknown'}
                {isMockTransport() ? ' · browser preview' : ''}
              </span>
            }
          />
          <Row
            label="Diagnostics"
            hint="Writes a redacted bundle with logs, settings and engine details."
            control={
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  loading={exporting}
                  icon={<Bug className="size-3.5" />}
                  onClick={() => {
                    setExporting(true)
                    void (async () => {
                      try {
                        const result = await invoke('system.exportDiagnostics')
                        if (!result.cancelled && result.path) {
                          toast({
                            level: 'success',
                            title: 'Diagnostics exported',
                            message: result.path
                          })
                        }
                      } catch (error) {
                        toastError(error, 'Could not export diagnostics')
                      } finally {
                        setExporting(false)
                      }
                    })()
                  }}
                >
                  Export
                </Button>
                <Tooltip content="Opens in your browser">
                  <Button
                    variant="ghost"
                    icon={<ExternalLink className="size-3.5" />}
                    onClick={() =>
                      void invoke('system.openExternal', {
                        url: 'https://github.com/fmussad/Harborlight'
                      }).catch((error) => toastError(error, 'Could not open the link'))
                    }
                  >
                    Project page
                  </Button>
                </Tooltip>
              </div>
            }
          />
        </Section>

        <p className="flex items-center justify-center gap-1.5 pb-2 text-[11px] text-ink-muted">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Harborlight never sends telemetry, and only talks to the network when you ask it to.
        </p>
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
