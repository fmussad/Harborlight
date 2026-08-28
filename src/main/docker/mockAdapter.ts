import { randomUUID } from 'node:crypto'
import type { LogChunk } from '@shared/contracts/responses'
import type {
  CleanupCategory,
  ContainerDetail,
  ContainerStats,
  ContainerSummary,
  DiskUsage,
  EngineStatus,
  ImageLayer,
  ImageSummary,
  NetworkSummary,
  VolumeSummary
} from '@shared/schemas/domain'
import type { CommandPayload } from '@shared/contracts/commands'
import {
  MOCK_LOG_LINES,
  mockContainerDetail,
  mockContainers,
  mockDiskUsage,
  mockImageHistory,
  mockImages,
  mockNetworks,
  mockStatsFor,
  mockVolumes
} from '@shared/mock/fixtures'
import { HarborlightError } from '../errors'
import type {
  ContainerEngine,
  ExecCallbacks,
  ExecHandle,
  ExecStartOptions,
  LogStreamCallbacks,
  LogStreamOptions,
  PruneOutcome,
  PullProgress,
  StreamHandle
} from './engine'

/**
 * Deterministic in-memory engine.
 *
 * Every mutation is applied to local state only, which is what makes it safe
 * for automated tests: no Docker call can escape this class.
 */
export class MockEngineAdapter implements ContainerEngine {
  readonly kind = 'mock' as const
  readonly socketPath = 'mock://harborlight'

  private containers = mockContainers()
  private images = mockImages()
  private volumes = mockVolumes()
  private networks = mockNetworks()
  private tick = 0
  private readonly timers = new Set<NodeJS.Timeout>()

  async getStatus(): Promise<EngineStatus> {
    return {
      connected: true,
      adapter: this.kind,
      socketPath: this.socketPath,
      rootless: false,
      version: '1.0.0-beta.3 (mock)',
      apiVersion: '1.45',
      os: 'Ubuntu 24.04 LTS (mock)',
      kernelVersion: '6.8.0-generic',
      architecture: 'x86_64',
      cpus: 12,
      memoryTotal: 32 * 1024 ** 3,
      containersRunning: this.containers.filter((container) => container.state === 'running')
        .length,
      containersStopped: this.containers.filter((container) => container.state === 'exited').length,
      containersPaused: this.containers.filter((container) => container.state === 'paused').length,
      images: this.images.length,
      error: null,
      errorHint: null,
      checkedAt: new Date().toISOString()
    }
  }

  async dispose(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer)
    this.timers.clear()
  }

  private find(id: string): ContainerSummary {
    const container = this.containers.find((entry) => entry.id === id || entry.name === id)
    if (!container) throw new HarborlightError('not-found', `Container ${id} does not exist.`)
    return container
  }

  private mutate(id: string, changes: Partial<ContainerSummary>): void {
    this.containers = this.containers.map((container) =>
      container.id === id ? { ...container, ...changes } : container
    )
  }

  async listContainers(all: boolean): Promise<ContainerSummary[]> {
    return all ? [...this.containers] : this.containers.filter((c) => c.state === 'running')
  }

  async inspectContainer(id: string, _redactEnv: boolean): Promise<ContainerDetail> {
    return mockContainerDetail(this.find(id))
  }

  async containerStats(id: string): Promise<ContainerStats> {
    const container = this.find(id)
    this.tick += 1
    const stats = mockStatsFor(container, this.tick)
    return {
      id: container.id,
      timestamp: new Date().toISOString(),
      cpuPercent: stats.cpuPercent,
      memoryUsage: stats.memoryUsage,
      memoryLimit: stats.memoryLimit,
      memoryPercent: Number(((stats.memoryUsage / stats.memoryLimit) * 100).toFixed(2)),
      networkRx: 1024 * 1024 * (this.tick % 17),
      networkTx: 512 * 1024 * (this.tick % 13),
      blockRead: 4 * 1024 * 1024,
      blockWrite: 2 * 1024 * 1024,
      pids: 12
    }
  }

  async startContainer(id: string): Promise<void> {
    const container = this.find(id)
    if (container.state === 'running') {
      throw new HarborlightError('conflict', `${container.name} is already running.`)
    }
    this.mutate(container.id, {
      state: 'running',
      status: 'Up 1 second',
      startedAt: new Date().toISOString(),
      uptimeSeconds: 1,
      exitCode: null
    })
  }

  async stopContainer(id: string, _timeoutSeconds: number): Promise<void> {
    const container = this.find(id)
    if (container.state !== 'running') {
      throw new HarborlightError('conflict', `${container.name} is not running.`)
    }
    this.mutate(container.id, {
      state: 'exited',
      status: 'Exited (0) 1 second ago',
      startedAt: null,
      uptimeSeconds: null,
      exitCode: 0,
      health: 'none'
    })
  }

  async restartContainer(id: string, timeout: number): Promise<void> {
    const container = this.find(id)
    if (container.state === 'running') await this.stopContainer(id, timeout)
    await this.startContainer(container.id)
  }

  async pauseContainer(id: string): Promise<void> {
    const container = this.find(id)
    if (container.state !== 'running')
      throw new HarborlightError('conflict', `${container.name} is not running.`)
    this.mutate(container.id, { state: 'paused', status: 'Up 2 hours (Paused)' })
  }

  async unpauseContainer(id: string): Promise<void> {
    const container = this.find(id)
    if (container.state !== 'paused')
      throw new HarborlightError('conflict', `${container.name} is not paused.`)
    this.mutate(container.id, { state: 'running', status: 'Up 2 hours' })
  }

  async killContainer(id: string, _signal: string): Promise<void> {
    const container = this.find(id)
    this.mutate(container.id, {
      state: 'exited',
      status: 'Exited (137) 1 second ago',
      exitCode: 137,
      startedAt: null,
      uptimeSeconds: null,
      health: 'none'
    })
  }

  async renameContainer(id: string, name: string): Promise<void> {
    const container = this.find(id)
    if (this.containers.some((entry) => entry.name === name)) {
      throw new HarborlightError('conflict', `The name "${name}" is already in use.`)
    }
    this.mutate(container.id, { name, names: [name] })
  }

  async removeContainer(
    id: string,
    options: { force: boolean; removeVolumes: boolean }
  ): Promise<void> {
    const container = this.find(id)
    if (container.state === 'running' && !options.force) {
      throw new HarborlightError('conflict', `${container.name} is running.`, {
        hint: 'Stop it first or use Force remove.'
      })
    }
    this.containers = this.containers.filter((entry) => entry.id !== container.id)
    if (options.removeVolumes) {
      this.volumes = this.volumes.filter(
        (volume) => !volume.containers.some((c) => c.id === container.id)
      )
    }
  }

  async runContainer(
    spec: CommandPayload<'containers.run'>
  ): Promise<{ id: string; name: string }> {
    const id = randomUUID().replace(/-/g, '').padEnd(64, '0')
    const name = spec.name ?? `harborlight-${id.slice(0, 6)}`
    const port = spec.ports[0]
    this.containers = [
      {
        id,
        shortId: id.slice(0, 12),
        name,
        names: [name],
        image: spec.image,
        imageId: `sha256:${id}`,
        command: spec.command ?? '',
        createdAt: new Date().toISOString(),
        startedAt: spec.detach ? new Date().toISOString() : null,
        state: spec.detach ? 'running' : 'created',
        status: spec.detach ? 'Up 1 second' : 'Created',
        health: 'none',
        ports: port
          ? [{ privatePort: port.containerPort, publicPort: port.hostPort, type: port.protocol }]
          : [],
        networks: ['bridge'],
        labels: {},
        composeProject: null,
        composeService: null,
        uptimeSeconds: spec.detach ? 1 : null,
        exitCode: null
      },
      ...this.containers
    ]
    return { id, name }
  }

  async streamLogs(
    options: LogStreamOptions,
    callbacks: LogStreamCallbacks
  ): Promise<StreamHandle> {
    const container = this.find(options.containerId)
    const id = randomUUID()
    let sequence = 0

    const build = (index: number): LogChunk => {
      const line = MOCK_LOG_LINES[index % MOCK_LOG_LINES.length]!
      sequence += 1
      return {
        stream: line.level === 'ERROR' ? 'stderr' : 'stdout',
        timestamp: new Date().toISOString(),
        message: `${line.level.padEnd(5)} ${line.scope.padEnd(12)} ${line.message}`,
        sequence
      }
    }

    const backlog = Array.from(
      { length: Math.min(options.tail, MOCK_LOG_LINES.length) },
      (_, index) => build(index)
    )
    setTimeout(() => callbacks.onChunk(backlog), 10)

    if (!options.follow) {
      setTimeout(() => callbacks.onEnd(`Log stream for ${container.name} completed.`), 20)
      return { id, stop: () => undefined }
    }

    let index = backlog.length
    const timer = setInterval(() => {
      callbacks.onChunk([build(index)])
      index += 1
    }, 1200)
    this.timers.add(timer)

    const stop = (): void => {
      clearInterval(timer)
      this.timers.delete(timer)
    }
    return { id, stop }
  }

  async collectLogs(options: LogStreamOptions): Promise<LogChunk[]> {
    this.find(options.containerId)
    return MOCK_LOG_LINES.map((line, index) => ({
      stream: line.level === 'ERROR' ? ('stderr' as const) : ('stdout' as const),
      timestamp: new Date(Date.now() - (MOCK_LOG_LINES.length - index) * 1000).toISOString(),
      message: `${line.level.padEnd(5)} ${line.scope.padEnd(12)} ${line.message}`,
      sequence: index + 1
    }))
  }

  async startExec(options: ExecStartOptions, callbacks: ExecCallbacks): Promise<ExecHandle> {
    const container = this.find(options.containerId)
    const shell = options.shell ?? options.shellCandidates[0] ?? '/bin/sh'
    const id = randomUUID()
    const user = options.user ?? 'root'
    const workingDir = options.workingDir ?? '/app'
    const prompt = `\r\n${user}@${container.name}:${workingDir}# `
    let buffer = ''

    setTimeout(() => {
      callbacks.onData(
        `Harborlight mock shell (${shell}) — no real container is attached.${prompt}`
      )
    }, 30)

    return {
      id,
      shell,
      user,
      workingDir,
      write: (data: string) => {
        for (const char of data) {
          if (char === '\r') {
            const command = buffer.trim()
            buffer = ''
            callbacks.onData('\r\n')
            if (command === 'exit') {
              callbacks.onExit(0, 'Session closed.')
              return
            }
            callbacks.onData(mockShellOutput(command, workingDir))
            callbacks.onData(prompt)
          } else if (char === '\u007f') {
            buffer = buffer.slice(0, -1)
            callbacks.onData('\b \b')
          } else {
            buffer += char
            callbacks.onData(char)
          }
        }
      },
      resize: () => undefined,
      stop: () => callbacks.onExit(0, 'Session closed.')
    }
  }

  async listImages(): Promise<ImageSummary[]> {
    return [...this.images]
  }

  async inspectImage(id: string): Promise<{ raw: string; usedBy: { id: string; name: string }[] }> {
    const image = this.images.find((entry) => entry.id === id || entry.reference === id)
    if (!image) throw new HarborlightError('not-found', `Image ${id} does not exist.`)
    const usedBy = this.containers
      .filter((container) => container.image === image.reference)
      .map((container) => ({ id: container.id, name: container.name }))
    return {
      raw: JSON.stringify({ Id: image.id, RepoTags: image.repoTags, Size: image.size }, null, 2),
      usedBy
    }
  }

  async imageHistory(id: string): Promise<ImageLayer[]> {
    const image = this.images.find((entry) => entry.id === id || entry.reference === id)
    return mockImageHistory(image?.reference ?? id)
  }

  async pullImage(
    reference: string,
    _auth: unknown,
    onProgress: (progress: PullProgress) => void,
    signal: AbortSignal
  ): Promise<void> {
    const layers = ['a1b2c3d4', 'e5f6a7b8', 'c9d0e1f2']
    for (let step = 0; step <= 10; step += 1) {
      if (signal.aborted)
        throw new HarborlightError('cancelled', `Pull of ${reference} was cancelled.`)
      await new Promise((resolve) => setTimeout(resolve, 120))
      onProgress({
        layerId: layers[step % layers.length] ?? null,
        status: step === 10 ? 'Pull complete' : 'Downloading',
        current: step * 10,
        total: 100,
        percent: step * 10
      })
    }
    if (!this.images.some((image) => image.reference === reference)) {
      const id = `sha256:${randomUUID().replace(/-/g, '')}`
      const [repository = reference, tag = 'latest'] = reference.split(':')
      this.images = [
        {
          id,
          shortId: id.slice(7, 19),
          repository,
          tag,
          reference,
          repoTags: [reference],
          digest: null,
          createdAt: new Date().toISOString(),
          size: 180 * 1024 ** 2,
          sharedSize: 0,
          containers: 0,
          dangling: false,
          unused: true,
          labels: {}
        },
        ...this.images
      ]
    }
  }

  async removeImage(
    id: string,
    options: { force: boolean; pruneChildren: boolean }
  ): Promise<void> {
    const image = this.images.find((entry) => entry.id === id || entry.reference === id)
    if (!image) throw new HarborlightError('not-found', `Image ${id} does not exist.`)
    if (image.containers > 0 && !options.force) {
      throw new HarborlightError(
        'conflict',
        `${image.reference} is used by ${image.containers} container(s).`,
        {
          hint: 'Remove the containers first, or use Force remove.'
        }
      )
    }
    this.images = this.images.filter((entry) => entry.id !== image.id)
  }

  async tagImage(id: string, reference: string): Promise<void> {
    const image = this.images.find((entry) => entry.id === id || entry.reference === id)
    if (!image) throw new HarborlightError('not-found', `Image ${id} does not exist.`)
    image.repoTags = [...image.repoTags, reference]
  }

  async listVolumes(): Promise<VolumeSummary[]> {
    return [...this.volumes]
  }

  async inspectVolume(name: string): Promise<{ raw: string }> {
    const volume = this.volumes.find((entry) => entry.name === name)
    if (!volume) throw new HarborlightError('not-found', `Volume ${name} does not exist.`)
    return { raw: JSON.stringify(volume, null, 2) }
  }

  async removeVolume(name: string, force: boolean): Promise<void> {
    const volume = this.volumes.find((entry) => entry.name === name)
    if (!volume) throw new HarborlightError('not-found', `Volume ${name} does not exist.`)
    if (volume.inUse && !force) {
      throw new HarborlightError('conflict', `${name} is still attached to a container.`)
    }
    this.volumes = this.volumes.filter((entry) => entry.name !== name)
  }

  async listNetworks(): Promise<NetworkSummary[]> {
    return [...this.networks]
  }

  async inspectNetwork(id: string): Promise<{ raw: string }> {
    const network = this.networks.find((entry) => entry.id === id || entry.name === id)
    if (!network) throw new HarborlightError('not-found', `Network ${id} does not exist.`)
    return { raw: JSON.stringify(network, null, 2) }
  }

  async removeNetwork(id: string): Promise<void> {
    const network = this.networks.find((entry) => entry.id === id || entry.name === id)
    if (!network) throw new HarborlightError('not-found', `Network ${id} does not exist.`)
    if (network.system)
      throw new HarborlightError('conflict', `${network.name} is a predefined network.`)
    if (network.inUse)
      throw new HarborlightError('conflict', `${network.name} still has endpoints attached.`)
    this.networks = this.networks.filter((entry) => entry.id !== network.id)
  }

  async diskUsage(): Promise<DiskUsage> {
    return mockDiskUsage()
  }

  async prune(category: CleanupCategory): Promise<PruneOutcome> {
    switch (category) {
      case 'stoppedContainers': {
        const removed = this.containers.filter((container) => container.state === 'exited')
        this.containers = this.containers.filter((container) => container.state !== 'exited')
        return { reclaimed: 210 * 1024 ** 2, removed: removed.map((container) => container.name) }
      }
      case 'danglingImages': {
        const removed = this.images.filter((image) => image.dangling)
        this.images = this.images.filter((image) => !image.dangling)
        return { reclaimed: 320 * 1024 ** 2, removed: removed.map((image) => image.shortId) }
      }
      case 'unusedImages': {
        const removed = this.images.filter((image) => image.unused && !image.dangling)
        this.images = this.images.filter((image) => !image.unused || image.dangling)
        return {
          reclaimed: Math.round(1.6 * 1024 ** 3),
          removed: removed.map((image) => image.reference)
        }
      }
      case 'unusedNetworks': {
        const removed = this.networks.filter((network) => !network.system && !network.inUse)
        this.networks = this.networks.filter((network) => network.system || network.inUse)
        return { reclaimed: 0, removed: removed.map((network) => network.name) }
      }
      case 'buildCache':
        return { reclaimed: Math.round(1.1 * 1024 ** 3), removed: ['build-cache'] }
      case 'unusedVolumes': {
        const removed = this.volumes.filter((volume) => !volume.inUse)
        this.volumes = this.volumes.filter((volume) => volume.inUse)
        return {
          reclaimed: Math.round(1.1 * 1024 ** 3),
          removed: removed.map((volume) => volume.name)
        }
      }
      default:
        throw new HarborlightError('validation', `Unknown cleanup category "${category}".`)
    }
  }
}

function mockShellOutput(command: string, workingDir: string): string {
  if (command === '') return ''
  if (command === 'ls' || command === 'ls -la') {
    return [
      'total 64',
      'drwxr-xr-x  1 root root 4096 May 16 18:30 .',
      'drwxr-xr-x  1 root root 4096 May 14 10:32 ..',
      'drwxr-xr-x  1 root root 1024 May 14 10:22 server'
    ].join('\r\n')
  }
  if (command === 'pwd') return workingDir
  if (command === 'whoami') return 'root'
  if (command.startsWith('echo ')) return command.slice(5)
  return `${command.split(' ')[0]}: command not found in the Harborlight mock shell`
}
