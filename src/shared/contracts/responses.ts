import type {
  AppInfo,
  AppNotification,
  CleanupPlan,
  CleanupResult,
  ComposeProject,
  ComposeValidation,
  ContainerDetail,
  ContainerStats,
  ContainerSummary,
  DiskUsage,
  EngineStatus,
  ImageLayer,
  ImageSummary,
  NetworkSummary,
  PlatformInfo,
  RegistryEntry,
  ScanResult,
  SecureStorageStatus,
  Settings,
  SocketCandidate,
  Task,
  UpdateInfo,
  UsageSample,
  VolumeSummary
} from '../schemas/domain'
import type { CommandName } from './commands'

export interface ActionAck {
  ok: true
  message: string
}

export interface ComposeCommandPreview {
  program: string
  args: string[]
  cwd: string
  display: string
  destructive: boolean
}

export interface CommandResponseMap {
  'system.getAppInfo': AppInfo
  'system.getPlatformInfo': PlatformInfo
  'system.openExternal': ActionAck
  'system.checkForUpdates': UpdateInfo
  'system.exportDiagnostics': { path: string | null; cancelled: boolean }
  'system.listTasks': Task[]
  'system.cancelTask': ActionAck
  'system.pickComposeFile': { path: string | null; cancelled: boolean }
  'system.quit': ActionAck
  'system.minimizeToTray': ActionAck

  'settings.get': Settings
  'settings.update': Settings
  'settings.reset': Settings
  'settings.setTheme': Settings

  'engine.getStatus': EngineStatus
  'engine.reconnect': EngineStatus
  'engine.listSockets': SocketCandidate[]
  'engine.getDiskUsage': DiskUsage
  'engine.getUsageHistory': UsageSample[]

  'containers.list': ContainerSummary[]
  'containers.inspect': ContainerDetail
  'containers.stats': ContainerStats
  'containers.start': ActionAck
  'containers.stop': ActionAck
  'containers.restart': ActionAck
  'containers.pause': ActionAck
  'containers.unpause': ActionAck
  'containers.kill': ActionAck
  'containers.rename': ActionAck
  'containers.remove': ActionAck
  'containers.run': { id: string; name: string }

  'logs.start': { streamId: string }
  'logs.stop': ActionAck
  'logs.export': { path: string | null; cancelled: boolean; lines: number }

  'exec.start': {
    sessionId: string
    shell: string
    user: string
    workingDir: string
    warnRoot: boolean
  }
  'exec.write': ActionAck
  'exec.resize': ActionAck
  'exec.stop': ActionAck

  'images.list': ImageSummary[]
  'images.inspect': { raw: string; usedBy: { id: string; name: string }[] }
  'images.history': ImageLayer[]
  'images.pull': { taskId: string }
  'images.remove': ActionAck
  'images.tag': ActionAck
  'images.scan': ScanResult
  'images.scanAvailability': { available: boolean; version: string | null; reason: string | null }

  'volumes.list': VolumeSummary[]
  'volumes.inspect': { raw: string }
  'volumes.remove': ActionAck

  'networks.list': NetworkSummary[]
  'networks.inspect': { raw: string }
  'networks.remove': ActionAck

  'cleanup.analyze': CleanupPlan
  'cleanup.run': CleanupResult

  'compose.discover': ComposeProject[]
  'compose.openFile': { path: string; content: string; project: ComposeProject }
  'compose.readFile': { path: string; content: string }
  'compose.saveFile': ActionAck
  'compose.validate': ComposeValidation
  'compose.action': { operationId: string }
  'compose.preview': ComposeCommandPreview
  'compose.cancel': ActionAck

  'registry.status': SecureStorageStatus
  'registry.list': RegistryEntry[]
  'registry.add': RegistryEntry
  'registry.remove': ActionAck
  'registry.login': RegistryEntry
  'registry.logout': RegistryEntry
}

export type CommandResult<K extends CommandName> = CommandResponseMap[K]

/** Structured failure returned to the renderer instead of a raw Error. */
export interface HarborlightErrorPayload {
  code:
    | 'unknown'
    | 'validation'
    | 'not-allowed'
    | 'engine-unavailable'
    | 'permission-denied'
    | 'not-found'
    | 'conflict'
    | 'timeout'
    | 'cancelled'
    | 'unsupported'
  message: string
  hint: string | null
  details: string | null
}

export type IpcResponse<K extends CommandName> =
  { ok: true; data: CommandResult<K> } | { ok: false; error: HarborlightErrorPayload }

export interface AppEventMap {
  'engine:status': EngineStatus
  'engine:usage': UsageSample
  'task:update': Task
  notification: AppNotification
  'logs:data': { streamId: string; chunk: LogChunk[] }
  'logs:error': { streamId: string; message: string }
  'logs:end': { streamId: string; reason: string }
  'exec:data': { sessionId: string; data: string }
  'exec:exit': { sessionId: string; exitCode: number | null; message: string }
  'compose:output': { operationId: string; stream: 'stdout' | 'stderr'; data: string }
  'compose:exit': { operationId: string; exitCode: number | null; message: string }
  navigate: { to: string }
  'command-palette': { open: boolean }
  'settings:changed': Settings
}

export interface LogChunk {
  stream: 'stdout' | 'stderr'
  timestamp: string | null
  message: string
  sequence: number
}

export type AppEventName = keyof AppEventMap

export interface AppEvent<K extends AppEventName> {
  type: K
  payload: AppEventMap[K]
}

/**
 * Discriminated union over every event, so `switch (event.type)` narrows the
 * payload in the renderer.
 */
export type AppEventEnvelope = { [K in AppEventName]: AppEvent<K> }[AppEventName]
