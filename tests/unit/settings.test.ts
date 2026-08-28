import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore, defaultSettings } from '@main/services/settings'

let directory: string
const settingsFile = (): string => join(directory, 'settings.json')

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'harborlight-settings-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('defaults', () => {
  it('starts on the system theme with confirmations and redaction enabled', () => {
    const defaults = defaultSettings()
    expect(defaults.theme).toBe('system')
    expect(defaults.confirmDestructive).toBe(true)
    expect(defaults.redactEnvSecrets).toBe(true)
  })

  it('uses a store with no file on disk without writing one', () => {
    const store = new SettingsStore(directory)
    expect(store.get().theme).toBe('system')
    expect(() => statSync(settingsFile())).toThrow()
  })
})

describe('theme persistence', () => {
  it('survives a restart', () => {
    new SettingsStore(directory).update({ theme: 'dark' })

    const reopened = new SettingsStore(directory)
    expect(reopened.get().theme).toBe('dark')
  })

  it('writes the file with user-only permissions', () => {
    new SettingsStore(directory).update({ theme: 'light' })

    expect(statSync(settingsFile()).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8'))).toMatchObject({ theme: 'light' })
  })

  it('notifies listeners with the new value', () => {
    const store = new SettingsStore(directory)
    const listener = vi.fn()
    store.onChange(listener)

    store.update({ theme: 'dark' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ theme: 'dark' })
  })

  it('stops notifying after unsubscribe', () => {
    const store = new SettingsStore(directory)
    const listener = vi.fn()
    store.onChange(listener)()

    store.update({ theme: 'dark' })

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('validation', () => {
  it('rejects a value outside the allowed range and keeps the previous one', () => {
    const store = new SettingsStore(directory)
    expect(() => store.update({ pollIntervalMs: 10 })).toThrow()
    expect(store.get().pollIntervalMs).toBe(defaultSettings().pollIntervalMs)
  })

  it('rejects an unknown theme', () => {
    const store = new SettingsStore(directory)
    expect(() => store.update({ theme: 'midnight' as never })).toThrow()
  })

  it('merges a partial file over the defaults', () => {
    writeFileSync(settingsFile(), JSON.stringify({ theme: 'dark', logTailLines: 2000 }))

    const settings = new SettingsStore(directory).get()
    expect(settings.theme).toBe('dark')
    expect(settings.logTailLines).toBe(2000)
    expect(settings.updateChannel).toBe('stable')
  })

  it('ignores unknown keys left by an older or newer version', () => {
    writeFileSync(settingsFile(), JSON.stringify({ theme: 'dark', experimentalWarpDrive: true }))

    const settings = new SettingsStore(directory).get() as Record<string, unknown>
    expect(settings.theme).toBe('dark')
    expect(settings.experimentalWarpDrive).toBeUndefined()
  })

  it('falls back to defaults when the file is corrupt instead of failing to start', () => {
    writeFileSync(settingsFile(), '{ this is not json')

    expect(new SettingsStore(directory).get()).toEqual(defaultSettings())
  })

  it('resets back to defaults', () => {
    const store = new SettingsStore(directory)
    store.update({ theme: 'dark', closeToTray: false })

    expect(store.reset()).toEqual(defaultSettings())
    expect(new SettingsStore(directory).get().theme).toBe('system')
  })
})
