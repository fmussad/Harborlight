import {
  app,
  Menu,
  nativeImage,
  nativeTheme,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage
} from 'electron'
import type { EngineStatus } from '@shared/schemas/domain'
import { APP_VERSION, GIT_SHA } from '../build-info'
import type { AppContext } from '../context'
import { iconFile } from '../resources'
import { events } from '../services/events'
import { setAutostart } from '../services/autostart'
import { logger } from '../services/logger'
import { resolveTrayVariant, trayIconFileName, type TrayIconVariant } from './variant'

let tray: Tray | null = null
let currentVariant: TrayIconVariant | null = null

function currentTrayVariant(context: AppContext): TrayIconVariant {
  return resolveTrayVariant(context.settings.get().trayIcon, {
    currentDesktop: process.env.XDG_CURRENT_DESKTOP,
    prefersDarkChrome: nativeTheme.shouldUseDarkColors
  })
}

/** `createFromPath` also picks up the `@2x` file next to it for HiDPI panels. */
function loadTrayImage(variant: TrayIconVariant): NativeImage | null {
  const path = iconFile(trayIconFileName(variant))
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) {
    logger.warn('tray', `Tray icon could not be read from ${path}`)
    return null
  }
  return image
}

/**
 * Applies the glyph the current settings ask for.
 *
 * Called on every tray refresh rather than only from the `nativeTheme` listener,
 * so a change made in Settings reaches the panel without waiting for the
 * desktop to report a theme change of its own.
 */
function applyTrayIcon(context: AppContext): void {
  if (!tray) return
  const variant = currentTrayVariant(context)
  if (variant === currentVariant) return

  const image = loadTrayImage(variant)
  if (!image) return

  tray.setImage(image)
  currentVariant = variant
  logger.debug('tray', `Tray icon switched to the ${variant} glyph`)
}

function statusLabel(status: EngineStatus | null): string {
  if (!status) return 'Docker Engine: checking…'
  if (!status.connected) return 'Docker Engine: unavailable'
  return `Docker Engine: running${status.version ? ` (${status.version})` : ''}`
}

export interface TrayCallbacks {
  show(): void
  hide(): void
  quit(): void
  navigate(to: string): void
  checkForUpdates(): void
  showAbout(): void
}

/**
 * Ubuntu system tray integration.
 *
 * GNOME has no StatusNotifier host without the AppIndicator extension; when the
 * icon cannot be created the app still works and TROUBLESHOOTING.md explains why.
 */
export function createTray(context: AppContext, callbacks: TrayCallbacks): Tray | null {
  if (tray) return tray
  try {
    const variant = currentTrayVariant(context)
    const image = loadTrayImage(variant)
    tray = new Tray(image ?? nativeImage.createEmpty())
    currentVariant = image ? variant : null
    tray.setToolTip('Harborlight')
    tray.on('click', () => callbacks.show())
    refreshTray(context, callbacks)
    nativeTheme.on('updated', () => applyTrayIcon(context))
    logger.info('tray', `System tray icon created with the ${variant} glyph`)
    return tray
  } catch (error) {
    logger.warn('tray', 'Could not create the tray icon', error)
    return null
  }
}

export function refreshTray(context: AppContext, callbacks: TrayCallbacks): void {
  if (!tray) return
  applyTrayIcon(context)
  const settings = context.settings.get()
  const status = context.engines.getStatus()

  const template: MenuItemConstructorOptions[] = [
    { label: `Harborlight ${APP_VERSION}`, enabled: false },
    { label: statusLabel(status), enabled: false },
    { type: 'separator' },
    { label: 'Open Harborlight', click: () => callbacks.show() },
    { label: 'Hide Harborlight', click: () => callbacks.hide() },
    { type: 'separator' },
    { label: 'Open Containers', click: () => callbacks.navigate('/containers') },
    { label: 'Open Logs', click: () => callbacks.navigate('/containers?panel=logs') },
    { type: 'separator' },
    { label: 'Check for Updates…', click: () => callbacks.checkForUpdates() },
    {
      label: 'Start at Login',
      type: 'checkbox',
      checked: settings.startAtLogin,
      click: (item) => {
        const updated = context.settings.update({ startAtLogin: item.checked })
        setAutostart(updated.startAtLogin, {
          execPath: app.isPackaged
            ? (process.env.APPIMAGE ?? process.execPath)
            : '/usr/local/bin/harborlight',
          startMinimized: updated.startMinimized
        })
        events.emit('settings:changed', updated)
        refreshTray(context, callbacks)
      }
    },
    {
      label: 'Launch Minimized',
      type: 'checkbox',
      checked: settings.startMinimized,
      click: (item) => {
        const updated = context.settings.update({ startMinimized: item.checked })
        if (updated.startAtLogin) {
          setAutostart(true, {
            execPath: app.isPackaged
              ? (process.env.APPIMAGE ?? process.execPath)
              : '/usr/local/bin/harborlight',
            startMinimized: updated.startMinimized
          })
        }
        events.emit('settings:changed', updated)
        refreshTray(context, callbacks)
      }
    },
    { type: 'separator' },
    { label: `About Harborlight (${GIT_SHA})`, click: () => callbacks.showAbout() },
    { label: 'Quit Harborlight', click: () => callbacks.quit() }
  ]

  tray.setContextMenu(Menu.buildFromTemplate(template))
  tray.setToolTip(`Harborlight — ${statusLabel(status)}`)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  currentVariant = null
}

export function hasTray(): boolean {
  return tray !== null
}
