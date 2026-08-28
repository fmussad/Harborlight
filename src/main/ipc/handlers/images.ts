import type { AppContext } from '../../context'
import { HarborlightError } from '../../errors'
import { events } from '../../services/events'
import { tasks } from '../../services/tasks'
import { scanImage, trivyAvailability } from '../../services/trivy'
import type { CommandHandlers } from '../registry'

export const imageHandlers = {
  'images.list': async (_payload, context: AppContext) => context.engines.current().listImages(),

  'images.inspect': async (payload, context: AppContext) =>
    context.engines.current().inspectImage(payload.id),

  'images.history': async (payload, context: AppContext) =>
    context.engines.current().imageHistory(payload.id),

  /**
   * Pulls run as a cancellable background task: the command returns the task id
   * immediately and progress arrives through `task:update` events.
   */
  'images.pull': async (payload, context: AppContext) => {
    const engine = context.engines.requireConnected()
    const auth = payload.registryId ? context.secrets.authFor(payload.registryId) : null
    const task = tasks.start({
      kind: 'pull',
      label: `Pulling ${payload.reference}`,
      detail: 'Contacting the registry…',
      cancellable: true
    })

    void engine
      .pullImage(
        payload.reference,
        auth,
        (progress) => {
          task.progress(
            progress.percent,
            progress.layerId ? `${progress.status} ${progress.layerId}` : progress.status
          )
        },
        task.signal
      )
      .then(() => {
        task.succeed(`${payload.reference} is available locally.`)
        events.emit('notification', {
          id: task.id,
          level: 'success',
          title: 'Image pulled',
          message: `${payload.reference} is now available locally.`,
          hint: null,
          createdAt: new Date().toISOString()
        })
      })
      .catch((error: unknown) => {
        task.fail(error)
        events.emit('notification', {
          id: task.id,
          level: 'error',
          title: 'Pull failed',
          message: error instanceof Error ? error.message : String(error),
          hint: error instanceof HarborlightError ? error.hint : null,
          createdAt: new Date().toISOString()
        })
      })

    return { taskId: task.id }
  },

  'images.remove': async (payload, context: AppContext) => {
    await context.engines.requireConnected().removeImage(payload.id, {
      force: payload.force,
      pruneChildren: payload.pruneChildren
    })
    return { ok: true as const, message: 'Image removed.' }
  },

  'images.tag': async (payload, context: AppContext) => {
    await context.engines.requireConnected().tagImage(payload.id, payload.reference)
    return { ok: true as const, message: `Tagged as ${payload.reference}.` }
  },

  'images.scan': async (payload) => scanImage(payload.reference),

  'images.scanAvailability': async () => trivyAvailability()
} satisfies Partial<CommandHandlers>
