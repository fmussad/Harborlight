import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isBootStage,
  IPC_BOOT_STAGE_CHANNEL,
  IPC_LICENSE_REPLY_CHANNEL,
  type HarborlightBootBridge
} from '@shared/contracts/boot'

/**
 * Bridge for the two windows that run before the application starts.
 *
 * Deliberately far narrower than the main bridge in `index.ts`: a listener for
 * startup progress and a single yes/no answer to the licence. There is no
 * invoke gateway here, so neither window can reach a command, the Docker
 * socket or the settings store.
 */
const bridge: HarborlightBootBridge = {
  onStage(listener) {
    const handler = (_event: IpcRendererEvent, stage: unknown): void => {
      if (isBootStage(stage)) listener(stage)
    }
    ipcRenderer.on(IPC_BOOT_STAGE_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(IPC_BOOT_STAGE_CHANNEL, handler)
    }
  },

  respondToLicense(accepted) {
    ipcRenderer.send(IPC_LICENSE_REPLY_CHANNEL, accepted === true)
  }
}

contextBridge.exposeInMainWorld('harborlightBoot', bridge)
