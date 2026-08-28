import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { IPC_LICENSE_REPLY_CHANNEL } from '@shared/contracts/boot'
import { iconFile } from '../resources'
import { logger } from '../services/logger'
import { bootPagePreload, bootPageUrl } from './bootPage'

/**
 * The first-run licence gate.
 *
 * Resolves `true` only when the user explicitly accepts. Closing the window,
 * pressing Escape or failing to create it at all counts as a decline, because
 * the alternative — starting anyway — would make the gate decorative.
 */
export function requestLicenseAcceptance(isDev: boolean): Promise<boolean> {
  let window: BrowserWindow

  try {
    window = new BrowserWindow({
      width: 660,
      height: 640,
      minWidth: 520,
      minHeight: 480,
      show: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: '#faf9f9',
      title: 'Harborlight licence',
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
    logger.error('license', 'Could not show the licence agreement', error)
    return Promise.resolve(false)
  }

  const gate = window

  return new Promise<boolean>((resolve) => {
    let settled = false

    const finish = (accepted: boolean): void => {
      if (settled) return
      settled = true
      ipcMain.removeListener(IPC_LICENSE_REPLY_CHANNEL, onReply)
      if (!gate.isDestroyed()) gate.destroy()
      logger.info('license', accepted ? 'Licence accepted' : 'Licence declined')
      resolve(accepted)
    }

    function onReply(event: IpcMainEvent, accepted: unknown): void {
      // Only the gate itself may answer for the gate.
      if (event.sender !== gate.webContents) return
      finish(accepted === true)
    }

    ipcMain.on(IPC_LICENSE_REPLY_CHANNEL, onReply)
    gate.on('closed', () => finish(false))
    gate.once('ready-to-show', () => gate.show())
    void gate.loadURL(bootPageUrl('license'))
  })
}
