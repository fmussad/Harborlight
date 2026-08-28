import type {
  ContainerDetail,
  ContainerState,
  ContainerStats,
  ContainerSummary,
  HealthState,
  ImageSummary,
  Mount,
  NetworkSummary,
  PortBinding,
  VolumeSummary
} from '@shared/schemas/domain'
import { redactEnvEntry } from '@shared/utils/redact'

/**
 * Pure translation from Docker Engine API payloads to Harborlight domain
 * objects. Keeping it free of I/O makes every rule here unit-testable and
 * guarantees the renderer never sees a raw Docker shape.
 */

/* eslint-disable @typescript-eslint/no-explicit-any --
 * The Docker Engine API is loosely typed and version-dependent; the whole point
 * of this module is to turn those `any`s into checked domain objects. Access is
 * defensive (optional chaining + fallbacks) and the output is fully typed. */

const KNOWN_STATES: ContainerState[] = [
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead'
]

export function toContainerState(value: string | undefined): ContainerState {
  const normalized = (value ?? '').toLowerCase()
  return KNOWN_STATES.includes(normalized as ContainerState)
    ? (normalized as ContainerState)
    : 'dead'
}

export function healthFromStatus(status: string | undefined): HealthState {
  const value = (status ?? '').toLowerCase()
  if (value.includes('(healthy)')) return 'healthy'
  if (value.includes('(unhealthy)')) return 'unhealthy'
  if (value.includes('health: starting')) return 'starting'
  return 'none'
}

const DURATION_UNITS: { pattern: RegExp; seconds: number }[] = [
  { pattern: /(\d+)\s*second/, seconds: 1 },
  { pattern: /(\d+)\s*minute/, seconds: 60 },
  { pattern: /(\d+)\s*hour/, seconds: 3600 },
  { pattern: /(\d+)\s*day/, seconds: 86_400 },
  { pattern: /(\d+)\s*week/, seconds: 604_800 },
  { pattern: /(\d+)\s*month/, seconds: 2_592_000 },
  { pattern: /(\d+)\s*year/, seconds: 31_536_000 }
]

/**
 * Docker's list endpoint only exposes a human status such as "Up 6 hours".
 * The exact start time requires an inspect call, so list views reuse Docker's
 * own coarse value instead of inventing one.
 */
export function parseUptimeFromStatus(status: string | undefined): number | null {
  if (!status) return null
  const value = status.toLowerCase()
  if (!value.startsWith('up')) return null
  if (value.includes('less than a second')) return 0
  for (const { pattern, seconds } of DURATION_UNITS) {
    const match = value.match(pattern)
    if (match?.[1]) return Number.parseInt(match[1], 10) * seconds
  }
  return null
}

export function parseExitCodeFromStatus(status: string | undefined): number | null {
  const match = (status ?? '').match(/exited \((\d+)\)/i)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}

export function normalizePorts(ports: any[] | undefined): PortBinding[] {
  if (!Array.isArray(ports)) return []
  const seen = new Set<string>()
  const result: PortBinding[] = []
  for (const port of ports) {
    const privatePort = Number(port?.PrivatePort ?? 0)
    if (!privatePort) continue
    const publicPort = port?.PublicPort ? Number(port.PublicPort) : undefined
    const type = String(port?.Type ?? 'tcp')
    const key = `${publicPort ?? ''}:${privatePort}/${type}`
    if (seen.has(key)) continue
    seen.add(key)
    const binding: PortBinding = { privatePort, type }
    if (publicPort !== undefined) binding.publicPort = publicPort
    const hostIp = typeof port?.IP === 'string' ? port.IP : undefined
    if (hostIp) binding.hostIp = hostIp
    result.push(binding)
  }
  return result.sort((a, b) => (a.publicPort ?? a.privatePort) - (b.publicPort ?? b.privatePort))
}

function toIsoFromUnix(seconds: number | undefined): string {
  if (!seconds || Number.isNaN(seconds)) return new Date(0).toISOString()
  return new Date(seconds * 1000).toISOString()
}

function stripLeadingSlash(name: string): string {
  return name.startsWith('/') ? name.slice(1) : name
}

export function shortId(id: string, length = 12): string {
  return (id.startsWith('sha256:') ? id.slice(7) : id).slice(0, length)
}

export function normalizeContainerSummary(info: any): ContainerSummary {
  const names: string[] = Array.isArray(info?.Names) ? info.Names.map(stripLeadingSlash) : []
  const labels: Record<string, string> = { ...(info?.Labels ?? {}) }
  const status = String(info?.Status ?? '')
  const state = toContainerState(info?.State)

  return {
    id: String(info?.Id ?? ''),
    shortId: shortId(String(info?.Id ?? '')),
    name: names[0] ?? shortId(String(info?.Id ?? '')),
    names,
    image: String(info?.Image ?? ''),
    imageId: String(info?.ImageID ?? ''),
    command: String(info?.Command ?? ''),
    createdAt: toIsoFromUnix(Number(info?.Created)),
    startedAt: null,
    state,
    status,
    health: healthFromStatus(status),
    ports: normalizePorts(info?.Ports),
    networks: Object.keys(info?.NetworkSettings?.Networks ?? {}),
    labels,
    composeProject: labels['com.docker.compose.project'] ?? null,
    composeService: labels['com.docker.compose.service'] ?? null,
    uptimeSeconds: state === 'running' ? parseUptimeFromStatus(status) : null,
    exitCode: parseExitCodeFromStatus(status)
  }
}

function normalizeMounts(mounts: any[] | undefined): Mount[] {
  if (!Array.isArray(mounts)) return []
  return mounts.map((mount) => ({
    type: String(mount?.Type ?? 'bind'),
    ...(mount?.Name ? { name: String(mount.Name) } : {}),
    source: String(mount?.Source ?? ''),
    destination: String(mount?.Destination ?? ''),
    mode: String(mount?.Mode ?? ''),
    rw: Boolean(mount?.RW)
  }))
}

export function normalizeContainerDetail(
  inspect: any,
  options: { redactEnv: boolean; now?: number } = { redactEnv: true }
): ContainerDetail {
  const now = options.now ?? Date.now()
  const labels: Record<string, string> = { ...(inspect?.Config?.Labels ?? {}) }
  const name = stripLeadingSlash(String(inspect?.Name ?? ''))
  const state = toContainerState(inspect?.State?.Status)
  const startedAt =
    inspect?.State?.StartedAt && !String(inspect.State.StartedAt).startsWith('0001')
      ? new Date(inspect.State.StartedAt).toISOString()
      : null
  const health = ((): HealthState => {
    const value = String(inspect?.State?.Health?.Status ?? '').toLowerCase()
    if (value === 'healthy' || value === 'unhealthy' || value === 'starting') return value
    return 'none'
  })()

  const ports: PortBinding[] = []
  const exposed = inspect?.NetworkSettings?.Ports ?? {}
  for (const [key, bindings] of Object.entries<any>(exposed)) {
    const [portPart, typePart] = key.split('/')
    const privatePort = Number.parseInt(portPart ?? '0', 10)
    if (!privatePort) continue
    if (Array.isArray(bindings) && bindings.length > 0) {
      for (const binding of bindings) {
        ports.push({
          privatePort,
          publicPort: Number.parseInt(String(binding?.HostPort ?? '0'), 10) || undefined,
          type: typePart ?? 'tcp',
          hostIp: binding?.HostIp || undefined
        } as PortBinding)
      }
    } else {
      ports.push({ privatePort, type: typePart ?? 'tcp' })
    }
  }

  const healthCheckConfig = inspect?.Config?.Healthcheck
  const nanosToSeconds = (value: unknown): number | null =>
    typeof value === 'number' && value > 0 ? Math.round(value / 1e9) : null

  return {
    id: String(inspect?.Id ?? ''),
    shortId: shortId(String(inspect?.Id ?? '')),
    name,
    names: [name],
    image: String(inspect?.Config?.Image ?? ''),
    imageId: String(inspect?.Image ?? ''),
    command: [inspect?.Path, ...(inspect?.Args ?? [])].filter(Boolean).join(' '),
    createdAt: inspect?.Created
      ? new Date(inspect.Created).toISOString()
      : new Date(0).toISOString(),
    startedAt,
    state,
    status: String(inspect?.State?.Status ?? ''),
    health,
    ports: normalizePorts(
      ports.map((port) => ({
        PrivatePort: port.privatePort,
        PublicPort: port.publicPort,
        Type: port.type,
        IP: port.hostIp
      }))
    ),
    networks: Object.keys(inspect?.NetworkSettings?.Networks ?? {}),
    labels,
    composeProject: labels['com.docker.compose.project'] ?? null,
    composeService: labels['com.docker.compose.service'] ?? null,
    uptimeSeconds:
      state === 'running' && startedAt
        ? Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000))
        : null,
    exitCode: typeof inspect?.State?.ExitCode === 'number' ? inspect.State.ExitCode : null,
    restartPolicy: String(inspect?.HostConfig?.RestartPolicy?.Name || 'no'),
    env: (Array.isArray(inspect?.Config?.Env) ? inspect.Config.Env : []).map((entry: string) =>
      redactEnvEntry(entry, options.redactEnv)
    ),
    mounts: normalizeMounts(inspect?.Mounts),
    workingDir: String(inspect?.Config?.WorkingDir ?? ''),
    user: String(inspect?.Config?.User ?? ''),
    entrypoint: toStringArray(inspect?.Config?.Entrypoint),
    args: toStringArray(inspect?.Args),
    restartCount: Number(inspect?.RestartCount ?? 0),
    platform: String(inspect?.Platform ?? ''),
    logPath: String(inspect?.LogPath ?? ''),
    networkDetails: Object.entries<any>(inspect?.NetworkSettings?.Networks ?? {}).map(
      ([networkName, value]) => ({
        name: networkName,
        ipAddress: String(value?.IPAddress ?? ''),
        gateway: String(value?.Gateway ?? ''),
        macAddress: String(value?.MacAddress ?? ''),
        aliases: toStringArray(value?.Aliases)
      })
    ),
    healthCheck: healthCheckConfig
      ? {
          test: toStringArray(healthCheckConfig?.Test),
          intervalSeconds: nanosToSeconds(healthCheckConfig?.Interval),
          timeoutSeconds: nanosToSeconds(healthCheckConfig?.Timeout),
          retries:
            typeof healthCheckConfig?.Retries === 'number' ? healthCheckConfig.Retries : null,
          failingStreak: Number(inspect?.State?.Health?.FailingStreak ?? 0),
          log: (Array.isArray(inspect?.State?.Health?.Log) ? inspect.State.Health.Log : []).map(
            (entry: any) => ({
              start: String(entry?.Start ?? ''),
              end: String(entry?.End ?? ''),
              exitCode: Number(entry?.ExitCode ?? 0),
              output: String(entry?.Output ?? '').slice(0, 4000)
            })
          )
        }
      : null
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string') return [value]
  return []
}

export function splitImageReference(reference: string): { repository: string; tag: string } {
  if (!reference || reference === '<none>:<none>') return { repository: '<none>', tag: '<none>' }
  const atIndex = reference.indexOf('@')
  if (atIndex !== -1) {
    return { repository: reference.slice(0, atIndex), tag: reference.slice(atIndex + 1) }
  }
  const lastColon = reference.lastIndexOf(':')
  const lastSlash = reference.lastIndexOf('/')
  if (lastColon > lastSlash) {
    return { repository: reference.slice(0, lastColon), tag: reference.slice(lastColon + 1) }
  }
  return { repository: reference, tag: 'latest' }
}

export function normalizeImage(info: any, usedByCount: number): ImageSummary {
  const repoTags: string[] = Array.isArray(info?.RepoTags)
    ? info.RepoTags.filter((tag: string) => tag && tag !== '<none>:<none>')
    : []
  const repoDigests: string[] = Array.isArray(info?.RepoDigests) ? info.RepoDigests : []
  const primary = repoTags[0] ?? '<none>:<none>'
  const { repository, tag } = splitImageReference(primary)
  const dangling = repoTags.length === 0
  const id = String(info?.Id ?? '')

  return {
    id,
    shortId: shortId(id),
    repository,
    tag,
    reference: repoTags[0] ?? shortId(id),
    repoTags,
    digest: repoDigests[0]?.split('@')[1] ?? null,
    createdAt: toIsoFromUnix(Number(info?.Created)),
    size: Number(info?.Size ?? 0),
    sharedSize: Number(info?.SharedSize ?? 0) < 0 ? 0 : Number(info?.SharedSize ?? 0),
    containers: usedByCount,
    dangling,
    unused: usedByCount === 0,
    labels: { ...(info?.Labels ?? {}) }
  }
}

export function normalizeVolume(
  info: any,
  containers: { id: string; name: string }[],
  size: number | null
): VolumeSummary {
  const labels: Record<string, string> = { ...(info?.Labels ?? {}) }
  return {
    name: String(info?.Name ?? ''),
    driver: String(info?.Driver ?? 'local'),
    mountpoint: String(info?.Mountpoint ?? ''),
    createdAt: info?.CreatedAt ? new Date(info.CreatedAt).toISOString() : null,
    scope: String(info?.Scope ?? 'local'),
    labels,
    size,
    refCount: typeof info?.UsageData?.RefCount === 'number' ? info.UsageData.RefCount : null,
    inUse: containers.length > 0,
    containers,
    composeProject: labels['com.docker.compose.project'] ?? null
  }
}

const SYSTEM_NETWORKS = new Set(['bridge', 'host', 'none'])

export function normalizeNetwork(
  info: any,
  attached: NetworkSummary['containers']
): NetworkSummary {
  const labels: Record<string, string> = { ...(info?.Labels ?? {}) }
  const id = String(info?.Id ?? '')
  const name = String(info?.Name ?? '')
  return {
    id,
    shortId: shortId(id),
    name,
    driver: String(info?.Driver ?? ''),
    scope: String(info?.Scope ?? 'local'),
    internal: Boolean(info?.Internal),
    attachable: Boolean(info?.Attachable),
    ipv6: Boolean(info?.EnableIPv6),
    createdAt: info?.Created ? new Date(info.Created).toISOString() : null,
    subnets: (Array.isArray(info?.IPAM?.Config) ? info.IPAM.Config : []).map((entry: any) => ({
      subnet: String(entry?.Subnet ?? ''),
      gateway: String(entry?.Gateway ?? '')
    })),
    labels,
    containers: attached,
    system: SYSTEM_NETWORKS.has(name),
    inUse: attached.length > 0,
    composeProject: labels['com.docker.compose.project'] ?? null
  }
}

/**
 * CPU percentage using the same formula as the Docker CLI:
 * (delta container CPU / delta system CPU) * online CPUs * 100.
 */
export function calculateCpuPercent(stats: any): number {
  const cpuDelta =
    Number(stats?.cpu_stats?.cpu_usage?.total_usage ?? 0) -
    Number(stats?.precpu_stats?.cpu_usage?.total_usage ?? 0)
  const systemDelta =
    Number(stats?.cpu_stats?.system_cpu_usage ?? 0) -
    Number(stats?.precpu_stats?.system_cpu_usage ?? 0)
  if (cpuDelta <= 0 || systemDelta <= 0) return 0
  const onlineCpus =
    Number(stats?.cpu_stats?.online_cpus ?? 0) ||
    (Array.isArray(stats?.cpu_stats?.cpu_usage?.percpu_usage)
      ? stats.cpu_stats.cpu_usage.percpu_usage.length
      : 1)
  return Math.max(0, Math.round((cpuDelta / systemDelta) * onlineCpus * 100 * 100) / 100)
}

export function calculateMemoryUsage(stats: any): {
  usage: number
  limit: number
  percent: number
} {
  const raw = Number(stats?.memory_stats?.usage ?? 0)
  // cgroup v2 exposes inactive_file; the CLI subtracts it to match `docker stats`.
  const inactive = Number(
    stats?.memory_stats?.stats?.inactive_file ??
      stats?.memory_stats?.stats?.total_inactive_file ??
      0
  )
  const usage = Math.max(0, raw - inactive)
  const limit = Number(stats?.memory_stats?.limit ?? 0)
  const percent = limit > 0 ? Math.round((usage / limit) * 10_000) / 100 : 0
  return { usage, limit, percent }
}

export function normalizeStats(id: string, stats: any, timestamp = new Date()): ContainerStats {
  const memory = calculateMemoryUsage(stats)
  const networks = stats?.networks ?? {}
  let rx = 0
  let tx = 0
  for (const entry of Object.values<any>(networks)) {
    rx += Number(entry?.rx_bytes ?? 0)
    tx += Number(entry?.tx_bytes ?? 0)
  }
  let read = 0
  let write = 0
  for (const entry of stats?.blkio_stats?.io_service_bytes_recursive ?? []) {
    const op = String(entry?.op ?? '').toLowerCase()
    if (op === 'read') read += Number(entry?.value ?? 0)
    if (op === 'write') write += Number(entry?.value ?? 0)
  }

  return {
    id,
    timestamp: timestamp.toISOString(),
    cpuPercent: calculateCpuPercent(stats),
    memoryUsage: memory.usage,
    memoryLimit: memory.limit,
    memoryPercent: memory.percent,
    networkRx: rx,
    networkTx: tx,
    blockRead: read,
    blockWrite: write,
    pids: Number(stats?.pids_stats?.current ?? 0)
  }
}
