import { z } from 'zod'

/**
 * Domain schemas shared by the Electron main process and the renderer.
 *
 * These describe *normalized* Harborlight objects, never raw Docker payloads.
 * Normalization happens in the engine adapters so the UI never depends on the
 * shape of the Docker Engine API.
 */

export const containerStateSchema = z.enum([
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead'
])
export type ContainerState = z.infer<typeof containerStateSchema>

export const healthStateSchema = z.enum(['healthy', 'unhealthy', 'starting', 'none'])
export type HealthState = z.infer<typeof healthStateSchema>

export const portBindingSchema = z.object({
  privatePort: z.number(),
  publicPort: z.number().optional(),
  type: z.string(),
  hostIp: z.string().optional()
})
export type PortBinding = z.infer<typeof portBindingSchema>

export const mountSchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  source: z.string(),
  destination: z.string(),
  mode: z.string(),
  rw: z.boolean()
})
export type Mount = z.infer<typeof mountSchema>

export const envVarSchema = z.object({
  key: z.string(),
  value: z.string(),
  redacted: z.boolean()
})
export type EnvVar = z.infer<typeof envVarSchema>

export const containerSummarySchema = z.object({
  id: z.string(),
  shortId: z.string(),
  name: z.string(),
  names: z.array(z.string()),
  image: z.string(),
  imageId: z.string(),
  command: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  state: containerStateSchema,
  status: z.string(),
  health: healthStateSchema,
  ports: z.array(portBindingSchema),
  networks: z.array(z.string()),
  labels: z.record(z.string(), z.string()),
  composeProject: z.string().nullable(),
  composeService: z.string().nullable(),
  /**
   * Derived from the Docker status string in list views ("Up 6 hours"), and
   * from `State.StartedAt` in the details drawer, which is exact.
   */
  uptimeSeconds: z.number().nullable(),
  exitCode: z.number().nullable()
})
export type ContainerSummary = z.infer<typeof containerSummarySchema>

export const healthCheckLogSchema = z.object({
  start: z.string(),
  end: z.string(),
  exitCode: z.number(),
  output: z.string()
})

export const containerDetailSchema = containerSummarySchema.extend({
  restartPolicy: z.string(),
  env: z.array(envVarSchema),
  mounts: z.array(mountSchema),
  workingDir: z.string(),
  user: z.string(),
  entrypoint: z.array(z.string()),
  args: z.array(z.string()),
  restartCount: z.number(),
  platform: z.string(),
  logPath: z.string(),
  networkDetails: z.array(
    z.object({
      name: z.string(),
      ipAddress: z.string(),
      gateway: z.string(),
      macAddress: z.string(),
      aliases: z.array(z.string())
    })
  ),
  healthCheck: z
    .object({
      test: z.array(z.string()),
      intervalSeconds: z.number().nullable(),
      timeoutSeconds: z.number().nullable(),
      retries: z.number().nullable(),
      failingStreak: z.number(),
      log: z.array(healthCheckLogSchema)
    })
    .nullable()
})
export type ContainerDetail = z.infer<typeof containerDetailSchema>

export const containerStatsSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  cpuPercent: z.number(),
  memoryUsage: z.number(),
  memoryLimit: z.number(),
  memoryPercent: z.number(),
  networkRx: z.number(),
  networkTx: z.number(),
  blockRead: z.number(),
  blockWrite: z.number(),
  pids: z.number()
})
export type ContainerStats = z.infer<typeof containerStatsSchema>

export const imageSummarySchema = z.object({
  id: z.string(),
  shortId: z.string(),
  repository: z.string(),
  tag: z.string(),
  reference: z.string(),
  repoTags: z.array(z.string()),
  digest: z.string().nullable(),
  createdAt: z.string(),
  size: z.number(),
  sharedSize: z.number(),
  containers: z.number(),
  dangling: z.boolean(),
  unused: z.boolean(),
  labels: z.record(z.string(), z.string())
})
export type ImageSummary = z.infer<typeof imageSummarySchema>

export const imageLayerSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  size: z.number(),
  comment: z.string(),
  tags: z.array(z.string())
})
export type ImageLayer = z.infer<typeof imageLayerSchema>

export const volumeSummarySchema = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
  createdAt: z.string().nullable(),
  scope: z.string(),
  labels: z.record(z.string(), z.string()),
  size: z.number().nullable(),
  refCount: z.number().nullable(),
  inUse: z.boolean(),
  containers: z.array(z.object({ id: z.string(), name: z.string() })),
  composeProject: z.string().nullable()
})
export type VolumeSummary = z.infer<typeof volumeSummarySchema>

export const networkSummarySchema = z.object({
  id: z.string(),
  shortId: z.string(),
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
  internal: z.boolean(),
  attachable: z.boolean(),
  ipv6: z.boolean(),
  createdAt: z.string().nullable(),
  subnets: z.array(z.object({ subnet: z.string(), gateway: z.string() })),
  labels: z.record(z.string(), z.string()),
  containers: z.array(
    z.object({ id: z.string(), name: z.string(), ipv4Address: z.string(), macAddress: z.string() })
  ),
  system: z.boolean(),
  inUse: z.boolean(),
  composeProject: z.string().nullable()
})
export type NetworkSummary = z.infer<typeof networkSummarySchema>

export const engineStatusSchema = z.object({
  connected: z.boolean(),
  adapter: z.enum(['docker', 'mock']),
  socketPath: z.string(),
  rootless: z.boolean(),
  version: z.string().nullable(),
  apiVersion: z.string().nullable(),
  os: z.string().nullable(),
  kernelVersion: z.string().nullable(),
  architecture: z.string().nullable(),
  cpus: z.number().nullable(),
  memoryTotal: z.number().nullable(),
  containersRunning: z.number().nullable(),
  containersStopped: z.number().nullable(),
  containersPaused: z.number().nullable(),
  images: z.number().nullable(),
  error: z.string().nullable(),
  errorHint: z.string().nullable(),
  checkedAt: z.string()
})
export type EngineStatus = z.infer<typeof engineStatusSchema>

export const diskUsageSchema = z.object({
  layersSize: z.number(),
  images: z.object({ count: z.number(), size: z.number(), reclaimable: z.number() }),
  containers: z.object({ count: z.number(), size: z.number(), reclaimable: z.number() }),
  volumes: z.object({ count: z.number(), size: z.number(), reclaimable: z.number() }),
  buildCache: z.object({ count: z.number(), size: z.number(), reclaimable: z.number() })
})
export type DiskUsage = z.infer<typeof diskUsageSchema>

export const cleanupCategorySchema = z.enum([
  'stoppedContainers',
  'danglingImages',
  'unusedImages',
  'unusedNetworks',
  'buildCache',
  'unusedVolumes'
])
export type CleanupCategory = z.infer<typeof cleanupCategorySchema>

export const cleanupItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string(),
  size: z.number()
})

export const cleanupPlanSchema = z.object({
  generatedAt: z.string(),
  categories: z.array(
    z.object({
      category: cleanupCategorySchema,
      title: z.string(),
      description: z.string(),
      dangerous: z.boolean(),
      defaultSelected: z.boolean(),
      reclaimable: z.number(),
      items: z.array(cleanupItemSchema)
    })
  ),
  totalReclaimable: z.number()
})
export type CleanupPlan = z.infer<typeof cleanupPlanSchema>

export const cleanupResultSchema = z.object({
  dryRun: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string(),
  reclaimed: z.number(),
  entries: z.array(
    z.object({
      category: cleanupCategorySchema,
      status: z.enum(['succeeded', 'skipped', 'failed']),
      message: z.string(),
      reclaimed: z.number(),
      removed: z.array(z.string())
    })
  )
})
export type CleanupResult = z.infer<typeof cleanupResultSchema>

export const composeServiceSchema = z.object({
  name: z.string(),
  image: z.string().nullable(),
  build: z.string().nullable(),
  containerName: z.string().nullable(),
  ports: z.array(z.string()),
  dependsOn: z.array(z.string()),
  networks: z.array(z.string()),
  volumes: z.array(z.string()),
  environmentKeys: z.array(z.string()),
  replicas: z.number(),
  state: containerStateSchema.nullable(),
  health: healthStateSchema,
  containers: z.array(z.object({ id: z.string(), name: z.string(), state: containerStateSchema }))
})
export type ComposeService = z.infer<typeof composeServiceSchema>

export const composeProjectSchema = z.object({
  name: z.string(),
  workingDir: z.string().nullable(),
  configFiles: z.array(z.string()),
  source: z.enum(['running', 'opened']),
  running: z.number(),
  total: z.number(),
  services: z.array(composeServiceSchema),
  networks: z.array(z.string()),
  volumes: z.array(z.string())
})
export type ComposeProject = z.infer<typeof composeProjectSchema>

export const composeValidationSchema = z.object({
  valid: z.boolean(),
  message: z.string(),
  normalized: z.string().nullable(),
  problems: z.array(
    z.object({
      line: z.number().nullable(),
      column: z.number().nullable(),
      severity: z.enum(['error', 'warning']),
      message: z.string()
    })
  )
})
export type ComposeValidation = z.infer<typeof composeValidationSchema>

export const registryKindSchema = z.enum(['dockerhub', 'ghcr', 'custom'])
export type RegistryKind = z.infer<typeof registryKindSchema>

export const registryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: registryKindSchema,
  serverAddress: z.string(),
  username: z.string().nullable(),
  hasCredentials: z.boolean(),
  lastLoginAt: z.string().nullable()
})
export type RegistryEntry = z.infer<typeof registryEntrySchema>

export const secureStorageStatusSchema = z.object({
  available: z.boolean(),
  backend: z.string(),
  reason: z.string().nullable()
})
export type SecureStorageStatus = z.infer<typeof secureStorageStatusSchema>

export const themeSchema = z.enum(['light', 'dark', 'system'])
export type ThemePreference = z.infer<typeof themeSchema>

export const logLevelFilterSchema = z.enum(['all', 'error', 'warn', 'info', 'debug'])
export type LogLevelFilter = z.infer<typeof logLevelFilterSchema>

export const settingsSchema = z.object({
  theme: themeSchema,
  dockerSocket: z.string(),
  useCustomSocket: z.boolean(),
  engineMode: z.enum(['docker', 'mock']),
  pollIntervalMs: z.number().int().min(1000).max(60_000),
  logTailLines: z.number().int().min(50).max(20_000),
  logTimestamps: z.boolean(),
  logWordWrap: z.boolean(),
  defaultShell: z.string(),
  closeToTray: z.boolean(),
  startAtLogin: z.boolean(),
  startMinimized: z.boolean(),
  desktopNotifications: z.boolean(),
  updateChannel: z.enum(['stable', 'beta']),
  confirmDestructive: z.boolean(),
  redactEnvSecrets: z.boolean()
})
export type Settings = z.infer<typeof settingsSchema>

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  gitSha: z.string(),
  dirty: z.boolean(),
  channel: z.enum(['stable', 'beta']),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  packaged: z.boolean(),
  installKind: z.enum(['deb', 'appimage', 'development', 'unknown']),
  buildDate: z.string()
})
export type AppInfo = z.infer<typeof appInfoSchema>

export const platformInfoSchema = z.object({
  distroId: z.string(),
  distroName: z.string(),
  versionId: z.string(),
  supported: z.boolean(),
  sessionType: z.string(),
  desktop: z.string(),
  architecture: z.string(),
  kernel: z.string(),
  isRoot: z.boolean(),
  inDockerGroup: z.boolean(),
  trayLikelySupported: z.boolean()
})
export type PlatformInfo = z.infer<typeof platformInfoSchema>

export const taskStatusSchema = z.enum(['running', 'succeeded', 'failed', 'cancelled'])

export const taskSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  detail: z.string(),
  status: taskStatusSchema,
  progress: z.number().nullable(),
  cancellable: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable()
})
export type Task = z.infer<typeof taskSchema>

export const notificationSchema = z.object({
  id: z.string(),
  level: z.enum(['info', 'success', 'warning', 'error']),
  title: z.string(),
  message: z.string(),
  hint: z.string().nullable(),
  createdAt: z.string()
})
export type AppNotification = z.infer<typeof notificationSchema>

export const usageSampleSchema = z.object({
  timestamp: z.string(),
  cpuPercent: z.number(),
  memoryBytes: z.number(),
  diskBytes: z.number()
})
export type UsageSample = z.infer<typeof usageSampleSchema>

export const socketCandidateSchema = z.object({
  path: z.string(),
  label: z.string(),
  exists: z.boolean(),
  readable: z.boolean(),
  rootless: z.boolean()
})
export type SocketCandidate = z.infer<typeof socketCandidateSchema>

export const updateInfoSchema = z.object({
  checkedAt: z.string(),
  channel: z.enum(['stable', 'beta']),
  currentVersion: z.string(),
  latestVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  releaseUrl: z.string().nullable(),
  message: z.string()
})
export type UpdateInfo = z.infer<typeof updateInfoSchema>

export const scanFindingSchema = z.object({
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']),
  id: z.string(),
  package: z.string(),
  installedVersion: z.string(),
  fixedVersion: z.string().nullable(),
  title: z.string()
})

export const scanResultSchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  scannedAt: z.string().nullable(),
  reference: z.string(),
  counts: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    unknown: z.number()
  }),
  findings: z.array(scanFindingSchema)
})
export type ScanResult = z.infer<typeof scanResultSchema>
