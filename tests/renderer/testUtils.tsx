import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { CommandName } from '@shared/contracts/commands'
import type { AppEventEnvelope } from '@shared/contracts/responses'
import type { EngineStatus, Settings } from '@shared/schemas/domain'
import { setTransport, type Transport } from '@/lib/bridge'
import { ToastProvider } from '@/providers/ToastProvider'
import { useUiStore } from '@/stores/ui'

/** The shipped defaults, so a test only states what it actually changes. */
export const TEST_SETTINGS: Settings = {
  theme: 'system',
  dockerSocket: '/var/run/docker.sock',
  useCustomSocket: false,
  engineMode: 'docker',
  pollIntervalMs: 5000,
  logTailLines: 500,
  logTimestamps: true,
  logWordWrap: false,
  defaultShell: 'auto',
  closeToTray: true,
  startAtLogin: false,
  startMinimized: false,
  desktopNotifications: true,
  updateChannel: 'stable',
  confirmDestructive: true,
  redactEnvSecrets: true
}

export const TEST_ENGINE_STATUS: EngineStatus = {
  connected: true,
  adapter: 'docker',
  socketPath: '/var/run/docker.sock',
  rootless: false,
  version: '27.1.1',
  apiVersion: '1.46',
  os: 'Ubuntu 24.04',
  kernelVersion: '6.8.0',
  architecture: 'x86_64',
  cpus: 8,
  memoryTotal: 16 * 1024 ** 3,
  containersRunning: 8,
  containersStopped: 1,
  containersPaused: 0,
  images: 9,
  error: null,
  errorHint: null,
  checkedAt: '2026-05-16T18:32:00.000Z'
}

type Handlers = Partial<Record<CommandName, (payload: unknown) => unknown>>

export interface FakeTransport extends Transport {
  calls: { command: CommandName; payload: unknown }[]
  emit(event: AppEventEnvelope): void
}

/**
 * Deterministic transport for component tests: every command resolves
 * synchronously from the provided handlers, and unhandled commands fail loudly
 * so a test never passes because a call silently returned undefined.
 */
export function installFakeTransport(handlers: Handlers): FakeTransport {
  const listeners = new Set<(event: AppEventEnvelope) => void>()
  const calls: { command: CommandName; payload: unknown }[] = []

  const transport: FakeTransport = {
    kind: 'browser-mock',
    calls,
    emit(event) {
      for (const listener of [...listeners]) listener(event)
    },
    async invoke(command, payload) {
      calls.push({ command, payload })
      const handler = handlers[command]
      if (!handler) throw new Error(`No fake handler for "${command}"`)
      return (await handler(payload)) as never
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }

  setTransport(transport)
  return transport
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false }
    }
  })
}

export function renderWithProviders(ui: ReactNode) {
  const client = createQueryClient()
  const user = userEvent.setup()
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
  return { ...render(<>{ui}</>, { wrapper }), user }
}

const INITIAL_UI_STATE = useUiStore.getState()

export function resetUiStore(): void {
  useUiStore.setState(INITIAL_UI_STATE, true)
}

/** Silences the React Query error logger for tests that assert failure paths. */
export function silenceConsoleError(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
}
