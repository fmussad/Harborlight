import type { ActionAck } from '@shared/contracts/responses'
import type { AppContext } from '../../context'
import type { CommandHandlers } from '../registry'

const ok = (message: string): ActionAck => ({ ok: true, message })

/**
 * Container lifecycle commands.
 *
 * Each handler awaits the Docker response before reporting success: the UI
 * never optimistically shows a state Docker has not confirmed.
 */
export const containerHandlers = {
  'containers.list': async (payload, context: AppContext) => {
    return context.engines.current().listContainers(payload.all)
  },

  'containers.inspect': async (payload, context: AppContext) => {
    return context.engines
      .current()
      .inspectContainer(payload.id, context.settings.get().redactEnvSecrets)
  },

  'containers.stats': async (payload, context: AppContext) => {
    return context.engines.current().containerStats(payload.id)
  },

  'containers.start': async (payload, context: AppContext) => {
    await context.engines.requireConnected().startContainer(payload.id)
    context.refreshTray()
    return ok('Container started.')
  },

  'containers.stop': async (payload, context: AppContext) => {
    await context.engines.requireConnected().stopContainer(payload.id, payload.timeoutSeconds)
    context.refreshTray()
    return ok('Container stopped.')
  },

  'containers.restart': async (payload, context: AppContext) => {
    await context.engines.requireConnected().restartContainer(payload.id, payload.timeoutSeconds)
    context.refreshTray()
    return ok('Container restarted.')
  },

  'containers.pause': async (payload, context: AppContext) => {
    await context.engines.requireConnected().pauseContainer(payload.id)
    return ok('Container paused.')
  },

  'containers.unpause': async (payload, context: AppContext) => {
    await context.engines.requireConnected().unpauseContainer(payload.id)
    return ok('Container resumed.')
  },

  'containers.kill': async (payload, context: AppContext) => {
    await context.engines.requireConnected().killContainer(payload.id, payload.signal)
    context.refreshTray()
    return ok(`Sent ${payload.signal}.`)
  },

  'containers.rename': async (payload, context: AppContext) => {
    await context.engines.requireConnected().renameContainer(payload.id, payload.name)
    return ok(`Renamed to ${payload.name}.`)
  },

  'containers.remove': async (payload, context: AppContext) => {
    await context.engines.requireConnected().removeContainer(payload.id, {
      force: payload.force,
      removeVolumes: payload.removeVolumes
    })
    context.refreshTray()
    return ok(
      payload.removeVolumes
        ? 'Container and its anonymous volumes were removed.'
        : 'Container removed.'
    )
  },

  'containers.run': async (payload, context: AppContext) => {
    const result = await context.engines.requireConnected().runContainer(payload)
    context.refreshTray()
    return result
  }
} satisfies Partial<CommandHandlers>
