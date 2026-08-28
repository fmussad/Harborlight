import { randomUUID } from 'node:crypto'
import type { Task } from '@shared/schemas/domain'
import { HarborlightError } from '../errors'
import { events } from './events'

interface TaskEntry {
  task: Task
  controller: AbortController
}

const MAX_FINISHED_TASKS = 40

/**
 * Tracks long-running background work (image pulls, compose operations,
 * cleanup) so the UI can show progress and offer cancellation.
 */
class TaskRegistry {
  private readonly entries = new Map<string, TaskEntry>()

  start(options: { kind: string; label: string; detail?: string; cancellable?: boolean }): {
    id: string
    signal: AbortSignal
    progress(percent: number | null, detail?: string): void
    succeed(detail?: string): void
    fail(error: unknown): void
  } {
    const id = randomUUID()
    const controller = new AbortController()
    const task: Task = {
      id,
      kind: options.kind,
      label: options.label,
      detail: options.detail ?? '',
      status: 'running',
      progress: null,
      cancellable: options.cancellable ?? false,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null
    }
    this.entries.set(id, { task, controller })
    events.emit('task:update', task)

    const update = (changes: Partial<Task>): void => {
      const entry = this.entries.get(id)
      if (!entry) return
      entry.task = { ...entry.task, ...changes }
      events.emit('task:update', entry.task)
    }

    return {
      id,
      signal: controller.signal,
      progress: (percent, detail) =>
        update({ progress: percent, ...(detail === undefined ? {} : { detail }) }),
      succeed: (detail) =>
        update({
          status: 'succeeded',
          progress: 100,
          finishedAt: new Date().toISOString(),
          ...(detail === undefined ? {} : { detail })
        }),
      fail: (error) =>
        update({
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        })
    }
  }

  cancel(id: string): void {
    const entry = this.entries.get(id)
    if (!entry)
      throw new HarborlightError('not-found', 'That background task is no longer running.')
    if (!entry.task.cancellable) {
      throw new HarborlightError('not-allowed', `"${entry.task.label}" cannot be cancelled.`)
    }
    entry.controller.abort()
    entry.task = { ...entry.task, status: 'cancelled', finishedAt: new Date().toISOString() }
    events.emit('task:update', entry.task)
  }

  list(): Task[] {
    this.trim()
    return [...this.entries.values()].map((entry) => entry.task)
  }

  private trim(): void {
    const finished = [...this.entries.values()]
      .filter((entry) => entry.task.status !== 'running')
      .sort((a, b) => (a.task.finishedAt ?? '').localeCompare(b.task.finishedAt ?? ''))
    while (finished.length > MAX_FINISHED_TASKS) {
      const oldest = finished.shift()
      if (oldest) this.entries.delete(oldest.task.id)
    }
  }
}

export const tasks = new TaskRegistry()
