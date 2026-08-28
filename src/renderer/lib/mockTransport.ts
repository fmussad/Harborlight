import type { CommandInput, CommandName, CommandPayload } from '@shared/contracts/commands'
import type { AppEventEnvelope, CommandResult } from '@shared/contracts/responses'
import type { ContainerSummary, Settings } from '@shared/schemas/domain'
import {
  MOCK_COMPOSE_YAML,
  MOCK_LOG_LINES,
  mockComposeProjects,
  mockContainerDetail,
  mockContainers,
  mockDiskUsage,
  mockImageHistory,
  mockImages,
  mockNetworks,
  mockStatsFor,
  mockUsageHistory,
  mockVolumes
} from '@shared/mock/fixtures'
import { UiError, type Transport } from './bridge'

/**
 * Browser-only transport.
 *
 * It mirrors the IPC contract closely enough to design and test the whole UI
 * without Electron. Anything that genuinely needs the main process (Compose
 * execution, diagnostics export, credential storage) fails with an explicit
 * "not available in browser mode" error rather than pretending to work.
 */
export function createMockTransport(): Transport {
  const listeners = new Set<(event: AppEventEnvelope) => void>()
  const emit = (event: AppEventEnvelope): void => {
    for (const listener of listeners) listener(event)
  }

  let containers = mockContainers(Date.now())
  let images = mockImages(Date.now())
  let volumes = mockVolumes()
  let networks = mockNetworks()
  let settings: Settings = {
    theme: 'system',
    dockerSocket: 'mock://harborlight',
    useCustomSocket: false,
    engineMode: 'mock',
    pollIntervalMs: 5000,
    logTailLines: 500,
    logTimestamps: true,
    logWordWrap: false,
    defaultShell: 'auto',
    closeToTray: true,
    startAtLogin: false,
    startMinimized: false,
    desktopNotifications: true,
    updateChannel: 'stable',
    confirmDestructive: true,
    redactEnvSecrets: true
  }

  const timers = new Map<string, ReturnType<typeof setInterval>>()
  let tick = 0

  const find = (id: string): ContainerSummary => {
    const container = containers.find((entry) => entry.id === id || entry.name === id)
    if (!container) throw new UiError('not-found', `Container ${id} does not exist.`)
    return container
  }

  const mutate = (id: string, changes: Partial<ContainerSummary>): void => {
    containers = containers.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry))
  }

  const unsupported = (feature: string): never => {
    throw new UiError(
      'unsupported',
      `${feature} is not available in browser preview mode.`,
      'Run Harborlight inside Electron (make dev) to use the real Docker Engine.'
    )
  }

  const handlers: {
    [K in CommandName]: (payload: CommandPayload<K>) => Promise<CommandResult<K>>
  } = {
    'system.getAppInfo': async () => ({
      name: 'Harborlight',
      version: '0.1.0',
      gitSha: 'browser-mock',
      dirty: false,
      channel: 'stable',
      electron: 'n/a',
      chrome: navigator.userAgent.slice(0, 40),
      node: 'n/a',
      packaged: false,
      installKind: 'development',
      buildDate: new Date().toISOString()
    }),
    'system.getPlatformInfo': async () => ({
      distroId: 'ubuntu',
      distroName: 'Browser preview',
      versionId: '24.04',
      supported: true,
      sessionType: 'browser',
      desktop: 'browser',
      architecture: 'x64',
      kernel: 'n/a',
      isRoot: false,
      inDockerGroup: false,
      trayLikelySupported: false
    }),
    'system.openExternal': async (payload) => {
      window.open(payload.url, '_blank', 'noopener,noreferrer')
      return { ok: true, message: 'Opened in a new tab.' }
    },
    'system.checkForUpdates': async () => ({
      checkedAt: new Date().toISOString(),
      channel: 'stable',
      currentVersion: '0.1.0',
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      message: 'Update checks require the desktop application.'
    }),
    'system.exportDiagnostics': async () => unsupported('Diagnostics export'),
    'system.listTasks': async () => [],
    'system.cancelTask': async () => ({ ok: true, message: 'Cancelled.' }),
    'system.pickComposeFile': async () => ({
      path: '/home/demo/projects/fcs/compose.yml',
      cancelled: false
    }),
    'system.quit': async () => unsupported('Quitting'),
    'system.minimizeToTray': async () => unsupported('The system tray'),

    'settings.get': async () => settings,
    'settings.update': async (payload) => {
      settings = { ...settings, ...payload }
      emit({ type: 'settings:changed', payload: settings })
      return settings
    },
    'settings.reset': async () => settings,
    'settings.setTheme': async (payload) => {
      settings = { ...settings, theme: payload.theme }
      return settings
    },

    'engine.getStatus': async () => ({
      connected: true,
      adapter: 'mock',
      socketPath: 'mock://harborlight',
      rootless: false,
      version: '1.0.0-beta.3 (mock)',
      apiVersion: '1.45',
      os: 'Browser preview',
      kernelVersion: 'n/a',
      architecture: 'x86_64',
      cpus: 12,
      memoryTotal: 32 * 1024 ** 3,
      containersRunning: containers.filter((c) => c.state === 'running').length,
      containersStopped: containers.filter((c) => c.state === 'exited').length,
      containersPaused: 0,
      images: images.length,
      error: null,
      errorHint: null,
      checkedAt: new Date().toISOString()
    }),
    'engine.reconnect': async () => handlers['engine.getStatus']({}),
    'engine.listSockets': async () => [
      {
        path: 'mock://harborlight',
        label: 'Mock engine',
        exists: true,
        readable: true,
        rootless: false
      }
    ],
    'engine.getDiskUsage': async () => mockDiskUsage(),
    'engine.getUsageHistory': async (payload) => mockUsageHistory(payload.windowHours, Date.now()),

    'containers.list': async (payload) =>
      payload.all ? containers : containers.filter((c) => c.state === 'running'),
    'containers.inspect': async (payload) => mockContainerDetail(find(payload.id)),
    'containers.stats': async (payload) => {
      const container = find(payload.id)
      tick += 1
      const stats = mockStatsFor(container, tick)
      return {
        id: container.id,
        timestamp: new Date().toISOString(),
        cpuPercent: stats.cpuPercent,
        memoryUsage: stats.memoryUsage,
        memoryLimit: stats.memoryLimit,
        memoryPercent: Number(((stats.memoryUsage / stats.memoryLimit) * 100).toFixed(2)),
        networkRx: 1024 * 1024 * (tick % 17),
        networkTx: 512 * 1024 * (tick % 13),
        blockRead: 4 * 1024 * 1024,
        blockWrite: 2 * 1024 * 1024,
        pids: 12
      }
    },
    'containers.start': async (payload) => {
      mutate(find(payload.id).id, {
        state: 'running',
        status: 'Up 1 second',
        uptimeSeconds: 1,
        exitCode: null
      })
      return { ok: true, message: 'Container started.' }
    },
    'containers.stop': async (payload) => {
      mutate(find(payload.id).id, {
        state: 'exited',
        status: 'Exited (0) 1 second ago',
        uptimeSeconds: null,
        exitCode: 0,
        health: 'none'
      })
      return { ok: true, message: 'Container stopped.' }
    },
    'containers.restart': async (payload) => {
      mutate(find(payload.id).id, { state: 'running', status: 'Up 1 second', uptimeSeconds: 1 })
      return { ok: true, message: 'Container restarted.' }
    },
    'containers.pause': async (payload) => {
      mutate(find(payload.id).id, { state: 'paused', status: 'Up 2 hours (Paused)' })
      return { ok: true, message: 'Container paused.' }
    },
    'containers.unpause': async (payload) => {
      mutate(find(payload.id).id, { state: 'running', status: 'Up 2 hours' })
      return { ok: true, message: 'Container resumed.' }
    },
    'containers.kill': async (payload) => {
      mutate(find(payload.id).id, {
        state: 'exited',
        status: 'Exited (137) 1 second ago',
        exitCode: 137
      })
      return { ok: true, message: 'Signal sent.' }
    },
    'containers.rename': async (payload) => {
      mutate(find(payload.id).id, { name: payload.name, names: [payload.name] })
      return { ok: true, message: `Renamed to ${payload.name}.` }
    },
    'containers.remove': async (payload) => {
      const container = find(payload.id)
      if (container.state === 'running' && !payload.force) {
        throw new UiError(
          'conflict',
          `${container.name} is running.`,
          'Stop it first or use Force remove.'
        )
      }
      containers = containers.filter((entry) => entry.id !== container.id)
      return { ok: true, message: 'Container removed.' }
    },
    'containers.run': async (payload) => {
      const id = `mock${Date.now().toString(16)}`.padEnd(64, '0')
      const name = payload.name ?? `harborlight-${id.slice(4, 10)}`
      containers = [
        {
          id,
          shortId: id.slice(0, 12),
          name,
          names: [name],
          image: payload.image,
          imageId: `sha256:${id}`,
          command: payload.command ?? '',
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          state: 'running',
          status: 'Up 1 second',
          health: 'none',
          ports: payload.ports.map((port) => ({
            privatePort: port.containerPort,
            publicPort: port.hostPort,
            type: port.protocol
          })),
          networks: ['bridge'],
          labels: {},
          composeProject: null,
          composeService: null,
          uptimeSeconds: 1,
          exitCode: null
        },
        ...containers
      ]
      return { id, name }
    },

    'logs.start': async (payload) => {
      const streamId = `mock-log-${Date.now()}`
      let sequence = 0
      const build = (index: number) => {
        const line = MOCK_LOG_LINES[index % MOCK_LOG_LINES.length]!
        sequence += 1
        return {
          stream: line.level === 'ERROR' ? ('stderr' as const) : ('stdout' as const),
          timestamp: new Date().toISOString(),
          message: `${line.level.padEnd(5)} ${line.scope.padEnd(12)} ${line.message}`,
          sequence
        }
      }
      setTimeout(() => {
        emit({
          type: 'logs:data',
          payload: { streamId, chunk: MOCK_LOG_LINES.map((_, index) => build(index)) }
        })
      }, 60)
      if (payload.follow) {
        let index = MOCK_LOG_LINES.length
        const timer = setInterval(() => {
          emit({ type: 'logs:data', payload: { streamId, chunk: [build(index)] } })
          index += 1
        }, 1400)
        timers.set(streamId, timer)
      }
      return { streamId }
    },
    'logs.stop': async (payload) => {
      const timer = timers.get(payload.streamId)
      if (timer) clearInterval(timer)
      timers.delete(payload.streamId)
      return { ok: true, message: 'Stopped.' }
    },
    'logs.export': async () => unsupported('Log export'),

    'exec.start': async (payload) => {
      const sessionId = `mock-exec-${Date.now()}`
      const container = find(payload.containerId)
      setTimeout(() => {
        emit({
          type: 'exec:data',
          payload: {
            sessionId,
            data: `Harborlight browser preview shell\r\nroot@${container.name}:/app# `
          }
        })
      }, 40)
      return {
        sessionId,
        shell: '/bin/bash',
        user: 'root',
        workingDir: '/app',
        warnRoot: true
      }
    },
    'exec.write': async (payload) => {
      emit({ type: 'exec:data', payload: { sessionId: payload.sessionId, data: payload.data } })
      if (payload.data.includes('\r')) {
        emit({
          type: 'exec:data',
          payload: {
            sessionId: payload.sessionId,
            data: '\r\nbrowser preview: no container attached\r\n# '
          }
        })
      }
      return { ok: true, message: 'Sent.' }
    },
    'exec.resize': async () => ({ ok: true, message: 'Resized.' }),
    'exec.stop': async () => ({ ok: true, message: 'Closed.' }),

    'images.list': async () => images,
    'images.inspect': async (payload) => ({
      raw: JSON.stringify(images.find((image) => image.id === payload.id) ?? {}, null, 2),
      usedBy: containers
        .slice(0, 1)
        .map((container) => ({ id: container.id, name: container.name }))
    }),
    'images.history': async (payload) => mockImageHistory(payload.id),
    'images.pull': async () => ({ taskId: `mock-task-${Date.now()}` }),
    'images.remove': async (payload) => {
      images = images.filter((image) => image.id !== payload.id)
      return { ok: true, message: 'Image removed.' }
    },
    'images.tag': async () => ({ ok: true, message: 'Tagged.' }),
    'images.scan': async (payload) => ({
      available: false,
      reason: 'Trivy scanning requires the desktop application.',
      scannedAt: null,
      reference: payload.reference,
      counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      findings: []
    }),
    'images.scanAvailability': async () => ({
      available: false,
      version: null,
      reason: 'Trivy scanning requires the desktop application.'
    }),

    'volumes.list': async () => volumes,
    'volumes.inspect': async (payload) => ({
      raw: JSON.stringify(volumes.find((volume) => volume.name === payload.name) ?? {}, null, 2)
    }),
    'volumes.remove': async (payload) => {
      volumes = volumes.filter((volume) => volume.name !== payload.name)
      return { ok: true, message: 'Volume removed.' }
    },

    'networks.list': async () => networks,
    'networks.inspect': async (payload) => ({
      raw: JSON.stringify(networks.find((network) => network.id === payload.id) ?? {}, null, 2)
    }),
    'networks.remove': async (payload) => {
      networks = networks.filter((network) => network.id !== payload.id)
      return { ok: true, message: 'Network removed.' }
    },

    'cleanup.analyze': async () => {
      const unusedImages = images.filter((image) => image.unused && !image.dangling)
      const dangling = images.filter((image) => image.dangling)
      const stopped = containers.filter((container) => container.state !== 'running')
      const unusedVolumes = volumes.filter((volume) => !volume.inUse)
      const categories: CommandResult<'cleanup.analyze'>['categories'] = [
        {
          category: 'unusedImages',
          title: 'Unused images',
          description: 'Tagged images that no container references.',
          dangerous: false,
          defaultSelected: true,
          reclaimable: unusedImages.reduce((sum, image) => sum + image.size, 0),
          items: unusedImages.map((image) => ({
            id: image.id,
            label: image.reference,
            detail: image.shortId,
            size: image.size
          }))
        },
        {
          category: 'danglingImages',
          title: 'Dangling images',
          description: 'Untagged layers left behind by rebuilds.',
          dangerous: false,
          defaultSelected: true,
          reclaimable: dangling.reduce((sum, image) => sum + image.size, 0),
          items: dangling.map((image) => ({
            id: image.id,
            label: '<none>:<none>',
            detail: image.shortId,
            size: image.size
          }))
        },
        {
          category: 'stoppedContainers',
          title: 'Stopped containers',
          description: 'Containers that are not running or paused.',
          dangerous: false,
          defaultSelected: true,
          reclaimable: 210 * 1024 ** 2,
          items: stopped.map((container) => ({
            id: container.id,
            label: container.name,
            detail: container.image,
            size: 0
          }))
        },
        {
          category: 'buildCache',
          title: 'Unused build cache',
          description: 'BuildKit cache entries no build is using.',
          dangerous: false,
          defaultSelected: true,
          reclaimable: Math.round(1.1 * 1024 ** 3),
          items: [
            {
              id: 'build-cache',
              label: 'BuildKit cache',
              detail: '24 records',
              size: Math.round(1.1 * 1024 ** 3)
            }
          ]
        },
        {
          category: 'unusedNetworks',
          title: 'Unused networks',
          description: 'User-defined networks with no attached containers.',
          dangerous: false,
          defaultSelected: false,
          reclaimable: 0,
          items: networks
            .filter((network) => !network.system && !network.inUse)
            .map((network) => ({
              id: network.id,
              label: network.name,
              detail: network.driver,
              size: 0
            }))
        },
        {
          category: 'unusedVolumes',
          title: 'Unused volumes',
          description: 'Volume data is deleted permanently and cannot be recovered.',
          dangerous: true,
          defaultSelected: false,
          reclaimable: unusedVolumes.reduce((sum, volume) => sum + (volume.size ?? 0), 0),
          items: unusedVolumes.map((volume) => ({
            id: volume.name,
            label: volume.name,
            detail: volume.driver,
            size: volume.size ?? 0
          }))
        }
      ]
      return {
        generatedAt: new Date().toISOString(),
        categories,
        totalReclaimable: categories
          .filter((entry) => !entry.dangerous)
          .reduce((sum, entry) => sum + entry.reclaimable, 0)
      }
    },
    'cleanup.run': async (payload) => ({
      dryRun: payload.dryRun,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      reclaimed: payload.dryRun ? 0 : Math.round(3.2 * 1024 ** 3),
      entries: payload.categories.map((category) => ({
        category,
        status: payload.dryRun ? ('skipped' as const) : ('succeeded' as const),
        message: payload.dryRun ? 'Dry run: nothing was removed.' : 'Removed in browser preview.',
        reclaimed: 0,
        removed: []
      }))
    }),

    'compose.discover': async () => mockComposeProjects(),
    'compose.openFile': async (payload) => ({
      path: payload.path,
      content: MOCK_COMPOSE_YAML,
      project: mockComposeProjects()[0]!
    }),
    'compose.readFile': async (payload) => ({ path: payload.path, content: MOCK_COMPOSE_YAML }),
    'compose.saveFile': async () => unsupported('Saving Compose files'),
    'compose.validate': async () => ({
      valid: true,
      message: 'Browser preview: YAML parsed locally, docker compose config was not run.',
      normalized: null,
      problems: []
    }),
    'compose.action': async () => unsupported('Compose actions'),
    'compose.preview': async (payload) => ({
      program: 'docker',
      args: ['compose', '--project-name', payload.projectName, payload.action],
      cwd: payload.workingDir,
      display: `docker compose --project-name ${payload.projectName} ${payload.action}`,
      destructive: payload.action === 'down'
    }),
    'compose.cancel': async () => ({ ok: true, message: 'Cancelled.' }),

    'registry.status': async () => ({
      available: false,
      backend: 'browser',
      reason: 'Secure credential storage requires the desktop application.'
    }),
    'registry.list': async () => [
      {
        id: 'dockerhub',
        name: 'Docker Hub',
        kind: 'dockerhub',
        serverAddress: 'https://index.docker.io/v1/',
        username: null,
        hasCredentials: false,
        lastLoginAt: null
      },
      {
        id: 'ghcr',
        name: 'GitHub Container Registry',
        kind: 'ghcr',
        serverAddress: 'ghcr.io',
        username: null,
        hasCredentials: false,
        lastLoginAt: null
      }
    ],
    'registry.add': async () => unsupported('Adding registries'),
    'registry.remove': async () => unsupported('Removing registries'),
    'registry.login': async () => unsupported('Registry login'),
    'registry.logout': async () => unsupported('Registry logout')
  }

  return {
    kind: 'browser-mock',
    async invoke<K extends CommandName>(
      command: K,
      payload?: CommandInput<K>
    ): Promise<CommandResult<K>> {
      const handler = handlers[command] as (input: unknown) => Promise<CommandResult<K>>
      if (!handler) throw new UiError('not-allowed', `Unknown command "${command}".`)
      await new Promise((resolve) => setTimeout(resolve, 40))
      return handler((payload ?? {}) as CommandPayload<K>)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
