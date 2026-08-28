import { BrowserWindow } from 'electron'
import { BOOT_STAGES, IPC_BOOT_STAGE_CHANNEL, type BootStage } from '@shared/contracts/boot'
import { iconFile } from '../resources'
import { logger } from '../services/logger'
import { bootPagePreload, bootPageUrl } from './bootPage'

/**
 * Never leave a splash on screen if the main window fails to arrive. Fifteen
 * seconds is far longer than a cold start on a slow disk, so reaching it means
 * something is wrong and the user is better off seeing the tray icon than a
 * frozen picture.
 */
const SAFETY_TIMEOUT_MS = 15_000

/**
 * A splash that flashes past is worse than none: it reads as a glitch. On a
 * warm start the app is ready in a few hundred milliseconds, so the window is
 * held long enough to be legible before handing over.
 */
const MINIMUM_VISIBLE_MS = 1100

export interface SplashWindow {
  setStage(stage: BootStage): void
  /** Resolves once the splash has been seen for long enough and is gone. */
  finish(): Promise<void>
}

/**
 * The window shown while the application boots.
 *
 * Frameless, centred and off the taskbar: it is a progress indicator, not a
 * window the user should have to manage. It carries the boot preload, which
 * can only receive stage updates.
 */
export function createSplashWindow(isDev: boolean): SplashWindow | null {
  let window: BrowserWindow

  try {
    window = new BrowserWindow({
      width: 640,
      height: 360,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      center: true,
      backgroundColor: '#150e18',
      title: 'Harborlight',
      icon: iconFile('512x512.png'),
      webPreferences: {
        preload: bootPagePreload(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: isDev
      }
    })
  } catch (error) {
    logger.warn('splash', 'Could not create the splash window', error)
    return null
  }

  const splash = window
  let shownAt: number | null = null
  let reached = -1
  let latest: BootStage | null = null
  let loaded = false

  splash.once('ready-to-show', () => {
    shownAt = Date.now()
    splash.show()
  })

  // Startup easily outruns the page: without this, the first stages are sent
  // before the splash has a listener and the bar sits at its initial value.
  splash.webContents.once('did-finish-load', () => {
    loaded = true
    if (latest) splash.webContents.send(IPC_BOOT_STAGE_CHANNEL, latest)
  })

  void splash.loadURL(bootPageUrl('splash'))

  const timer = setTimeout(() => {
    if (!splash.isDestroyed()) {
      logger.warn('splash', 'Main window did not arrive in time; closing the splash')
      splash.destroy()
    }
  }, SAFETY_TIMEOUT_MS)
  timer.unref?.()

  return {
    // Startup work does not finish in the order it was started: the renderer
    // can be ready before the engine answers. Only ever move the bar forward,
    // so it never appears to lose progress.
    setStage(stage) {
      const index = BOOT_STAGES.indexOf(stage)
      if (splash.isDestroyed() || index <= reached) return
      reached = index
      latest = stage
      if (loaded) splash.webContents.send(IPC_BOOT_STAGE_CHANNEL, stage)
    },

    async finish() {
      clearTimeout(timer)
      const elapsed = Date.now() - (shownAt ?? Date.now())
      const remaining = MINIMUM_VISIBLE_MS - elapsed
      if (remaining > 0) await new Promise((done) => setTimeout(done, remaining))
      if (!splash.isDestroyed()) splash.destroy()
    }
  }
}
