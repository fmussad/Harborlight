import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import type { CommandInput, CommandName } from '@shared/contracts/commands'
import type { CommandResult } from '@shared/contracts/responses'
import type {
  AppInfo,
  CleanupPlan,
  ComposeProject,
  ContainerDetail,
  ContainerStats,
  ContainerSummary,
  DiskUsage,
  EngineStatus,
  ImageSummary,
  NetworkSummary,
  PlatformInfo,
  RegistryEntry,
  SecureStorageStatus,
  Settings,
  SocketCandidate,
  Task,
  UsageSample,
  VolumeSummary
} from '@shared/schemas/domain'
import { invoke } from './bridge'

export const queryKeys = {
  appInfo: ['app-info'] as const,
  platform: ['platform'] as const,
  settings: ['settings'] as const,
  engineStatus: ['engine', 'status'] as const,
  sockets: ['engine', 'sockets'] as const,
  diskUsage: ['engine', 'disk-usage'] as const,
  usageHistory: (hours: number) => ['engine', 'usage-history', hours] as const,
  containers: ['containers'] as const,
  container: (id: string) => ['containers', id] as const,
  containerStats: (id: string) => ['containers', id, 'stats'] as const,
  images: ['images'] as const,
  imageHistory: (id: string) => ['images', id, 'history'] as const,
  imageInspect: (id: string) => ['images', id, 'inspect'] as const,
  volumes: ['volumes'] as const,
  networks: ['networks'] as const,
  compose: ['compose', 'projects'] as const,
  cleanup: ['cleanup', 'plan'] as const,
  registries: ['registries'] as const,
  registryStatus: ['registries', 'status'] as const,
  scanAvailability: ['scan', 'availability'] as const,
  tasks: ['tasks'] as const
}

/** Lists refresh on the interval the user configured in Settings. */
function useLiveQuery<T>(
  key: readonly unknown[],
  fetcher: () => Promise<T>,
  options: { intervalMs?: number | false; enabled?: boolean } = {}
): UseQueryResult<T> {
  return useQuery({
    queryKey: key,
    queryFn: fetcher,
    refetchInterval: options.intervalMs === false ? false : (options.intervalMs ?? 5000),
    refetchOnWindowFocus: true,
    enabled: options.enabled ?? true,
    staleTime: 1000
  })
}

export function useSettings(): UseQueryResult<Settings> {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => invoke('settings.get'),
    staleTime: Number.POSITIVE_INFINITY
  })
}

export function useAppInfo(): UseQueryResult<AppInfo> {
  return useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: () => invoke('system.getAppInfo'),
    staleTime: Number.POSITIVE_INFINITY
  })
}

export function usePlatformInfo(): UseQueryResult<PlatformInfo> {
  return useQuery({
    queryKey: queryKeys.platform,
    queryFn: () => invoke('system.getPlatformInfo'),
    staleTime: Number.POSITIVE_INFINITY
  })
}

export function useEngineStatus(intervalMs = 5000): UseQueryResult<EngineStatus> {
  return useLiveQuery<EngineStatus>(queryKeys.engineStatus, () => invoke('engine.getStatus'), {
    intervalMs
  })
}

export function useSockets(): UseQueryResult<SocketCandidate[]> {
  return useQuery({ queryKey: queryKeys.sockets, queryFn: () => invoke('engine.listSockets') })
}

export function useContainers(
  intervalMs: number | false = 5000,
  enabled = true
): UseQueryResult<ContainerSummary[]> {
  return useLiveQuery<ContainerSummary[]>(
    queryKeys.containers,
    () => invoke('containers.list', { all: true }),
    { intervalMs, enabled }
  )
}

export function useContainerDetail(id: string | null): UseQueryResult<ContainerDetail> {
  return useQuery({
    queryKey: queryKeys.container(id ?? 'none'),
    queryFn: () => invoke('containers.inspect', { id: id as string }),
    enabled: Boolean(id),
    refetchInterval: 8000
  })
}

export interface StatsWithHistory {
  latest: ContainerStats
  /** Rolling window of the most recent samples, used for the sparklines. */
  history: ContainerStats[]
}

const STATS_WINDOW = 40
const statsHistory = new Map<string, ContainerStats[]>()

/**
 * Polls container stats and keeps a short history.
 *
 * The window is appended inside the query function rather than in a React
 * effect, so the component only ever renders what the cache already holds.
 */
export function useContainerStats(
  id: string | null,
  enabled = true
): UseQueryResult<StatsWithHistory> {
  return useQuery({
    queryKey: queryKeys.containerStats(id ?? 'none'),
    queryFn: async () => {
      const containerId = id as string
      const latest = await invoke('containers.stats', { id: containerId })
      const history = [...(statsHistory.get(containerId) ?? []), latest].slice(-STATS_WINDOW)
      statsHistory.set(containerId, history)
      return { latest, history }
    },
    enabled: Boolean(id) && enabled,
    refetchInterval: 3000,
    retry: false
  })
}

export function useImages(intervalMs: number | false = 15_000): UseQueryResult<ImageSummary[]> {
  return useLiveQuery<ImageSummary[]>(queryKeys.images, () => invoke('images.list'), { intervalMs })
}

export function useVolumes(intervalMs: number | false = 15_000): UseQueryResult<VolumeSummary[]> {
  return useLiveQuery<VolumeSummary[]>(queryKeys.volumes, () => invoke('volumes.list'), {
    intervalMs
  })
}

export function useNetworks(intervalMs: number | false = 15_000): UseQueryResult<NetworkSummary[]> {
  return useLiveQuery<NetworkSummary[]>(queryKeys.networks, () => invoke('networks.list'), {
    intervalMs
  })
}

/** `docker df` is slow, so disk usage refreshes on a much longer interval. */
export function useDiskUsage(): UseQueryResult<DiskUsage> {
  return useQuery({
    queryKey: queryKeys.diskUsage,
    queryFn: () => invoke('engine.getDiskUsage'),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: false
  })
}

export function useUsageHistory(windowHours = 24): UseQueryResult<UsageSample[]> {
  return useQuery({
    queryKey: queryKeys.usageHistory(windowHours),
    queryFn: () => invoke('engine.getUsageHistory', { windowHours }),
    refetchInterval: 30_000
  })
}

export function useComposeProjects(): UseQueryResult<ComposeProject[]> {
  return useLiveQuery<ComposeProject[]>(queryKeys.compose, () => invoke('compose.discover'), {
    intervalMs: 10_000
  })
}

export function useCleanupPlan(enabled: boolean): UseQueryResult<CleanupPlan> {
  return useQuery({
    queryKey: queryKeys.cleanup,
    queryFn: () => invoke('cleanup.analyze'),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    retry: false
  })
}

export function useRegistries(): UseQueryResult<RegistryEntry[]> {
  return useQuery({ queryKey: queryKeys.registries, queryFn: () => invoke('registry.list') })
}

export function useRegistryStatus(): UseQueryResult<SecureStorageStatus> {
  return useQuery({ queryKey: queryKeys.registryStatus, queryFn: () => invoke('registry.status') })
}

export function useScanAvailability(): UseQueryResult<CommandResult<'images.scanAvailability'>> {
  return useQuery({
    queryKey: queryKeys.scanAvailability,
    queryFn: () => invoke('images.scanAvailability'),
    staleTime: 5 * 60_000
  })
}

export function useTasks(): UseQueryResult<Task[]> {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => invoke('system.listTasks'),
    refetchInterval: 5000
  })
}

/**
 * Generic command mutation.
 *
 * Nothing is applied optimistically: the affected queries are invalidated only
 * after the main process confirms the operation.
 */
export function useCommand<K extends CommandName>(
  command: K,
  options: { invalidate?: readonly (readonly unknown[])[] } = {}
): UseMutationResult<CommandResult<K>, Error, CommandInput<K> | undefined> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload?: CommandInput<K>) => invoke(command, payload),
    onSuccess: async () => {
      for (const key of options.invalidate ?? []) {
        await client.invalidateQueries({ queryKey: key })
      }
    }
  })
}
