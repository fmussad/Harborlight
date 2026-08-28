import { writeFile } from 'node:fs/promises'
import { app, dialog, shell } from 'electron'
import type { AppInfo } from '@shared/schemas/domain'
import { redactDeep } from '@shared/utils/redact'
import { APP_VERSION, BUILD_DATE, GIT_DIRTY, GIT_SHA, UPDATE_CHANNEL } from '../../build-info'
import type { AppContext } from '../../context'
import { HarborlightError } from '../../errors'
import { collectPlatformInfo } from '../../services/osRelease'
import { logger } from '../../services/logger'
import { tasks } from '../../services/tasks'
import { checkForUpdates } from '../../services/updates'
import { detectSockets } from '../../docker/socket'
import { streams } from '../../streams'
import type { CommandHandlers } from '../registry'

/** External links are restricted to documentation and registry hosts. */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'docs.docker.com',
  'hub.docker.com',
  'ghcr.io',
  'ubuntu.com',
  'help.ubuntu.com',
  'aquasecurity.github.io',
  'docs.harborlight.dev'
])

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return false
    return ALLOWED_EXTERNAL_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

/** electron-builder installs the .deb under /opt/<productName>, i.e. /opt/Harborlight. */
const DEB_INSTALL_PREFIXES = ['/opt/Harborlight/', '/opt/harborlight/', '/usr/lib/harborlight/']

function installKind(): AppInfo['installKind'] {
  if (!app.isPackaged) return 'development'
  if (process.env.APPIMAGE) return 'appimage'
  if (DEB_INSTALL_PREFIXES.some((prefix) => process.execPath.startsWith(prefix))) return 'deb'
  return 'unknown'
}

export const systemHandlers = {
  'system.getAppInfo': async (): Promise<AppInfo> => ({
    name: 'Harborlight',
    version: APP_VERSION,
    gitSha: GIT_SHA,
    dirty: GIT_DIRTY,
    channel: UPDATE_CHANNEL,
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node ?? 'unknown',
    packaged: app.isPackaged,
    installKind: installKind(),
    buildDate: BUILD_DATE
  }),

  'system.getPlatformInfo': async () => collectPlatformInfo(),

  'system.openExternal': async (payload) => {
    if (!isAllowedExternalUrl(payload.url)) {
      throw new HarborlightError('not-allowed', 'That link is not on the Harborlight allowlist.', {
        hint: 'Only HTTPS links to documentation and registry hosts can be opened.',
        details: payload.url.slice(0, 200)
      })
    }
    await shell.openExternal(payload.url)
    return { ok: true as const, message: 'Opened in your browser.' }
  },

  'system.checkForUpdates': async (_payload, context: AppContext) =>
    checkForUpdates(context.settings.get().updateChannel),

  /** Diagnostics never contain secrets: everything is passed through redaction. */
  'system.exportDiagnostics': async (_payload, context: AppContext) => {
    const status = context.engines.getStatus()
    const report = {
      generatedAt: new Date().toISOString(),
      app: {
        version: APP_VERSION,
        gitSha: GIT_SHA,
        dirty: GIT_DIRTY,
        channel: UPDATE_CHANNEL,
        buildDate: BUILD_DATE,
        packaged: app.isPackaged,
        installKind: installKind(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      platform: collectPlatformInfo(),
      engine: status,
      sockets: detectSockets(),
      settings: redactDeep(context.settings.get()),
      registries: context.secrets.list().map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        serverAddress: entry.serverAddress,
        hasCredentials: entry.hasCredentials
      })),
      secureStorage: context.secrets.status(),
      streams: streams.counts(),
      tasks: tasks.list(),
      recentLogs: logger.recent(200)
    }

    const window = context.getMainWindow()
    const defaultPath = `harborlight-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    const result = window
      ? await dialog.showSaveDialog(window, { title: 'Export diagnostics', defaultPath })
      : await dialog.showSaveDialog({ title: 'Export diagnostics', defaultPath })

    if (result.canceled || !result.filePath) return { path: null, cancelled: true }
    await writeFile(result.filePath, JSON.stringify(redactDeep(report), null, 2), 'utf8')
    logger.info('diagnostics', `Exported diagnostics to ${result.filePath}`)
    return { path: result.filePath, cancelled: false }
  },

  'system.listTasks': async () => tasks.list(),

  'system.cancelTask': async (payload) => {
    tasks.cancel(payload.id)
    return { ok: true as const, message: 'Cancellation requested.' }
  },

  'system.pickComposeFile': async (_payload, context: AppContext) => {
    const window = context.getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Open a Compose project',
      properties: ['openFile'],
      filters: [
        { name: 'Compose files', extensions: ['yml', 'yaml'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { path: null, cancelled: true }
    return { path: result.filePaths[0] ?? null, cancelled: false }
  },

  'system.quit': async (_payload, context: AppContext) => {
    context.quit()
    return { ok: true as const, message: 'Quitting Harborlight.' }
  },

  'system.minimizeToTray': async (_payload, context: AppContext) => {
    context.hideToTray()
    return { ok: true as const, message: 'Harborlight is still running in the tray.' }
  }
} satisfies Partial<CommandHandlers>
