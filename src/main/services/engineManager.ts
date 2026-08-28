import { existsSync, mkdirSync, readFileSync, writeFileSync, statfs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DiskUsage, EngineStatus, Settings, UsageSample } from '@shared/schemas/domain'
import type { ContainerEngine } from '../docker/engine'
import { DockerEngineAdapter } from '../docker/dockerAdapter'
import { MockEngineAdapter } from '../docker/mockAdapter'
import { normalizeSocketPath } from '../docker/socket'
import { mockUsageHistory } from '@shared/mock/fixtures'
import { HarborlightError } from '../errors'
import { events } from './events'
import { logger } from './logger'

const statfsAsync = promisify(statfs)

const DISK_USAGE_TTL_MS = 5 * 60 * 1000
const USAGE_SAMPLE_INTERVAL_MS = 15_000
const MAX_USAGE_SAMPLES = 2880
const MAX_STATS_CONCURRENCY = 8
const HISTORY_FILE = 'usage-history.json'

/**
 * Owns the active {@link ContainerEngine}, keeps the connection status fresh
 * and records resource history for the Overview charts.
 *
 * `docker df` is expensive on hosts with a large build cache (seconds), so disk
 * usage is cached and refreshed out of band instead of on every poll.
 */
export class EngineManager {
  private engine: ContainerEngine
  private status: EngineStatus | null = null
  private statusTimer: NodeJS.Timeout | null = null
  private diskUsage: { value: DiskUsage; at: number } | null = null
  private diskTotalBytes: number | null = null
  private diskRefreshing = false
  private lastUsageSampleAt = 0
  private samples: UsageSample[] = []
  private sinceLastPersist = 0

  constructor(
    private settings: Settings,
    private readonly userDataPath: string
  ) {
    this.engine = this.createEngine(settings)
    this.samples = this.loadHistory()
  }

  private createEngine(settings: Settings): ContainerEngine {
    if (settings.engineMode === 'mock') {
      logger.info('engine', 'Using MockEngineAdapter (no real Docker access)')
      return new MockEngineAdapter()
    }
    const socketPath = normalizeSocketPath(settings.dockerSocket)
    logger.info('engine', `Using DockerEngineAdapter on ${socketPath}`)
    return new DockerEngineAdapter(socketPath)
  }

  current(): ContainerEngine {
    return this.engine
  }

  /** Throws a friendly error when the engine is known to be unreachable. */
  requireConnected(): ContainerEngine {
    if (this.status && !this.status.connected) {
      throw new HarborlightError(
        'engine-unavailable',
        this.status.error ?? 'The Docker Engine is not reachable.',
        {
          hint: this.status.errorHint
        }
      )
    }
    return this.engine
  }

  async applySettings(settings: Settings): Promise<void> {
    const socketChanged = settings.dockerSocket !== this.settings.dockerSocket
    const modeChanged = settings.engineMode !== this.settings.engineMode
    const intervalChanged = settings.pollIntervalMs !== this.settings.pollIntervalMs
    this.settings = settings

    if (socketChanged || modeChanged) await this.reconnect()
    else if (intervalChanged) this.startPolling()
  }

  async reconnect(): Promise<EngineStatus> {
    await this.engine.dispose().catch((error) => logger.warn('engine', 'dispose failed', error))
    this.engine = this.createEngine(this.settings)
    this.diskUsage = null
    return this.refreshStatus()
  }

  async refreshStatus(): Promise<EngineStatus> {
    const status = await this.engine.getStatus()
    const changed = JSON.stringify(this.status) !== JSON.stringify(status)
    this.status = status
    if (changed) events.emit('engine:status', status)
    return status
  }

  getStatus(): EngineStatus | null {
    return this.status
  }

  startPolling(): void {
    this.stopPolling()
    const interval = Math.max(1000, this.settings.pollIntervalMs)
    this.statusTimer = setInterval(() => {
      void this.poll()
    }, interval)
    void this.poll()
  }

  stopPolling(): void {
    if (this.statusTimer) clearInterval(this.statusTimer)
    this.statusTimer = null
  }

  private async poll(): Promise<void> {
    try {
      const status = await this.refreshStatus()
      if (!status.connected) return
      if (Date.now() - this.lastUsageSampleAt >= USAGE_SAMPLE_INTERVAL_MS) {
        this.lastUsageSampleAt = Date.now()
        await this.sampleUsage(status)
      }
    } catch (error) {
      logger.warn('engine', 'Polling failed', error)
    }
  }

  /**
   * Aggregates live per-container stats into one host-level sample. Only
   * running containers are sampled and concurrency is bounded so a host with
   * hundreds of containers cannot stall the engine.
   */
  private async sampleUsage(status: EngineStatus): Promise<void> {
    const containers = (await this.engine.listContainers(false)).slice(0, 64)
    let cpuPercent = 0
    let memoryBytes = 0

    for (let index = 0; index < containers.length; index += MAX_STATS_CONCURRENCY) {
      const batch = containers.slice(index, index + MAX_STATS_CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map((container) => this.engine.containerStats(container.id))
      )
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        cpuPercent += result.value.cpuPercent
        memoryBytes += result.value.memoryUsage
      }
    }

    const cores = status.cpus ?? 1
    const sample: UsageSample = {
      timestamp: new Date().toISOString(),
      // Docker reports CPU as a percentage of a single core; normalize to the host.
      cpuPercent: Number(Math.min(100, cpuPercent / Math.max(1, cores)).toFixed(2)),
      memoryBytes,
      diskBytes: this.diskUsage?.value
        ? this.diskUsage.value.images.size +
          this.diskUsage.value.containers.size +
          this.diskUsage.value.volumes.size +
          this.diskUsage.value.buildCache.size
        : 0
    }

    this.samples.push(sample)
    if (this.samples.length > MAX_USAGE_SAMPLES) this.samples.shift()
    events.emit('engine:usage', sample)

    this.sinceLastPersist += 1
    if (this.sinceLastPersist >= 20) {
      this.sinceLastPersist = 0
      this.persistHistory()
    }
  }

  getUsageHistory(windowHours: number): UsageSample[] {
    if (this.engine.kind === 'mock') return mockUsageHistory(windowHours, Date.now())
    const cutoff = Date.now() - windowHours * 3_600_000
    return this.samples.filter((sample) => Date.parse(sample.timestamp) >= cutoff)
  }

  async getDiskUsage(force = false): Promise<DiskUsage> {
    const cached = this.diskUsage
    if (!force && cached && Date.now() - cached.at < DISK_USAGE_TTL_MS) return cached.value
    if (cached && this.diskRefreshing) return cached.value

    this.diskRefreshing = true
    try {
      const value = await this.engine.diskUsage()
      this.diskUsage = { value, at: Date.now() }
      return value
    } finally {
      this.diskRefreshing = false
    }
  }

  /** Total size of the filesystem backing Docker, for the "42 GB / 100 GB" card. */
  async getDiskTotalBytes(): Promise<number | null> {
    if (this.diskTotalBytes !== null) return this.diskTotalBytes
    if (this.engine.kind === 'mock') {
      this.diskTotalBytes = 100 * 1024 ** 3
      return this.diskTotalBytes
    }
    for (const path of ['/var/lib/docker', '/var/lib', '/']) {
      try {
        const stats = await statfsAsync(path)
        this.diskTotalBytes = Number(stats.blocks) * Number(stats.bsize)
        return this.diskTotalBytes
      } catch {
        continue
      }
    }
    return null
  }

  async dispose(): Promise<void> {
    this.stopPolling()
    this.persistHistory()
    await this.engine.dispose()
  }

  private historyFile(): string {
    return join(this.userDataPath, HISTORY_FILE)
  }

  private loadHistory(): UsageSample[] {
    try {
      const file = this.historyFile()
      if (!existsSync(file)) return []
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed.slice(-MAX_USAGE_SAMPLES) as UsageSample[]
    } catch (error) {
      logger.warn('engine', 'Could not read the usage history', error)
      return []
    }
  }

  private persistHistory(): void {
    try {
      mkdirSync(this.userDataPath, { recursive: true })
      writeFileSync(this.historyFile(), JSON.stringify(this.samples.slice(-MAX_USAGE_SAMPLES)))
    } catch (error) {
      logger.warn('engine', 'Could not persist the usage history', error)
    }
  }
}
