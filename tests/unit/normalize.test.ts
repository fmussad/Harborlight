import { describe, expect, it } from 'vitest'
import {
  calculateCpuPercent,
  calculateMemoryUsage,
  healthFromStatus,
  normalizeContainerDetail,
  normalizeContainerSummary,
  normalizeImage,
  normalizeNetwork,
  normalizePorts,
  normalizeStats,
  normalizeVolume,
  parseExitCodeFromStatus,
  parseUptimeFromStatus,
  splitImageReference,
  toContainerState
} from '@main/docker/normalize'
import { REDACTED_PLACEHOLDER } from '@shared/utils/redact'

describe('toContainerState', () => {
  it('accepts the documented states', () => {
    expect(toContainerState('running')).toBe('running')
    expect(toContainerState('EXITED')).toBe('exited')
  })

  it('falls back to dead for anything unexpected', () => {
    expect(toContainerState('zombie')).toBe('dead')
    expect(toContainerState(undefined)).toBe('dead')
  })
})

describe('healthFromStatus', () => {
  it('reads the health suffix Docker appends', () => {
    expect(healthFromStatus('Up 5 hours (healthy)')).toBe('healthy')
    expect(healthFromStatus('Up 2 minutes (unhealthy)')).toBe('unhealthy')
    expect(healthFromStatus('Up 3 seconds (health: starting)')).toBe('starting')
    expect(healthFromStatus('Up 5 hours')).toBe('none')
  })
})

describe('parseUptimeFromStatus', () => {
  it('converts Docker phrasing into seconds', () => {
    expect(parseUptimeFromStatus('Up 6 hours')).toBe(6 * 3600)
    expect(parseUptimeFromStatus('Up 2 days')).toBe(2 * 86_400)
    expect(parseUptimeFromStatus('Up About a minute')).toBeNull()
    expect(parseUptimeFromStatus('Up Less than a second')).toBe(0)
  })

  it('returns null for containers that are not up', () => {
    expect(parseUptimeFromStatus('Exited (0) 4 hours ago')).toBeNull()
    expect(parseUptimeFromStatus(undefined)).toBeNull()
  })
})

describe('parseExitCodeFromStatus', () => {
  it('reads the exit code', () => {
    expect(parseExitCodeFromStatus('Exited (137) 2 hours ago')).toBe(137)
    expect(parseExitCodeFromStatus('Up 3 hours')).toBeNull()
  })
})

describe('normalizePorts', () => {
  it('deduplicates and sorts bindings', () => {
    const ports = normalizePorts([
      { PrivatePort: 8080, PublicPort: 8080, Type: 'tcp', IP: '0.0.0.0' },
      { PrivatePort: 8080, PublicPort: 8080, Type: 'tcp', IP: '0.0.0.0' },
      { PrivatePort: 80, PublicPort: 3000, Type: 'tcp' }
    ])
    expect(ports).toHaveLength(2)
    expect(ports[0]?.publicPort).toBe(3000)
  })

  it('keeps unpublished ports and drops broken entries', () => {
    const ports = normalizePorts([{ PrivatePort: 5432, Type: 'tcp' }, { Type: 'tcp' }])
    expect(ports).toEqual([{ privatePort: 5432, type: 'tcp' }])
  })

  it('tolerates a missing list', () => {
    expect(normalizePorts(undefined)).toEqual([])
  })
})

describe('normalizeContainerSummary', () => {
  const info = {
    Id: 'a'.repeat(64),
    Names: ['/fcs-api', '/alias'],
    Image: 'ghcr.io/fcs/api:1.4.2',
    ImageID: 'sha256:b'.padEnd(20, 'b'),
    Command: 'node server.js',
    Created: 1_747_000_000,
    State: 'running',
    Status: 'Up 6 hours (healthy)',
    Ports: [{ PrivatePort: 8080, PublicPort: 8080, Type: 'tcp' }],
    Labels: {
      'com.docker.compose.project': 'fcs',
      'com.docker.compose.service': 'api'
    },
    NetworkSettings: { Networks: { fcs_default: {} } }
  }

  it('produces a fully normalized summary', () => {
    const summary = normalizeContainerSummary(info)
    expect(summary.name).toBe('fcs-api')
    expect(summary.shortId).toBe('a'.repeat(12))
    expect(summary.state).toBe('running')
    expect(summary.health).toBe('healthy')
    expect(summary.composeProject).toBe('fcs')
    expect(summary.composeService).toBe('api')
    expect(summary.networks).toEqual(['fcs_default'])
    expect(summary.uptimeSeconds).toBe(6 * 3600)
  })

  it('falls back to the short id when a container has no name', () => {
    const summary = normalizeContainerSummary({ ...info, Names: [] })
    expect(summary.name).toBe('a'.repeat(12))
  })

  it('reports no uptime for stopped containers', () => {
    const summary = normalizeContainerSummary({
      ...info,
      State: 'exited',
      Status: 'Exited (1) 10 minutes ago'
    })
    expect(summary.uptimeSeconds).toBeNull()
    expect(summary.exitCode).toBe(1)
  })
})

describe('normalizeContainerDetail', () => {
  const inspect = {
    Id: 'c'.repeat(64),
    Name: '/fcs-db',
    Created: '2026-05-14T09:00:00.000Z',
    State: {
      Status: 'running',
      StartedAt: '2026-05-16T09:00:00.000Z',
      Health: { Status: 'healthy', FailingStreak: 0, Log: [] }
    },
    Config: {
      Image: 'mariadb:11.3',
      Cmd: ['mysqld'],
      Entrypoint: ['docker-entrypoint.sh'],
      WorkingDir: '/',
      User: 'mysql',
      Labels: { 'com.docker.compose.project': 'fcs' },
      Env: ['MARIADB_ROOT_PASSWORD=hunter2', 'TZ=Europe/Madrid'],
      Healthcheck: { Test: ['CMD', 'healthcheck.sh'], Interval: 30e9, Timeout: 5e9, Retries: 3 }
    },
    HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
    RestartCount: 2,
    Platform: 'linux',
    LogPath: '/var/lib/docker/containers/x/x-json.log',
    NetworkSettings: {
      Ports: { '3306/tcp': [{ HostIp: '0.0.0.0', HostPort: '3306' }] },
      Networks: { fcs_default: { IPAddress: '172.20.0.3', Gateway: '172.20.0.1', Aliases: ['db'] } }
    },
    Mounts: [
      {
        Type: 'volume',
        Name: 'fcs_db',
        Source: '/var/lib/docker/volumes/fcs_db/_data',
        Destination: '/var/lib/mysql',
        Mode: 'z',
        RW: true
      }
    ]
  }

  it('redacts secret environment values by default', () => {
    const detail = normalizeContainerDetail(inspect, { redactEnv: true })
    const password = detail.env.find((entry) => entry.key === 'MARIADB_ROOT_PASSWORD')
    expect(password?.value).toBe(REDACTED_PLACEHOLDER)
    expect(password?.redacted).toBe(true)
    expect(detail.env.find((entry) => entry.key === 'TZ')?.value).toBe('Europe/Madrid')
  })

  it('can show secrets when the user opts out', () => {
    const detail = normalizeContainerDetail(inspect, { redactEnv: false })
    expect(detail.env.find((entry) => entry.key === 'MARIADB_ROOT_PASSWORD')?.value).toBe('hunter2')
  })

  it('computes uptime from the exact start time', () => {
    const now = Date.parse('2026-05-16T12:00:00.000Z')
    const detail = normalizeContainerDetail(inspect, { redactEnv: true, now })
    expect(detail.uptimeSeconds).toBe(3 * 3600)
  })

  it('normalizes ports, mounts and networks', () => {
    const detail = normalizeContainerDetail(inspect, { redactEnv: true })
    expect(detail.ports[0]).toMatchObject({ privatePort: 3306, publicPort: 3306, type: 'tcp' })
    expect(detail.mounts[0]?.destination).toBe('/var/lib/mysql')
    expect(detail.networkDetails[0]).toMatchObject({ name: 'fcs_default', ipAddress: '172.20.0.3' })
    expect(detail.restartPolicy).toBe('unless-stopped')
    expect(detail.healthCheck?.intervalSeconds).toBe(30)
  })

  it('survives an almost empty inspect payload', () => {
    const detail = normalizeContainerDetail({}, { redactEnv: true })
    expect(detail.state).toBe('dead')
    expect(detail.env).toEqual([])
    expect(detail.startedAt).toBeNull()
  })
})

describe('splitImageReference', () => {
  it('splits repository and tag', () => {
    expect(splitImageReference('mariadb:11.3')).toEqual({ repository: 'mariadb', tag: '11.3' })
  })

  it('handles registries with a port', () => {
    expect(splitImageReference('registry.local:5000/team/app:2.0')).toEqual({
      repository: 'registry.local:5000/team/app',
      tag: '2.0'
    })
    expect(splitImageReference('registry.local:5000/team/app')).toEqual({
      repository: 'registry.local:5000/team/app',
      tag: 'latest'
    })
  })

  it('handles digests and untagged images', () => {
    expect(splitImageReference('app@sha256:abc').tag).toBe('sha256:abc')
    expect(splitImageReference('<none>:<none>')).toEqual({ repository: '<none>', tag: '<none>' })
  })
})

describe('normalizeImage', () => {
  it('marks images with no tags as dangling', () => {
    const image = normalizeImage({ Id: 'sha256:' + 'd'.repeat(64), RepoTags: [], Size: 100 }, 0)
    expect(image.dangling).toBe(true)
    expect(image.unused).toBe(true)
  })

  it('reads the primary tag and digest', () => {
    const image = normalizeImage(
      {
        Id: 'sha256:' + 'e'.repeat(64),
        RepoTags: ['ghcr.io/fcs/api:1.4.2'],
        RepoDigests: ['ghcr.io/fcs/api@sha256:1234'],
        Size: 2048,
        SharedSize: -1
      },
      3
    )
    expect(image.repository).toBe('ghcr.io/fcs/api')
    expect(image.tag).toBe('1.4.2')
    expect(image.digest).toBe('sha256:1234')
    expect(image.sharedSize).toBe(0)
    expect(image.unused).toBe(false)
  })
})

describe('normalizeVolume and normalizeNetwork', () => {
  it('links volumes to their compose project and users', () => {
    const volume = normalizeVolume(
      {
        Name: 'fcs_db',
        Driver: 'local',
        Mountpoint: '/var/lib/docker/volumes/fcs_db/_data',
        CreatedAt: '2026-05-10T10:00:00Z',
        Labels: { 'com.docker.compose.project': 'fcs' },
        UsageData: { RefCount: 1 }
      },
      [{ id: 'abc', name: 'fcs-db' }],
      1024
    )
    expect(volume.inUse).toBe(true)
    expect(volume.composeProject).toBe('fcs')
    expect(volume.size).toBe(1024)
  })

  it('recognises the built-in networks', () => {
    expect(normalizeNetwork({ Id: 'n1', Name: 'bridge' }, []).system).toBe(true)
    expect(normalizeNetwork({ Id: 'n2', Name: 'fcs_default' }, []).system).toBe(false)
  })
})

describe('stats maths', () => {
  const sample = {
    cpu_stats: {
      cpu_usage: { total_usage: 2_000_000_000 },
      system_cpu_usage: 20_000_000_000,
      online_cpus: 4
    },
    precpu_stats: {
      cpu_usage: { total_usage: 1_000_000_000 },
      system_cpu_usage: 10_000_000_000
    },
    memory_stats: {
      usage: 600 * 1024 ** 2,
      limit: 1024 ** 3,
      stats: { inactive_file: 100 * 1024 ** 2 }
    },
    networks: { eth0: { rx_bytes: 100, tx_bytes: 200 }, eth1: { rx_bytes: 50, tx_bytes: 25 } },
    blkio_stats: {
      io_service_bytes_recursive: [
        { op: 'Read', value: 1000 },
        { op: 'Write', value: 2000 }
      ]
    },
    pids_stats: { current: 12 }
  }

  it('matches the docker stats CPU formula', () => {
    expect(calculateCpuPercent(sample)).toBe(40)
  })

  it('returns zero when there is no previous sample', () => {
    expect(calculateCpuPercent({ cpu_stats: {}, precpu_stats: {} })).toBe(0)
  })

  it('subtracts inactive file cache from memory usage', () => {
    const memory = calculateMemoryUsage(sample)
    expect(memory.usage).toBe(500 * 1024 ** 2)
    expect(memory.percent).toBeCloseTo(48.83, 1)
  })

  it('aggregates network and block IO', () => {
    const stats = normalizeStats('abc', sample, new Date('2026-05-16T18:00:00.000Z'))
    expect(stats.networkRx).toBe(150)
    expect(stats.networkTx).toBe(225)
    expect(stats.blockRead).toBe(1000)
    expect(stats.blockWrite).toBe(2000)
    expect(stats.pids).toBe(12)
    expect(stats.timestamp).toBe('2026-05-16T18:00:00.000Z')
  })
})
