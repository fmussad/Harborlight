/**
 * The complete set of Electron IPC channels used by Harborlight.
 *
 * Everything the renderer can trigger goes through a single invoke gateway that
 * checks the requested command against an explicit allowlist and validates its
 * payload with Zod. Main -> renderer traffic is one-way on the event channel.
 */
export const IPC_INVOKE_CHANNEL = 'harborlight:invoke' as const
export const IPC_EVENT_CHANNEL = 'harborlight:event' as const

export const IPC_CHANNELS = [IPC_INVOKE_CHANNEL, IPC_EVENT_CHANNEL] as const
export type IpcChannel = (typeof IPC_CHANNELS)[number]

/**
 * The two windows that run before the application have their own channels, in
 * `contracts/boot.ts`. They are deliberately kept out of this module: a
 * sandboxed preload cannot load a shared chunk, so the boot preload and the
 * renderer preload must not import any module in common.
 */
