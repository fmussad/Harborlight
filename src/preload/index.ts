import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from '@shared/contracts/channels'
import type { HarborlightBridge } from '@shared/contracts/api'
import type { CommandInput, CommandName } from '@shared/contracts/commands'
import type { AppEventEnvelope, IpcResponse } from '@shared/contracts/responses'

/**
 * The entire renderer-facing API surface.
 *
 * The renderer gets exactly two capabilities: call an allowlisted command and
 * listen for application events. No Node.js module, no `ipcRenderer`, no
 * filesystem and no Docker socket are exposed.
 */

const bridge: HarborlightBridge = {
  version: '1',

  async invoke<K extends CommandName>(
    command: K,
    payload?: CommandInput<K>
  ): Promise<IpcResponse<K>> {
    try {
      const response = (await ipcRenderer.invoke(IPC_INVOKE_CHANNEL, {
        command,
        payload: payload ?? {}
      })) as IpcResponse<K>

      if (!response || typeof response !== 'object' || !('ok' in response)) {
        return {
          ok: false,
          error: {
            code: 'unknown',
            message: 'The main process returned an unexpected response.',
            hint: null,
            details: null
          }
        }
      }
      return response
    } catch (cause) {
      // Reaching here means the IPC channel itself failed (the gateway is not
      // registered yet, or the main process is shutting down).
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: cause instanceof Error ? cause.message : 'The command could not be delivered.',
          hint: 'Harborlight may still be starting up. Try again in a moment.',
          details: null
        }
      }
    }
  },

  subscribe(listener: (event: AppEventEnvelope) => void): () => void {
    const handler = (_event: IpcRendererEvent, envelope: AppEventEnvelope): void => {
      listener(envelope)
    }
    ipcRenderer.on(IPC_EVENT_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler)
    }
  }
}

contextBridge.exposeInMainWorld('harborlight', bridge)
