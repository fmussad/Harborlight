import type { AppContext } from '../../context'
import { HarborlightError } from '../../errors'
import type { CommandHandlers } from '../registry'

/** Volumes and networks: read-only inspection plus guarded removal. */
export const resourceHandlers = {
  'volumes.list': async (_payload, context: AppContext) => context.engines.current().listVolumes(),

  'volumes.inspect': async (payload, context: AppContext) =>
    context.engines.current().inspectVolume(payload.name),

  'volumes.remove': async (payload, context: AppContext) => {
    const engine = context.engines.requireConnected()
    const volumes = await engine.listVolumes()
    const volume = volumes.find((entry) => entry.name === payload.name)
    if (volume?.inUse && !payload.force) {
      throw new HarborlightError(
        'conflict',
        `${payload.name} is still attached to ${volume.containers.map((c) => c.name).join(', ')}.`,
        { hint: 'Remove or stop those containers first. Volume data is deleted permanently.' }
      )
    }
    await engine.removeVolume(payload.name, payload.force)
    return { ok: true as const, message: `Volume ${payload.name} removed.` }
  },

  'networks.list': async (_payload, context: AppContext) =>
    context.engines.current().listNetworks(),

  'networks.inspect': async (payload, context: AppContext) =>
    context.engines.current().inspectNetwork(payload.id),

  'networks.remove': async (payload, context: AppContext) => {
    const engine = context.engines.requireConnected()
    const networks = await engine.listNetworks()
    const network = networks.find((entry) => entry.id === payload.id)
    if (network?.system) {
      throw new HarborlightError('not-allowed', `${network.name} is a predefined Docker network.`, {
        hint: 'bridge, host and none cannot be removed.'
      })
    }
    if (network?.inUse) {
      throw new HarborlightError(
        'conflict',
        `${network.name} still has ${network.containers.length} container(s) attached.`,
        { hint: 'Disconnect or stop those containers first.' }
      )
    }
    await engine.removeNetwork(payload.id)
    return { ok: true as const, message: `Network ${network?.name ?? payload.id} removed.` }
  }
} satisfies Partial<CommandHandlers>
