import { join } from 'node:path'
import {
  app,
  Menu,
  nativeImage,
  nativeTheme,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import type { EngineStatus } from '@shared/schemas/domain'
import { APP_VERSION, GIT_SHA } from '../build-info'
import type { AppContext } from '../context'
import { events } from '../services/events'
import { setAutostart } from '../services/autostart'
import { logger } from '../services/logger'

let tray: Tray | null = null

function iconPath(): string {
  const variant = nativeTheme.shouldUseDarkColors ? 'tray-light.png' : 'tray-dark.png'
  return join(__dirname, '../../resources/icons', variant)
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
    const image = nativeImage.createFromPath(iconPath())
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
    tray.setToolTip('Harborlight')
    tray.on('click', () => callbacks.show())
    refreshTray(context, callbacks)
    nativeTheme.on('updated', () => {
      const updated = nativeImage.createFromPath(iconPath())
      if (!updated.isEmpty()) tray?.setImage(updated)
    })
    logger.info('tray', 'System tray icon created')
    return tray
  } catch (error) {
    logger.warn('tray', 'Could not create the tray icon', error)
    return null
  }
}

export function refreshTray(context: AppContext, callbacks: TrayCallbacks): void {
  if (!tray) return
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
}

export function hasTray(): boolean {
  return tray !== null
}
