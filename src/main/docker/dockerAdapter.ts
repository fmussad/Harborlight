import { randomUUID } from 'node:crypto'
import type { Duplex, Readable } from 'node:stream'
import Docker from 'dockerode'
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
import { fromDockerError, HarborlightError } from '../errors'
import { logger } from '../services/logger'
import { tokenizeCommand } from './command'
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
import { LogAssembler } from './logFrames'
import {
  normalizeContainerDetail,
  normalizeContainerSummary,
  normalizeImage,
  normalizeNetwork,
  normalizeStats,
  normalizeVolume,
  shortId
} from './normalize'

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Dockerode's typings stop at the transport layer; Engine API payloads are
 * `any`. Every value read here is converted through ./normalize.ts. */

const LOG_FLUSH_INTERVAL_MS = 90
const LOG_MAX_PENDING_CHUNKS = 5000

/** Real Docker Engine implementation, talking to a local UNIX socket. */
export class DockerEngineAdapter implements ContainerEngine {
  readonly kind = 'docker' as const
  private readonly docker: Docker
  private readonly streams = new Map<string, () => void>()

  constructor(readonly socketPath: string) {
    this.docker = new Docker({ socketPath })
  }

  async getStatus(): Promise<EngineStatus> {
    const checkedAt = new Date().toISOString()
    try {
      const [version, info] = await Promise.all([this.docker.version(), this.docker.info()])
      return {
        connected: true,
        adapter: this.kind,
        socketPath: this.socketPath,
        rootless:
          this.socketPath.startsWith('/run/user/') ||
          Boolean(info?.SecurityOptions?.some?.((o: string) => o.includes('rootless'))),
        version: version?.Version ?? null,
        apiVersion: version?.ApiVersion ?? null,
        os: info?.OperatingSystem ?? null,
        kernelVersion: info?.KernelVersion ?? null,
        architecture: info?.Architecture ?? null,
        cpus: typeof info?.NCPU === 'number' ? info.NCPU : null,
        memoryTotal: typeof info?.MemTotal === 'number' ? info.MemTotal : null,
        containersRunning:
          typeof info?.ContainersRunning === 'number' ? info.ContainersRunning : null,
        containersStopped:
          typeof info?.ContainersStopped === 'number' ? info.ContainersStopped : null,
        containersPaused: typeof info?.ContainersPaused === 'number' ? info.ContainersPaused : null,
        images: typeof info?.Images === 'number' ? info.Images : null,
        error: null,
        errorHint: null,
        checkedAt
      }
    } catch (error) {
      const mapped = fromDockerError(error, 'Connecting to the Docker Engine')
      return {
        connected: false,
        adapter: this.kind,
        socketPath: this.socketPath,
        rootless: this.socketPath.startsWith('/run/user/'),
        version: null,
        apiVersion: null,
        os: null,
        kernelVersion: null,
        architecture: null,
        cpus: null,
        memoryTotal: null,
        containersRunning: null,
        containersStopped: null,
        containersPaused: null,
        images: null,
        error: mapped.message,
        errorHint: mapped.hint,
        checkedAt
      }
    }
  }

  async dispose(): Promise<void> {
    for (const stop of this.streams.values()) {
      try {
        stop()
      } catch (error) {
        logger.warn('docker', 'Failed to stop a stream during dispose', error)
      }
    }
    this.streams.clear()
  }

  // ------------------------------------------------------------ containers

  async listContainers(all: boolean): Promise<ContainerSummary[]> {
    try {
      const containers = await this.docker.listContainers({ all })
      return containers.map((info) => normalizeContainerSummary(info))
    } catch (error) {
      throw fromDockerError(error, 'Listing containers')
    }
  }

  async inspectContainer(id: string, redactEnv: boolean): Promise<ContainerDetail> {
    try {
      const raw = await this.docker.getContainer(id).inspect()
      return normalizeContainerDetail(raw, { redactEnv })
    } catch (error) {
      throw fromDockerError(error, `Inspecting container ${shortId(id)}`)
    }
  }

  async containerStats(id: string): Promise<ContainerStats> {
    try {
      const stats: any = await this.docker
        .getContainer(id)
        .stats({ stream: false, 'one-shot': false } as any)
      return normalizeStats(id, stats)
    } catch (error) {
      throw fromDockerError(error, `Reading stats for ${shortId(id)}`)
    }
  }

  async startContainer(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).start()
    } catch (error) {
      throw fromDockerError(error, `Starting container ${shortId(id)}`)
    }
  }

  async stopContainer(id: string, timeoutSeconds: number): Promise<void> {
    try {
      await this.docker.getContainer(id).stop({ t: timeoutSeconds })
    } catch (error) {
      throw fromDockerError(error, `Stopping container ${shortId(id)}`)
    }
  }

  async restartContainer(id: string, timeoutSeconds: number): Promise<void> {
    try {
      await this.docker.getContainer(id).restart({ t: timeoutSeconds })
    } catch (error) {
      throw fromDockerError(error, `Restarting container ${shortId(id)}`)
    }
  }

  async pauseContainer(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).pause()
    } catch (error) {
      throw fromDockerError(error, `Pausing container ${shortId(id)}`)
    }
  }

  async unpauseContainer(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).unpause()
    } catch (error) {
      throw fromDockerError(error, `Resuming container ${shortId(id)}`)
    }
  }

  async killContainer(id: string, signal: string): Promise<void> {
    try {
      await this.docker.getContainer(id).kill({ signal })
    } catch (error) {
      throw fromDockerError(error, `Killing container ${shortId(id)}`)
    }
  }

  async renameContainer(id: string, name: string): Promise<void> {
    try {
      await this.docker.getContainer(id).rename({ name })
    } catch (error) {
      throw fromDockerError(error, `Renaming container ${shortId(id)}`)
    }
  }

  async removeContainer(
    id: string,
    options: { force: boolean; removeVolumes: boolean }
  ): Promise<void> {
    try {
      await this.docker.getContainer(id).remove({ force: options.force, v: options.removeVolumes })
    } catch (error) {
      throw fromDockerError(error, `Removing container ${shortId(id)}`)
    }
  }

  async runContainer(
    spec: CommandPayload<'containers.run'>
  ): Promise<{ id: string; name: string }> {
    const exposedPorts: Record<string, Record<string, never>> = {}
    const portBindings: Record<string, { HostPort: string }[]> = {}
    for (const port of spec.ports) {
      const key = `${port.containerPort}/${port.protocol}`
      exposedPorts[key] = {}
      portBindings[key] = [{ HostPort: String(port.hostPort) }]
    }

    const options: Docker.ContainerCreateOptions = {
      Image: spec.image,
      Env: spec.env.map((entry) => `${entry.key}=${entry.value}`),
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Binds: spec.volumes.map(
          (volume) => `${volume.source}:${volume.target}${volume.readOnly ? ':ro' : ''}`
        ),
        RestartPolicy: { Name: spec.autoRemove ? 'no' : spec.restartPolicy },
        AutoRemove: spec.autoRemove
      }
    }
    if (spec.name) options.name = spec.name
    if (spec.command && spec.command.trim().length > 0) options.Cmd = tokenizeCommand(spec.command)

    try {
      const container = await this.docker.createContainer(options)
      if (spec.detach) await container.start()
      const inspect: any = await container.inspect()
      return { id: container.id, name: String(inspect?.Name ?? '').replace(/^\//, '') }
    } catch (error) {
      throw fromDockerError(error, `Running ${spec.image}`)
    }
  }

  // ------------------------------------------------------------------ logs

  private async hasTty(containerId: string): Promise<boolean> {
    try {
      const inspect: any = await this.docker.getContainer(containerId).inspect()
      return Boolean(inspect?.Config?.Tty)
    } catch {
      return false
    }
  }

  async streamLogs(
    options: LogStreamOptions,
    callbacks: LogStreamCallbacks
  ): Promise<StreamHandle> {
    const id = randomUUID()
    const tty = await this.hasTty(options.containerId)
    const assembler = new LogAssembler(tty)

    let stream: Readable
    try {
      stream = (await this.docker.getContainer(options.containerId).logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: options.tail,
        timestamps: options.timestamps,
        ...(options.sinceSeconds
          ? { since: Math.floor(Date.now() / 1000) - options.sinceSeconds }
          : {})
      })) as unknown as Readable
    } catch (error) {
      throw fromDockerError(error, 'Opening the log stream')
    }

    // Backpressure: batch chunks on a timer and drop the oldest if the renderer
    // cannot keep up, so a chatty container can never exhaust memory.
    let pending: LogChunk[] = []
    let dropped = 0
    const flush = (): void => {
      if (pending.length === 0) return
      const batch = pending
      pending = []
      if (dropped > 0) {
        batch.unshift({
          stream: 'stderr',
          timestamp: new Date().toISOString(),
          message: `[harborlight] dropped ${dropped} lines to keep up with the stream`,
          sequence: -1
        })
        dropped = 0
      }
      callbacks.onChunk(batch)
    }
    const timer = setInterval(flush, LOG_FLUSH_INTERVAL_MS)

    stream.on('data', (data: Buffer) => {
      const chunks = assembler.push(data)
      if (chunks.length === 0) return
      pending.push(...chunks)
      if (pending.length > LOG_MAX_PENDING_CHUNKS) {
        const overflow = pending.length - LOG_MAX_PENDING_CHUNKS
        pending.splice(0, overflow)
        dropped += overflow
      }
    })
    stream.on('error', (error: Error) => {
      callbacks.onError(fromDockerError(error, 'Reading the log stream').message)
    })
    stream.on('end', () => {
      pending.push(...assembler.flush())
      flush()
      clearInterval(timer)
      callbacks.onEnd('The container log stream ended.')
      this.streams.delete(id)
    })

    const stop = (): void => {
      clearInterval(timer)
      flush()
      stream.destroy()
      this.streams.delete(id)
    }
    this.streams.set(id, stop)
    return { id, stop }
  }

  async collectLogs(options: LogStreamOptions): Promise<LogChunk[]> {
    const tty = await this.hasTty(options.containerId)
    try {
      const buffer = (await this.docker.getContainer(options.containerId).logs({
        follow: false,
        stdout: true,
        stderr: true,
        tail: options.tail,
        timestamps: options.timestamps,
        ...(options.sinceSeconds
          ? { since: Math.floor(Date.now() / 1000) - options.sinceSeconds }
          : {})
      })) as unknown as Buffer
      const assembler = new LogAssembler(tty)
      return [...assembler.push(Buffer.from(buffer)), ...assembler.flush()]
    } catch (error) {
      throw fromDockerError(error, 'Exporting container logs')
    }
  }

  // ------------------------------------------------------------------ exec

  /** Probes candidate shells with a throwaway exec so failures are explicit. */
  private async resolveShell(containerId: string, candidates: string[]): Promise<string> {
    const container = this.docker.getContainer(containerId)
    for (const candidate of candidates) {
      try {
        const probe = await container.exec({
          Cmd: [candidate, '-c', 'exit 0'],
          AttachStdout: false,
          AttachStderr: false
        })
        await probe.start({ Detach: false, hijack: false })
        // Give Docker a moment to reap the process before inspecting.
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const info: any = await probe.inspect()
          if (info?.Running === false) {
            if (info?.ExitCode === 0) return candidate
            break
          }
          await delay(50)
        }
      } catch (error) {
        logger.debug('docker', `Shell probe failed for ${candidate}`, error)
      }
    }
    throw new HarborlightError('not-found', 'No usable shell was found in this container.', {
      hint: `Tried ${candidates.join(', ')}. Distroless and scratch images often ship no shell; use "docker cp" or a debug sidecar instead.`
    })
  }

  async startExec(options: ExecStartOptions, callbacks: ExecCallbacks): Promise<ExecHandle> {
    const candidates = options.shell ? [options.shell] : options.shellCandidates
    const shell = await this.resolveShell(options.containerId, candidates)
    const container = this.docker.getContainer(options.containerId)

    let exec: Docker.Exec
    let stream: Duplex
    try {
      exec = await container.exec({
        Cmd: [shell],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        ...(options.user ? { User: options.user } : {}),
        ...(options.workingDir ? { WorkingDir: options.workingDir } : {})
      })
      stream = (await exec.start({ hijack: true, stdin: true, Tty: true })) as unknown as Duplex
    } catch (error) {
      throw fromDockerError(error, 'Starting the interactive session')
    }

    const id = randomUUID()
    let closed = false

    stream.on('data', (data: Buffer) => callbacks.onData(data.toString('utf8')))
    stream.on('error', (error: Error) => {
      if (!closed) callbacks.onExit(null, `The session ended with an error: ${error.message}`)
      closed = true
      this.streams.delete(id)
    })
    stream.on('end', () => {
      if (closed) return
      closed = true
      void exec
        .inspect()
        .then((info: any) => {
          const code = typeof info?.ExitCode === 'number' ? info.ExitCode : null
          callbacks.onExit(
            code,
            code === 0 ? 'Session closed.' : `Session closed with exit code ${code ?? '?'}.`
          )
        })
        .catch(() => callbacks.onExit(null, 'Session closed.'))
      this.streams.delete(id)
    })

    try {
      await exec.resize({ h: options.rows, w: options.cols })
    } catch (error) {
      logger.debug('docker', 'Initial exec resize failed', error)
    }

    const handle: ExecHandle = {
      id,
      shell,
      user: options.user ?? '',
      workingDir: options.workingDir ?? '',
      write: (data: string) => {
        if (!closed) stream.write(data)
      },
      resize: (cols: number, rows: number) => {
        void exec.resize({ h: rows, w: cols }).catch((error: unknown) => {
          logger.debug('docker', 'Exec resize failed', error)
        })
      },
      stop: () => {
        closed = true
        stream.end()
        stream.destroy()
        this.streams.delete(id)
      }
    }
    this.streams.set(id, handle.stop)
    return handle
  }

  // ---------------------------------------------------------------- images

  async listImages(): Promise<ImageSummary[]> {
    try {
      const [images, containers] = await Promise.all([
        this.docker.listImages(),
        this.docker.listContainers({ all: true })
      ])
      const usage = new Map<string, number>()
      for (const container of containers) {
        const key = String(container.ImageID ?? '')
        usage.set(key, (usage.get(key) ?? 0) + 1)
      }
      return images
        .map((image) => normalizeImage(image, usage.get(String(image.Id)) ?? 0))
        .sort((a, b) => b.size - a.size)
    } catch (error) {
      throw fromDockerError(error, 'Listing images')
    }
  }

  async inspectImage(id: string): Promise<{ raw: string; usedBy: { id: string; name: string }[] }> {
    try {
      const raw: any = await this.docker.getImage(id).inspect()
      const containers = await this.docker.listContainers({ all: true })
      const usedBy = containers
        .filter((container) => container.ImageID === raw?.Id || container.Image === id)
        .map((container) => ({
          id: String(container.Id),
          name: String(container.Names?.[0] ?? '').replace(/^\//, '')
        }))
      return { raw: JSON.stringify(raw, null, 2), usedBy }
    } catch (error) {
      throw fromDockerError(error, `Inspecting image ${shortId(id)}`)
    }
  }

  async imageHistory(id: string): Promise<ImageLayer[]> {
    try {
      const history: any[] = await this.docker.getImage(id).history()
      return history.map((entry) => ({
        id: String(entry?.Id ?? '<missing>'),
        createdAt: new Date(Number(entry?.Created ?? 0) * 1000).toISOString(),
        createdBy: String(entry?.CreatedBy ?? ''),
        size: Number(entry?.Size ?? 0),
        comment: String(entry?.Comment ?? ''),
        tags: Array.isArray(entry?.Tags) ? entry.Tags.map(String) : []
      }))
    } catch (error) {
      throw fromDockerError(error, `Reading image history for ${shortId(id)}`)
    }
  }

  async pullImage(
    reference: string,
    auth: { username: string; password: string; serveraddress: string } | null,
    onProgress: (progress: PullProgress) => void,
    signal: AbortSignal
  ): Promise<void> {
    const stream = await new Promise<Readable>((resolve, reject) => {
      this.docker.pull(reference, auth ? { authconfig: auth } : {}, (error, result) => {
        if (error || !result) reject(fromDockerError(error, `Pulling ${reference}`))
        else resolve(result as unknown as Readable)
      })
    })

    return new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        stream.destroy()
        reject(new HarborlightError('cancelled', `Pull of ${reference} was cancelled.`))
      }
      signal.addEventListener('abort', abort, { once: true })

      this.docker.modem.followProgress(
        stream,
        (error: Error | null) => {
          signal.removeEventListener('abort', abort)
          if (error) reject(fromDockerError(error, `Pulling ${reference}`))
          else resolve()
        },
        (event: any) => {
          const current =
            typeof event?.progressDetail?.current === 'number' ? event.progressDetail.current : null
          const total =
            typeof event?.progressDetail?.total === 'number' ? event.progressDetail.total : null
          onProgress({
            layerId: event?.id ? String(event.id) : null,
            status: String(event?.status ?? ''),
            current,
            total,
            percent: current !== null && total ? Math.round((current / total) * 100) : null
          })
        }
      )
    })
  }

  async removeImage(
    id: string,
    options: { force: boolean; pruneChildren: boolean }
  ): Promise<void> {
    try {
      await this.docker
        .getImage(id)
        .remove({ force: options.force, noprune: !options.pruneChildren })
    } catch (error) {
      throw fromDockerError(error, `Removing image ${shortId(id)}`)
    }
  }

  async tagImage(id: string, reference: string): Promise<void> {
    const separator = reference.lastIndexOf(':')
    const slash = reference.lastIndexOf('/')
    const repo = separator > slash ? reference.slice(0, separator) : reference
    const tag = separator > slash ? reference.slice(separator + 1) : 'latest'
    try {
      await this.docker.getImage(id).tag({ repo, tag })
    } catch (error) {
      throw fromDockerError(error, `Tagging image ${shortId(id)}`)
    }
  }

  // --------------------------------------------------------------- volumes

  async listVolumes(): Promise<VolumeSummary[]> {
    try {
      const [result, containers, usage] = await Promise.all([
        this.docker.listVolumes(),
        this.docker.listContainers({ all: true }),
        this.safeDf()
      ])
      const sizes = new Map<string, number>()
      for (const volume of usage?.Volumes ?? []) {
        const size = Number(volume?.UsageData?.Size ?? -1)
        if (size >= 0) sizes.set(String(volume?.Name), size)
      }
      const attachments = new Map<string, { id: string; name: string }[]>()
      for (const container of containers) {
        for (const mount of container.Mounts ?? []) {
          if (mount.Type !== 'volume' || !mount.Name) continue
          const list = attachments.get(mount.Name) ?? []
          list.push({
            id: String(container.Id),
            name: String(container.Names?.[0] ?? '').replace(/^\//, '')
          })
          attachments.set(mount.Name, list)
        }
      }
      return (result?.Volumes ?? [])
        .map((volume: any) =>
          normalizeVolume(
            volume,
            attachments.get(String(volume?.Name)) ?? [],
            sizes.get(String(volume?.Name)) ?? null
          )
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch (error) {
      throw fromDockerError(error, 'Listing volumes')
    }
  }

  async inspectVolume(name: string): Promise<{ raw: string }> {
    try {
      const raw = await this.docker.getVolume(name).inspect()
      return { raw: JSON.stringify(raw, null, 2) }
    } catch (error) {
      throw fromDockerError(error, `Inspecting volume ${name}`)
    }
  }

  async removeVolume(name: string, force: boolean): Promise<void> {
    try {
      await this.docker.getVolume(name).remove({ force })
    } catch (error) {
      throw fromDockerError(error, `Removing volume ${name}`)
    }
  }

  // -------------------------------------------------------------- networks

  async listNetworks(): Promise<NetworkSummary[]> {
    try {
      const [networks, containers] = await Promise.all([
        this.docker.listNetworks(),
        this.docker.listContainers({ all: true })
      ])
      const attachments = new Map<string, NetworkSummary['containers']>()
      for (const container of containers) {
        for (const [networkName, settings] of Object.entries<any>(
          container.NetworkSettings?.Networks ?? {}
        )) {
          const list = attachments.get(networkName) ?? []
          list.push({
            id: String(container.Id),
            name: String(container.Names?.[0] ?? '').replace(/^\//, ''),
            ipv4Address: String(settings?.IPAddress ?? ''),
            macAddress: String(settings?.MacAddress ?? '')
          })
          attachments.set(networkName, list)
        }
      }
      return networks
        .map((network: any) =>
          normalizeNetwork(network, attachments.get(String(network?.Name)) ?? [])
        )
        .sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name))
    } catch (error) {
      throw fromDockerError(error, 'Listing networks')
    }
  }

  async inspectNetwork(id: string): Promise<{ raw: string }> {
    try {
      const raw = await this.docker.getNetwork(id).inspect()
      return { raw: JSON.stringify(raw, null, 2) }
    } catch (error) {
      throw fromDockerError(error, `Inspecting network ${shortId(id)}`)
    }
  }

  async removeNetwork(id: string): Promise<void> {
    try {
      await this.docker.getNetwork(id).remove()
    } catch (error) {
      throw fromDockerError(error, `Removing network ${shortId(id)}`)
    }
  }

  // ------------------------------------------------------------ disk usage

  private async safeDf(): Promise<any | null> {
    try {
      return await this.docker.df()
    } catch (error) {
      logger.warn('docker', 'docker df failed', error)
      return null
    }
  }

  async diskUsage(): Promise<DiskUsage> {
    const df = await this.safeDf()
    if (!df) throw new HarborlightError('engine-unavailable', 'Docker did not report disk usage.')

    const images: any[] = df.Images ?? []
    const containers: any[] = df.Containers ?? []
    const volumes: any[] = df.Volumes ?? []
    const buildCache: any[] = df.BuildCache ?? []

    const imagesSize = images.reduce((sum, image) => sum + Number(image?.Size ?? 0), 0)
    const imagesReclaimable = images
      .filter((image) => Number(image?.Containers ?? 0) <= 0)
      .reduce((sum, image) => sum + Number(image?.Size ?? 0), 0)

    const containersSize = containers.reduce(
      (sum, container) => sum + Number(container?.SizeRw ?? 0),
      0
    )
    const containersReclaimable = containers
      .filter((container) => String(container?.State ?? '') !== 'running')
      .reduce((sum, container) => sum + Number(container?.SizeRw ?? 0), 0)

    const volumesSize = volumes.reduce(
      (sum, volume) => sum + Math.max(0, Number(volume?.UsageData?.Size ?? 0)),
      0
    )
    const volumesReclaimable = volumes
      .filter((volume) => Number(volume?.UsageData?.RefCount ?? 0) <= 0)
      .reduce((sum, volume) => sum + Math.max(0, Number(volume?.UsageData?.Size ?? 0)), 0)

    const buildCacheSize = buildCache.reduce((sum, entry) => sum + Number(entry?.Size ?? 0), 0)
    const buildCacheReclaimable = buildCache
      .filter((entry) => !entry?.InUse)
      .reduce((sum, entry) => sum + Number(entry?.Size ?? 0), 0)

    return {
      layersSize: Number(df?.LayersSize ?? 0),
      images: { count: images.length, size: imagesSize, reclaimable: imagesReclaimable },
      containers: {
        count: containers.length,
        size: containersSize,
        reclaimable: containersReclaimable
      },
      volumes: { count: volumes.length, size: volumesSize, reclaimable: volumesReclaimable },
      buildCache: {
        count: buildCache.length,
        size: buildCacheSize,
        reclaimable: buildCacheReclaimable
      }
    }
  }

  async prune(category: CleanupCategory): Promise<PruneOutcome> {
    try {
      switch (category) {
        case 'stoppedContainers': {
          const result: any = await this.docker.pruneContainers({})
          return {
            reclaimed: Number(result?.SpaceReclaimed ?? 0),
            removed: (result?.ContainersDeleted ?? []).map(String)
          }
        }
        case 'danglingImages': {
          const result: any = await this.docker.pruneImages({
            filters: JSON.stringify({ dangling: { true: true } })
          } as any)
          return {
            reclaimed: Number(result?.SpaceReclaimed ?? 0),
            removed: (result?.ImagesDeleted ?? []).map((entry: any) =>
              String(entry?.Deleted ?? entry?.Untagged ?? '')
            )
          }
        }
        case 'unusedImages': {
          const result: any = await this.docker.pruneImages({
            filters: JSON.stringify({ dangling: { false: true } })
          } as any)
          return {
            reclaimed: Number(result?.SpaceReclaimed ?? 0),
            removed: (result?.ImagesDeleted ?? []).map((entry: any) =>
              String(entry?.Deleted ?? entry?.Untagged ?? '')
            )
          }
        }
        case 'unusedNetworks': {
          const result: any = await this.docker.pruneNetworks({})
          return { reclaimed: 0, removed: (result?.NetworksDeleted ?? []).map(String) }
        }
        case 'buildCache': {
          const result: any = await this.docker.pruneBuilder()
          return {
            reclaimed: Number(result?.SpaceReclaimed ?? 0),
            removed: (result?.CachesDeleted ?? []).map(String)
          }
        }
        case 'unusedVolumes': {
          const result: any = await this.docker.pruneVolumes({})
          return {
            reclaimed: Number(result?.SpaceReclaimed ?? 0),
            removed: (result?.VolumesDeleted ?? []).map(String)
          }
        }
        default:
          throw new HarborlightError('validation', `Unknown cleanup category "${category}".`)
      }
    } catch (error) {
      throw fromDockerError(error, `Pruning ${category}`)
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
