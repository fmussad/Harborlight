/**
 * Build metadata injected by electron-vite (`define`) so a packaged binary can
 * report the exact commit it was built from. The fallbacks keep unit tests and
 * `tsc` happy when the constants are not defined.
 */
declare const __APP_VERSION__: string | undefined
declare const __GIT_SHA__: string | undefined
declare const __GIT_DIRTY__: boolean | undefined
declare const __BUILD_DATE__: string | undefined
declare const __UPDATE_CHANNEL__: string | undefined

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'
export const GIT_SHA: string = typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'unknown'
export const GIT_DIRTY: boolean = typeof __GIT_DIRTY__ === 'boolean' ? __GIT_DIRTY__ : false
export const BUILD_DATE: string =
  typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : new Date(0).toISOString()
export const UPDATE_CHANNEL: 'stable' | 'beta' =
  typeof __UPDATE_CHANNEL__ === 'string' && __UPDATE_CHANNEL__ === 'beta' ? 'beta' : 'stable'

/** `0.1.0+abc123def456` or `0.1.0+abc123def456-dirty` for local builds. */
export function fullVersionString(): string {
  return `${APP_VERSION}+${GIT_SHA}${GIT_DIRTY ? '-dirty' : ''}`
}
