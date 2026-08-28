import type { ReactElement, ReactNode } from 'react'
import { AlertTriangle, PlugZap, RefreshCw } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/bridge'
import { describeEngine } from '@/lib/engine'
import { queryKeys, useAppInfo, useEngineStatus } from '@/lib/queries'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/primitives'
import { useToast } from '@/providers/ToastProvider'
import { CommandPalette } from './CommandPalette'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/**
 * Shown whenever the engine is unreachable. It stays out of the way of the
 * navigation so the user can still browse Settings and fix the connection.
 */
function EngineBanner(): ReactElement | null {
  const { data: status } = useEngineStatus()
  const client = useQueryClient()
  const navigate = useUiStore((state) => state.navigate)
  const { toast, toastError } = useToast()

  const reconnect = useMutation({
    mutationFn: () => invoke('engine.reconnect'),
    onSuccess: async (next) => {
      client.setQueryData(queryKeys.engineStatus, next)
      if (next.connected) {
        toast({ level: 'success', title: 'Connected to the Docker engine' })
        await client.invalidateQueries()
      } else {
        toast({
          level: 'warning',
          title: 'Still not connected',
          message: next.error ?? 'The Docker engine did not respond.',
          hint: next.errorHint
        })
      }
    },
    onError: (error) => toastError(error, 'Reconnect failed')
  })

  if (!status || status.connected) return null
  const engine = describeEngine(status)

  return (
    <div className="flex items-start gap-3 border-b border-warning-line bg-warning-soft px-4 py-2.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-warning-fg">{engine.label}</p>
        <p className="selectable mt-0.5 text-xs text-ink-secondary">
          {status.error ?? 'Harborlight cannot reach the Docker engine.'}
          {status.errorHint ? ` ${status.errorHint}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw className="size-3.5" />}
          loading={reconnect.isPending}
          onClick={() => reconnect.mutate()}
        >
          Retry
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<PlugZap className="size-3.5" />}
          onClick={() => navigate('settings')}
        >
          Engine settings
        </Button>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const { data: status } = useEngineStatus()
  const { data: appInfo } = useAppInfo()

  return (
    <div className="flex h-full w-full overflow-hidden bg-app">
      <Sidebar engineStatus={status} version={appInfo?.version ?? '0.0.0'} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <EngineBanner />
        <main className="hl-scroll min-h-0 flex-1">{children}</main>
      </div>
      <CommandPalette />
    </div>
  )
}
