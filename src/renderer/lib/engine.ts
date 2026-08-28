import type { EngineStatus } from '@shared/schemas/domain'

export type EngineDisplayState = 'connecting' | 'running' | 'permission-denied' | 'unavailable'

export interface EngineDisplay {
  state: EngineDisplayState
  label: string
  /** Tailwind background class for the status dot. */
  dotClass: string
}

/**
 * Collapses the engine status into what the chrome shows.
 *
 * A permission problem is called out separately because the fix (adding the
 * user to the `docker` group) is completely different from "the daemon is down".
 */
export function describeEngine(status: EngineStatus | undefined): EngineDisplay {
  if (!status) {
    return { state: 'connecting', label: 'Connecting…', dotClass: 'bg-warning animate-pulse' }
  }
  if (status.connected) {
    return { state: 'running', label: 'Engine running', dotClass: 'bg-success' }
  }
  if (status.error && /permission denied|EACCES/i.test(status.error)) {
    return { state: 'permission-denied', label: 'Permission denied', dotClass: 'bg-danger' }
  }
  return { state: 'unavailable', label: 'Engine unavailable', dotClass: 'bg-danger' }
}
