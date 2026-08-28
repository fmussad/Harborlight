import type { ExecHandle, StreamHandle } from './docker/engine'
import { HarborlightError } from './errors'
import { logger } from './services/logger'

/**
 * Registry of live log streams and exec sessions.
 *
 * Everything registered here is torn down when the window closes or the app
 * quits, so a forgotten stream can never keep the Docker socket busy.
 */
class StreamRegistry {
  private readonly logs = new Map<string, StreamHandle>()
  private readonly execs = new Map<string, ExecHandle>()

  addLog(handle: StreamHandle): string {
    this.logs.set(handle.id, handle)
    return handle.id
  }

  stopLog(id: string): void {
    const handle = this.logs.get(id)
    if (!handle) return
    handle.stop()
    this.logs.delete(id)
  }

  addExec(handle: ExecHandle): string {
    this.execs.set(handle.id, handle)
    return handle.id
  }

  requireExec(id: string): ExecHandle {
    const handle = this.execs.get(id)
    if (!handle) throw new HarborlightError('not-found', 'That terminal session is no longer open.')
    return handle
  }

  stopExec(id: string): void {
    const handle = this.execs.get(id)
    if (!handle) return
    handle.stop()
    this.execs.delete(id)
  }

  stopAll(): void {
    for (const handle of this.logs.values()) {
      try {
        handle.stop()
      } catch (error) {
        logger.debug('streams', 'Failed to stop a log stream', error)
      }
    }
    for (const handle of this.execs.values()) {
      try {
        handle.stop()
      } catch (error) {
        logger.debug('streams', 'Failed to stop an exec session', error)
      }
    }
    this.logs.clear()
    this.execs.clear()
  }

  counts(): { logs: number; execs: number } {
    return { logs: this.logs.size, execs: this.execs.size }
  }
}

export const streams = new StreamRegistry()
