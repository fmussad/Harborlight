import { app, dialog, nativeTheme, type BrowserWindow } from 'electron'
import { APP_VERSION, BUILD_DATE, fullVersionString, GIT_SHA, UPDATE_CHANNEL } from './build-info'
import type { AppContext } from './context'
import { collectPlatformInfo } from './services/osRelease'
import { EngineManager } from './services/engineManager'
import { events } from './services/events'
import { logger } from './services/logger'
import { SecretStore } from './services/secrets'
import { SettingsStore } from './services/settings'
import { checkForUpdates } from './services/updates'
import { handlers } from './ipc/handlers'
import { disposeIpcGateway, registerIpcGateway } from './ipc/registry'
import { streams } from './streams'
import { createTray, destroyTray, refreshTray } from './tray/tray'
import { applySecurityPolicies, createMainWindow } from './windows/mainWindow'

const argv = process.argv.slice(1)
const hasFlag = (flag: string): boolean => argv.includes(flag)

// `harborlight --version` must answer without starting a GUI session.
if (hasFlag('--version') || hasFlag('-v')) {
  process.stdout.write(
    `Harborlight ${APP_VERSION}\ncommit ${GIT_SHA}\nchannel ${UPDATE_CHANNEL}\nbuilt ${BUILD_DATE}\nelectron ${process.versions.electron}\n`
  )
  app.exit(0)
}

const startHidden = hasFlag('--hidden') || hasFlag('--start-minimized')
const forceUnsupported =
  hasFlag('--force-unsupported') || process.env.HARBORLIGHT_FORCE_UNSUPPORTED === '1'
const allowRoot = hasFlag('--allow-root') || process.env.HARBORLIGHT_ALLOW_ROOT === '1'
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let context: AppContext | null = null
let quitting = false

if (!app.requestSingleInstanceLock()) {
  // A second launch focuses the running window instead of starting a new app.
  app.exit(0)
} else {
  bootstrap()
}

function bootstrap(): void {
  app.setAppUserModelId('dev.harborlight.app')
  app.setName('Harborlight')

  app.on('second-instance', () => {
    showWindow()
  })

  void app.whenReady().then(onReady)

  app.on('window-all-closed', () => {
    // The tray keeps Harborlight alive; without one, closing quits.
    if (!context?.settings.get().closeToTray) app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('will-quit', () => {
    streams.stopAll()
    destroyTray()
    disposeIpcGateway()
    void context?.engines.dispose()
  })
}

async function onReady(): Promise<void> {
  const userDataPath = app.getPath('userData')
  logger.configure(app.getPath('logs'))
  logger.info('app', `Harborlight ${fullVersionString()} starting (packaged=${app.isPackaged})`)

  if (!guardRoot()) return
  if (!(await guardPlatform())) return

  const settings = new SettingsStore(userDataPath)
  const secrets = new SecretStore(userDataPath)
  const engines = new EngineManager(settings.get(), userDataPath)

  context = {
    settings,
    secrets,
    engines,
    getMainWindow: () => mainWindow,
    quit: () => {
      quitting = true
      app.quit()
    },
    hideToTray: () => mainWindow?.hide(),
    refreshTray: () => {
      if (context) refreshTray(context, trayCallbacks)
    }
  }

  applySecurityPolicies(isDev)
  registerIpcGateway(handlers, context)

  nativeTheme.themeSource = settings.get().theme

  settings.onChange((updated) => {
    nativeTheme.themeSource = updated.theme
    if (context) refreshTray(context, trayCallbacks)
  })

  mainWindow = createMainWindow({
    isDev,
    startHidden: startHidden || settings.get().startMinimized,
    onCloseRequested: () => !quitting && context!.settings.get().closeToTray
  })

  createTray(context, trayCallbacks)

  await engines.refreshStatus().catch((error) => {
    logger.warn('engine', 'Initial status check failed', error)
  })
  engines.startPolling()
  refreshTray(context, trayCallbacks)

  logger.info('app', `Ready. Engine socket: ${engines.current().socketPath}`)
}

const trayCallbacks = {
  show: () => showWindow(),
  hide: () => mainWindow?.hide(),
  quit: () => {
    quitting = true
    app.quit()
  },
  navigate: (to: string) => {
    showWindow()
    events.emit('navigate', { to })
  },
  checkForUpdates: () => {
    void checkForUpdates(context?.settings.get().updateChannel ?? 'stable').then((info) => {
      events.emit('notification', {
        id: `update-${Date.now()}`,
        level: info.updateAvailable ? 'info' : 'success',
        title: info.updateAvailable ? 'Update available' : 'Harborlight is up to date',
        message: info.message,
        hint: null,
        createdAt: new Date().toISOString()
      })
      showWindow()
    })
  },
  showAbout: () => {
    showWindow()
    events.emit('navigate', { to: '/settings?section=about' })
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow({
      isDev,
      startHidden: false,
      onCloseRequested: () => !quitting && Boolean(context?.settings.get().closeToTray)
    })
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Refuses to run the desktop app as root unless explicitly overridden. */
function guardRoot(): boolean {
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1
  if (uid !== 0) return true
  if (allowRoot) {
    logger.warn(
      'app',
      'Running as root because --allow-root was passed. This is not supported for daily use.'
    )
    return true
  }
  dialog.showErrorBox(
    'Harborlight cannot run as root',
    'Running a desktop application as root is unsafe and can leave root-owned files in your home directory.\n\n' +
      'Start Harborlight as your normal user. If your user cannot reach the Docker socket, add it to the "docker" group ' +
      '(this grants root-equivalent access) or use a rootless Docker socket.\n\n' +
      'To override for a controlled environment, start with --allow-root.'
  )
  app.exit(1)
  return false
}

async function guardPlatform(): Promise<boolean> {
  const platform = collectPlatformInfo()
  if (platform.supported || forceUnsupported) {
    if (!platform.supported) {
      logger.warn(
        'app',
        `Running on an unsupported platform (${platform.distroName}) because of --force-unsupported`
      )
    }
    return true
  }

  const response = await dialog.showMessageBox({
    type: 'warning',
    title: 'Unsupported system',
    message: 'Harborlight targets Ubuntu 22.04, 24.04 and 26.04 LTS.',
    detail: `Detected: ${platform.distroName} (${platform.versionId}) on ${platform.architecture}.\n\nYou can continue at your own risk, or quit and use a supported release. Passing --force-unsupported skips this dialog.`,
    buttons: ['Quit', 'Continue anyway'],
    defaultId: 0,
    cancelId: 0
  })

  if (response.response === 0) {
    app.exit(1)
    return false
  }
  logger.warn('app', `Continuing on unsupported platform ${platform.distroName}`)
  return true
}
