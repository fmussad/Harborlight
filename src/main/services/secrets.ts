import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { RegistryEntry, RegistryKind, SecureStorageStatus } from '@shared/schemas/domain'
import { HarborlightError } from '../errors'
import { logger } from './logger'

interface StoredRegistry {
  id: string
  name: string
  kind: RegistryKind
  serverAddress: string
  username: string | null
  /** Base64 of the safeStorage ciphertext. Never leaves the main process. */
  secret: string | null
  lastLoginAt: string | null
}

const FILE_NAME = 'registries.json'

export const DEFAULT_REGISTRIES: { name: string; kind: RegistryKind; serverAddress: string }[] = [
  { name: 'Docker Hub', kind: 'dockerhub', serverAddress: 'https://index.docker.io/v1/' },
  { name: 'GitHub Container Registry', kind: 'ghcr', serverAddress: 'ghcr.io' }
]

/**
 * Registry credentials.
 *
 * Secrets are encrypted with Electron `safeStorage` (libsecret / kwallet on
 * Ubuntu) and stored as ciphertext. Plaintext never reaches disk, the renderer
 * or the logs; the renderer only ever learns whether credentials exist.
 */
export class SecretStore {
  private readonly file: string
  private entries: StoredRegistry[]

  constructor(userDataPath: string) {
    this.file = join(userDataPath, FILE_NAME)
    this.entries = this.load()
    if (this.entries.length === 0) {
      this.entries = DEFAULT_REGISTRIES.map((registry) => ({
        id: randomUUID(),
        name: registry.name,
        kind: registry.kind,
        serverAddress: registry.serverAddress,
        username: null,
        secret: null,
        lastLoginAt: null
      }))
      this.persist()
    }
  }

  status(): SecureStorageStatus {
    const available = safeStorage.isEncryptionAvailable()
    let backend: string
    try {
      backend =
        process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform
    } catch {
      backend = 'unavailable'
    }
    return {
      available,
      backend,
      reason: available
        ? null
        : 'No OS keyring is available, so Harborlight will not store registry credentials. Install gnome-keyring (or kwallet) and log in again; you can still pull public images.'
    }
  }

  list(): RegistryEntry[] {
    return this.entries.map(toPublic)
  }

  add(input: { name: string; kind: RegistryKind; serverAddress: string }): RegistryEntry {
    if (this.entries.some((entry) => entry.serverAddress === input.serverAddress)) {
      throw new HarborlightError('conflict', `${input.serverAddress} is already configured.`)
    }
    const entry: StoredRegistry = {
      id: randomUUID(),
      name: input.name,
      kind: input.kind,
      serverAddress: input.serverAddress,
      username: null,
      secret: null,
      lastLoginAt: null
    }
    this.entries = [...this.entries, entry]
    this.persist()
    return toPublic(entry)
  }

  remove(id: string): void {
    const entry = this.require(id)
    this.entries = this.entries.filter((candidate) => candidate.id !== entry.id)
    this.persist()
  }

  login(id: string, username: string, secret: string): RegistryEntry {
    const entry = this.require(id)
    if (!safeStorage.isEncryptionAvailable()) {
      throw new HarborlightError(
        'unsupported',
        'Secure storage is unavailable, so credentials cannot be saved.',
        {
          hint: 'Install and unlock an OS keyring (gnome-keyring on Ubuntu), then try again.'
        }
      )
    }
    entry.username = username
    entry.secret = safeStorage.encryptString(secret).toString('base64')
    entry.lastLoginAt = new Date().toISOString()
    this.persist()
    logger.info('registry', `Stored credentials for ${entry.serverAddress} (user ${username})`)
    return toPublic(entry)
  }

  logout(id: string): RegistryEntry {
    const entry = this.require(id)
    entry.username = null
    entry.secret = null
    entry.lastLoginAt = null
    this.persist()
    return toPublic(entry)
  }

  /** Main-process only: decrypts credentials for a Docker pull. */
  authFor(id: string): { username: string; password: string; serveraddress: string } | null {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (!entry?.secret || !entry.username) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      return {
        username: entry.username,
        password: safeStorage.decryptString(Buffer.from(entry.secret, 'base64')),
        serveraddress: entry.serverAddress
      }
    } catch (error) {
      logger.error('registry', 'Could not decrypt stored credentials', error)
      return null
    }
  }

  private require(id: string): StoredRegistry {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (!entry) throw new HarborlightError('not-found', 'That registry is not configured.')
    return entry
  }

  private load(): StoredRegistry[] {
    if (!existsSync(this.file)) return []
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed as StoredRegistry[]
    } catch (error) {
      logger.warn('registry', 'Could not read registries.json', error)
      return []
    }
  }

  private persist(): void {
    try {
      mkdirSync(join(this.file, '..'), { recursive: true })
      const temporary = `${this.file}.tmp`
      writeFileSync(temporary, JSON.stringify(this.entries, null, 2), { mode: 0o600 })
      renameSync(temporary, this.file)
    } catch (error) {
      logger.error('registry', 'Could not persist registries.json', error)
    }
  }
}

function toPublic(entry: StoredRegistry): RegistryEntry {
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    serverAddress: entry.serverAddress,
    username: entry.username,
    hasCredentials: Boolean(entry.secret),
    lastLoginAt: entry.lastLoginAt
  }
}
