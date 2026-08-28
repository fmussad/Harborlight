import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { iconFile, resourceFile, unpackedPath } from '@main/resources'

/**
 * Images handed to `nativeImage` are read by native code that does not know
 * about asar archives, so every bundled image path has to be rewritten to the
 * unpacked copy or it comes back empty in a packaged build — silently, which is
 * why this is worth a test.
 */

describe('unpackedPath', () => {
  it('redirects a path inside the archive to the unpacked copy', () => {
    expect(unpackedPath('/opt/Harborlight/resources/app.asar/resources/icons/tray-light.png')).toBe(
      '/opt/Harborlight/resources/app.asar.unpacked/resources/icons/tray-light.png'
    )
  })

  it('leaves a development path untouched', () => {
    expect(unpackedPath('/home/dev/Harborlight/resources/icons/tray-light.png')).toBe(
      '/home/dev/Harborlight/resources/icons/tray-light.png'
    )
  })

  it('does not rewrite a path that is already unpacked', () => {
    const already = '/opt/Harborlight/resources/app.asar.unpacked/resources/icons/icon.png'
    expect(unpackedPath(already)).toBe(already)
  })

  it('only matches a whole path segment', () => {
    const lookalike = '/home/dev/my-app.asar-backup/icons/icon.png'
    expect(unpackedPath(lookalike)).toBe(lookalike)
  })
})

describe('resource paths', () => {
  it('resolves relative to the bundle root, not the working directory', () => {
    expect(resourceFile('icons', 'icon.png').endsWith(join('resources', 'icons', 'icon.png'))).toBe(
      true
    )
    expect(resourceFile('icons').startsWith(sep)).toBe(true)
  })

  it('points at glyphs that actually ship', () => {
    for (const name of ['tray-light.png', 'tray-dark.png', 'tray-light@2x.png', '1024x1024.png']) {
      expect(existsSync(iconFile(name)), `${name} should exist`).toBe(true)
    }
  })
})
