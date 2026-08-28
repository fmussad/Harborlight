import type { CommandInput, CommandName } from './commands'
import type { AppEventEnvelope, IpcResponse } from './responses'

/**
 * The complete surface exposed to the renderer through `contextBridge`.
 * Nothing else from Node.js or Electron is reachable from the web layer.
 *
 * `invoke` resolves with the full result envelope instead of rejecting on a
 * failure: Electron copies only `message` and `stack` when an Error crosses the
 * bridge, so a rejection would drop the error code, hint and details that the
 * UI needs. Throwing is the renderer's job (see `lib/bridge.ts`).
 */
export interface HarborlightBridge {
  readonly version: string
  invoke<K extends CommandName>(command: K, payload?: CommandInput<K>): Promise<IpcResponse<K>>
  subscribe(listener: (event: AppEventEnvelope) => void): () => void
}

declare global {
  interface Window {
    harborlight?: HarborlightBridge
  }
}
