import type { BrowserWindow } from 'electron'
import type { EngineManager } from './services/engineManager'
import type { SecretStore } from './services/secrets'
import type { SettingsStore } from './services/settings'

/** Everything a command handler is allowed to reach. */
export interface AppContext {
  settings: SettingsStore
  secrets: SecretStore
  engines: EngineManager
  getMainWindow(): BrowserWindow | null
  quit(): void
  hideToTray(): void
  refreshTray(): void
}
