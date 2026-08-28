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

export interface StreamHandle {
  readonly id: string
  stop(): void
}

export interface LogStreamOptions {
  containerId: string
  tail: number
  timestamps: boolean
  sinceSeconds: number | null
  follow: boolean
}

export interface LogStreamCallbacks {
  onChunk(chunks: LogChunk[]): void
  onError(message: string): void
  onEnd(reason: string): void
}

export interface ExecStartOptions {
  containerId: string
  shell: string | null
  user: string | null
  workingDir: string | null
  cols: number
  rows: number
  shellCandidates: string[]
}

export interface ExecCallbacks {
  onData(data: string): void
  onExit(exitCode: number | null, message: string): void
}

export interface ExecHandle extends StreamHandle {
  readonly shell: string
  readonly user: string
  readonly workingDir: string
  write(data: string): void
  resize(cols: number, rows: number): void
}

export interface PullProgress {
  layerId: string | null
  status: string
  current: number | null
  total: number | null
  percent: number | null
}

export interface PruneOutcome {
  reclaimed: number
  removed: string[]
}

/**
 * The single abstraction the rest of the application programs against.
 *
 * `DockerEngineAdapter` speaks to a local Docker Engine over a UNIX socket and
 * `MockEngineAdapter` returns deterministic fixtures. A future remote adapter
 * only has to satisfy this interface — nothing above it knows about Dockerode.
 */
export interface ContainerEngine {
  readonly kind: 'docker' | 'mock'
  readonly socketPath: string

  getStatus(): Promise<EngineStatus>
  dispose(): Promise<void>

  listContainers(all: boolean): Promise<ContainerSummary[]>
  inspectContainer(id: string, redactEnv: boolean): Promise<ContainerDetail>
  containerStats(id: string): Promise<ContainerStats>
  startContainer(id: string): Promise<void>
  stopContainer(id: string, timeoutSeconds: number): Promise<void>
  restartContainer(id: string, timeoutSeconds: number): Promise<void>
  pauseContainer(id: string): Promise<void>
  unpauseContainer(id: string): Promise<void>
  killContainer(id: string, signal: string): Promise<void>
  renameContainer(id: string, name: string): Promise<void>
  removeContainer(id: string, options: { force: boolean; removeVolumes: boolean }): Promise<void>
  runContainer(spec: CommandPayload<'containers.run'>): Promise<{ id: string; name: string }>

  streamLogs(options: LogStreamOptions, callbacks: LogStreamCallbacks): Promise<StreamHandle>
  collectLogs(options: LogStreamOptions): Promise<LogChunk[]>
  startExec(options: ExecStartOptions, callbacks: ExecCallbacks): Promise<ExecHandle>

  listImages(): Promise<ImageSummary[]>
  inspectImage(id: string): Promise<{ raw: string; usedBy: { id: string; name: string }[] }>
  imageHistory(id: string): Promise<ImageLayer[]>
  pullImage(
    reference: string,
    auth: { username: string; password: string; serveraddress: string } | null,
    onProgress: (progress: PullProgress) => void,
    signal: AbortSignal
  ): Promise<void>
  removeImage(id: string, options: { force: boolean; pruneChildren: boolean }): Promise<void>
  tagImage(id: string, reference: string): Promise<void>

  listVolumes(): Promise<VolumeSummary[]>
  inspectVolume(name: string): Promise<{ raw: string }>
  removeVolume(name: string, force: boolean): Promise<void>

  listNetworks(): Promise<NetworkSummary[]>
  inspectNetwork(id: string): Promise<{ raw: string }>
  removeNetwork(id: string): Promise<void>

  diskUsage(): Promise<DiskUsage>
  prune(category: CleanupCategory): Promise<PruneOutcome>
}
