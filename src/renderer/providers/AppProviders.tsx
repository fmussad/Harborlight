import { useEffect, type ReactElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import type { AppEventEnvelope } from '@shared/contracts/responses'
import { subscribe } from '@/lib/bridge'
import { queryKeys, useSettings } from '@/lib/queries'
import { useUiStore } from '@/stores/ui'
import { TooltipProvider } from '@/components/ui/primitives'
import { ToastProvider, useToast } from './ToastProvider'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Engine-level failures are surfaced immediately instead of retried.
        const code = (error as { code?: string })?.code
        if (
          code === 'engine-unavailable' ||
          code === 'permission-denied' ||
          code === 'not-allowed'
        ) {
          return false
        }
        return failureCount < 2
      },
      refetchOnWindowFocus: true
    }
  }
})

/** Applies the theme to <html> and follows the OS when set to "system". */
function ThemeSync(): null {
  const { data: settings } = useSettings()
  const theme = settings?.theme ?? 'system'

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.classList.toggle('light', !dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    if (theme !== 'system') return undefined
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  return null
}

/**
 * Bridges main-process events into React Query and the UI store: engine status,
 * background tasks, notifications and tray navigation.
 */
function EventBridge(): null {
  const client = useQueryClient()
  const { toast } = useToast()
  const pushNotification = useUiStore((state) => state.pushNotification)
  const navigateToPath = useUiStore((state) => state.navigateToPath)
  const setCommandPalette = useUiStore((state) => state.setCommandPalette)

  useEffect(() => {
    return subscribe((event: AppEventEnvelope) => {
      switch (event.type) {
        case 'engine:status':
          client.setQueryData(queryKeys.engineStatus, event.payload)
          break
        case 'settings:changed':
          client.setQueryData(queryKeys.settings, event.payload)
          break
        case 'task:update':
          void client.invalidateQueries({ queryKey: queryKeys.tasks })
          if (event.payload.status === 'succeeded' && event.payload.kind === 'pull') {
            void client.invalidateQueries({ queryKey: queryKeys.images })
          }
          if (event.payload.status === 'succeeded' && event.payload.kind === 'compose') {
            void client.invalidateQueries({ queryKey: queryKeys.containers })
            void client.invalidateQueries({ queryKey: queryKeys.compose })
          }
          break
        case 'notification': {
          pushNotification(event.payload)
          toast({
            level: event.payload.level,
            title: event.payload.title,
            message: event.payload.message,
            hint: event.payload.hint
          })
          break
        }
        case 'navigate':
          navigateToPath(event.payload.to)
          break
        case 'command-palette':
          setCommandPalette(event.payload.open)
          break
        default:
          break
      }
    })
  }, [client, navigateToPath, pushNotification, setCommandPalette, toast])

  return null
}

export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          <ThemeSync />
          <EventBridge />
          {children}
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}

export { queryClient }
