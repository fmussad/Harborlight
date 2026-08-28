/**
 * Contract between the main process and the two windows that exist before the
 * application itself does: the first-run licence gate and the splash screen.
 *
 * These windows are deliberately kept outside the command gateway in
 * `commands.ts`. The licence window can say exactly one thing — accepted or
 * declined — and the splash window can only listen. Neither can reach Docker,
 * the filesystem or the settings store.
 *
 * This module is also why the boot channels do not live in `channels.ts`. A
 * sandboxed preload gets a `require` that resolves Electron and Node builtins
 * only, so if the two preload entry points shared a module, the bundler would
 * hoist it into a chunk that neither of them could load. Keeping their import
 * graphs disjoint keeps both bundles standalone.
 */

/** Main -> splash: the stage the application has reached. */
export const IPC_BOOT_STAGE_CHANNEL = 'harborlight:boot-stage' as const

/** Licence window -> main: a single accepted/declined boolean. */
export const IPC_LICENSE_REPLY_CHANNEL = 'harborlight:license-reply' as const

/** Ordered startup milestones the splash reports while the app boots. */
export const BOOT_STAGES = ['starting', 'connecting', 'interface', 'ready'] as const

export type BootStage = (typeof BOOT_STAGES)[number]

export function isBootStage(value: unknown): value is BootStage {
  return typeof value === 'string' && (BOOT_STAGES as readonly string[]).includes(value)
}

/** How far along the bar sits for each stage, as a fraction. */
export function bootStageProgress(stage: BootStage): number {
  return (BOOT_STAGES.indexOf(stage) + 1) / BOOT_STAGES.length
}

/**
 * Everything the licence and splash windows can do. A listener for startup
 * progress and a single yes/no answer — no invoke gateway, no Docker socket,
 * no settings store.
 */
export interface HarborlightBootBridge {
  onStage(listener: (stage: BootStage) => void): () => void
  respondToLicense(accepted: boolean): void
}

declare global {
  interface Window {
    harborlightBoot?: HarborlightBootBridge
  }
}
