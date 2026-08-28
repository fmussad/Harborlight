import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { settingsSchema, type Settings } from '@shared/schemas/domain'
import { logger } from './logger'
import { DEFAULT_SOCKET, pickDefaultSocket } from '../docker/socket'

const FILE_NAME = 'settings.json'

export function defaultSettings(): Settings {
  const socket = pickDefaultSocket()
  return {
    theme: 'system',
    dockerSocket: socket?.path ?? DEFAULT_SOCKET,
    useCustomSocket: false,
    engineMode: process.env.HARBORLIGHT_ENGINE === 'mock' ? 'mock' : 'docker',
    pollIntervalMs: 5000,
    logTailLines: 500,
    logTimestamps: true,
    logWordWrap: false,
    defaultShell: 'auto',
    closeToTray: true,
    startAtLogin: false,
    startMinimized: false,
    desktopNotifications: true,
    updateChannel: 'stable',
    confirmDestructive: true,
    redactEnvSecrets: true
  }
}

/**
 * Settings are stored as plain JSON in the Electron `userData` directory.
 * They deliberately contain no secrets — registry credentials live in
 * `safeStorage` (see services/secrets.ts).
 */
export class SettingsStore {
  private current: Settings
  private readonly file: string
  private readonly listeners = new Set<(settings: Settings) => void>()

  constructor(userDataPath: string) {
    this.file = join(userDataPath, FILE_NAME)
    this.current = this.load()
  }

  get(): Settings {
    return { ...this.current }
  }

  update(patch: Partial<Settings>): Settings {
    const merged = settingsSchema.parse({ ...this.current, ...patch })
    this.current = merged
    this.persist()
    for (const listener of this.listeners) listener(this.get())
    return this.get()
  }

  reset(): Settings {
    this.current = defaultSettings()
    this.persist()
    for (const listener of this.listeners) listener(this.get())
    return this.get()
  }

  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private load(): Settings {
    const fallback = defaultSettings()
    if (!existsSync(this.file)) return fallback
    try {
      const parsed = settingsSchema.partial().parse(JSON.parse(readFileSync(this.file, 'utf8')))
      return settingsSchema.parse({ ...fallback, ...parsed })
    } catch (error) {
      logger.warn('settings', 'Could not read settings.json, falling back to defaults', error)
      return fallback
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      writeFileSync(temporary, JSON.stringify(this.current, null, 2), { mode: 0o600 })
      renameSync(temporary, this.file)
    } catch (error) {
      logger.error('settings', 'Failed to persist settings', error)
    }
  }
}
