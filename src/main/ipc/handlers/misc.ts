import { app } from 'electron'
import type { AppContext } from '../../context'
import { detectSockets, normalizeSocketPath } from '../../docker/socket'
import { analyzeCleanup, runCleanup } from '../../services/cleanup'
import { setAutostart } from '../../services/autostart'
import { events } from '../../services/events'
import { logger } from '../../services/logger'
import type { CommandHandlers } from '../registry'

/** Settings, engine connection, cleanup and registry commands. */
export const settingsHandlers = {
  'settings.get': async (_payload, context: AppContext) => context.settings.get(),

  'settings.update': async (payload, context: AppContext) => {
    if (payload.dockerSocket) normalizeSocketPath(payload.dockerSocket)
    const previous = context.settings.get()
    const updated = context.settings.update(payload)

    if (
      payload.startAtLogin !== undefined ||
      (payload.startMinimized !== undefined && updated.startAtLogin)
    ) {
      setAutostart(updated.startAtLogin, {
        execPath: autostartExecPath(),
        startMinimized: updated.startMinimized
      })
    }

    if (
      updated.dockerSocket !== previous.dockerSocket ||
      updated.engineMode !== previous.engineMode ||
      updated.pollIntervalMs !== previous.pollIntervalMs
    ) {
      await context.engines.applySettings(updated)
    }

    events.emit('settings:changed', updated)
    context.refreshTray()
    return updated
  },

  'settings.reset': async (_payload, context: AppContext) => {
    const updated = context.settings.reset()
    await context.engines.applySettings(updated)
    events.emit('settings:changed', updated)
    context.refreshTray()
    return updated
  },

  'settings.setTheme': async (payload, context: AppContext) => {
    const updated = context.settings.update({ theme: payload.theme })
    events.emit('settings:changed', updated)
    return updated
  }
} satisfies Partial<CommandHandlers>

export const engineHandlers = {
  'engine.getStatus': async (_payload, context: AppContext) =>
    context.engines.getStatus() ?? (await context.engines.refreshStatus()),

  'engine.reconnect': async (_payload, context: AppContext) => {
    logger.info('engine', 'Manual reconnect requested')
    return context.engines.reconnect()
  },

  'engine.listSockets': async () => detectSockets(),

  'engine.getDiskUsage': async (_payload, context: AppContext) => context.engines.getDiskUsage(),

  'engine.getUsageHistory': async (payload, context: AppContext) =>
    context.engines.getUsageHistory(payload.windowHours)
} satisfies Partial<CommandHandlers>

export const cleanupHandlers = {
  'cleanup.analyze': async (_payload, context: AppContext) =>
    analyzeCleanup(context.engines.requireConnected()),

  'cleanup.run': async (payload, context: AppContext) => {
    const engine = context.engines.requireConnected()
    logger.info(
      'cleanup',
      `Running cleanup for ${payload.categories.join(', ')} (dryRun=${payload.dryRun})`
    )
    const result = await runCleanup(engine, payload.categories, payload.dryRun)
    if (!payload.dryRun) {
      // The next analysis must see post-cleanup sizes, not the cached ones.
      await context.engines.getDiskUsage(true).catch(() => undefined)
    }
    return result
  }
} satisfies Partial<CommandHandlers>

export const registryHandlers = {
  'registry.status': async (_payload, context: AppContext) => context.secrets.status(),
  'registry.list': async (_payload, context: AppContext) => context.secrets.list(),
  'registry.add': async (payload, context: AppContext) => context.secrets.add(payload),
  'registry.remove': async (payload, context: AppContext) => {
    context.secrets.remove(payload.id)
    return { ok: true as const, message: 'Registry removed.' }
  },
  'registry.login': async (payload, context: AppContext) =>
    context.secrets.login(payload.id, payload.username, payload.secret),
  'registry.logout': async (payload, context: AppContext) => context.secrets.logout(payload.id)
} satisfies Partial<CommandHandlers>

/**
 * Autostart must point at the installed launcher, not at the Electron binary
 * inside node_modules, so a development session never registers itself.
 */
function autostartExecPath(): string {
  if (app.isPackaged) return process.env.APPIMAGE ?? process.execPath
  return '/usr/local/bin/harborlight'
}
