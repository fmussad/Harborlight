import { join, sep } from 'node:path'

const ARCHIVE = `${sep}app.asar${sep}`
const UNPACKED = `${sep}app.asar.unpacked${sep}`

/**
 * Points a bundled path at the unpacked copy of the asar archive.
 *
 * Electron patches Node's `fs` to read through `app.asar`, but images handed to
 * `nativeImage` and `Tray` are loaded by native code that does not go through
 * that layer. Anything read this way has to be listed under `asarUnpack` in
 * electron-builder.yml and addressed through this function, or it silently
 * comes back empty in a packaged build.
 */
export function unpackedPath(path: string): string {
  return path.includes(ARCHIVE) ? path.replace(ARCHIVE, UNPACKED) : path
}

// out/main/index.js at runtime, so two levels up is the bundle root in both
// development and a packaged build.
const BUNDLE_ROOT = join(__dirname, '..', '..')

export function resourceFile(...segments: string[]): string {
  return unpackedPath(join(BUNDLE_ROOT, 'resources', ...segments))
}

export function iconFile(name: string): string {
  return resourceFile('icons', name)
}
