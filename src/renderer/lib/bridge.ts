import type { CommandInput, CommandName } from '@shared/contracts/commands'
import type { AppEventEnvelope, CommandResult } from '@shared/contracts/responses'
import { createMockTransport } from './mockTransport'

export interface Transport {
  readonly kind: 'electron' | 'browser-mock'
  invoke<K extends CommandName>(command: K, payload?: CommandInput<K>): Promise<CommandResult<K>>
  subscribe(listener: (event: AppEventEnvelope) => void): () => void
}

/** Error shape the UI renders: message plus an actionable hint. */
export class UiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint: string | null = null,
    readonly details: string | null = null
  ) {
    super(message)
    this.name = 'HarborlightError'
  }
}

export function toUiError(error: unknown): UiError {
  if (error instanceof UiError) return error
  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: unknown
      message?: unknown
      hint?: unknown
      details?: unknown
    }
    if (typeof candidate.message === 'string') {
      return new UiError(
        typeof candidate.code === 'string' ? candidate.code : 'unknown',
        candidate.message,
        typeof candidate.hint === 'string' ? candidate.hint : null,
        typeof candidate.details === 'string' ? candidate.details : null
      )
    }
  }
  return new UiError('unknown', String(error))
}

let transport: Transport | null = null

/**
 * Resolves the transport once.
 *
 * Inside Electron this is the preload bridge. In a plain browser (`npm run
 * dev:web`) it falls back to the in-memory mock so the UI stays portable and
 * designable without Docker.
 */
export function getTransport(): Transport {
  if (transport) return transport

  const bridge = typeof window !== 'undefined' ? window.harborlight : undefined
  if (bridge) {
    transport = {
      kind: 'electron',
      // The bridge resolves with an envelope because Electron strips custom
      // properties from Errors; the throw happens here, with the code and hint
      // intact.
      invoke: async (command, payload) => {
        const response = await bridge.invoke(command, payload)
        if (!response.ok) {
          throw new UiError(
            response.error.code,
            response.error.message,
            response.error.hint,
            response.error.details
          )
        }
        return response.data
      },
      subscribe: (listener) => bridge.subscribe(listener)
    }
  } else {
    transport = createMockTransport()
  }
  return transport
}

/** Test seam: lets the renderer suite inject a fake transport. */
export function setTransport(next: Transport | null): void {
  transport = next
}

export async function invoke<K extends CommandName>(
  command: K,
  payload?: CommandInput<K>
): Promise<CommandResult<K>> {
  try {
    return await getTransport().invoke(command, payload)
  } catch (error) {
    throw toUiError(error)
  }
}

export function subscribe(listener: (event: AppEventEnvelope) => void): () => void {
  return getTransport().subscribe(listener)
}

export function isMockTransport(): boolean {
  return getTransport().kind === 'browser-mock'
}
