import type {
  ComposeProject,
  ContainerDetail,
  ContainerSummary,
  DiskUsage,
  ImageLayer,
  ImageSummary,
  NetworkSummary,
  UsageSample,
  VolumeSummary
} from '../schemas/domain'

/**
 * Deterministic demo data.
 *
 * Used by `MockEngineAdapter` (make dev MOCK=1), by browser-only development
 * and by the Playwright suite, so tests never touch real Docker resources.
 * Values mirror the Harborlight design reference.
 */

export const MOCK_EPOCH = Date.parse('2026-05-16T18:32:00.000Z')

/** Small deterministic PRNG so charts and stats are stable across runs. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

interface Seed {
  name: string
  image: string
  project: string | null
  service: string | null
  state: ContainerSummary['state']
  health: ContainerSummary['health']
  hostPort: number
  containerPort: number
  uptimeSeconds: number
  cpuPercent: number
  memoryBytes: number
  command: string
  restartPolicy: string
}

const SEEDS: Seed[] = [
  {
    name: 'fcs-api',
    image: 'ghcr.io/fcs/api:1.4.2',
    project: 'fcs',
    service: 'api',
    state: 'running',
    health: 'healthy',
    hostPort: 8080,
    containerPort: 8080,
    uptimeSeconds: 2 * 86_400 + 4 * 3600,
    cpuPercent: 6.1,
    memoryBytes: 512 * 1024 * 1024,
    command: '/usr/local/bin/api',
    restartPolicy: 'unless-stopped'
  },
  {
    name: 'fcs-ui',
    image: 'ghcr.io/fcs/ui:2.1.0',
    project: 'fcs',
    service: 'ui',
    state: 'running',
    health: 'healthy',
    hostPort: 3000,
    containerPort: 3000,
    uptimeSeconds: 2 * 86_400 + 4 * 3600,
    cpuPercent: 3.8,
    memoryBytes: 256 * 1024 * 1024,
    command: 'nginx -g daemon off;',
    restartPolicy: 'unless-stopped'
  },
  {
    name: 'mariadb',
    image: 'mariadb:11.3',
    project: 'fcs',
    service: 'mariadb',
    state: 'running',
    health: 'healthy',
    hostPort: 3306,
    containerPort: 3306,
    uptimeSeconds: 5 * 86_400 + 12 * 3600,
    cpuPercent: 2.2,
    memoryBytes: 1.2 * 1024 * 1024 * 1024,
    command: 'mariadbd',
    restartPolicy: 'always'
  },
  {
    name: 'redis',
    image: 'redis:7.2-alpine',
    project: 'fcs',
    service: 'redis',
    state: 'running',
    health: 'healthy',
    hostPort: 6379,
    containerPort: 6379,
    uptimeSeconds: 5 * 86_400 + 12 * 3600,
    cpuPercent: 1.1,
    memoryBytes: 128 * 1024 * 1024,
    command: 'redis-server',
    restartPolicy: 'always'
  },
  {
    name: 'event-tracer',
    image: 'ghcr.io/fcs/tracer:0.9.1',
    project: 'observability',
    service: 'event-tracer',
    state: 'running',
    health: 'healthy',
    hostPort: 9411,
    containerPort: 9411,
    uptimeSeconds: 86_400 + 3 * 3600,
    cpuPercent: 0.7,
    memoryBytes: 64 * 1024 * 1024,
    command: '/tracer',
    restartPolicy: 'unless-stopped'
  },
  {
    name: 'promtail',
    image: 'grafana/promtail:2.9.2',
    project: 'observability',
    service: 'promtail',
    state: 'running',
    health: 'healthy',
    hostPort: 9080,
    containerPort: 9080,
    uptimeSeconds: 86_400 + 3 * 3600,
    cpuPercent: 0.5,
    memoryBytes: 80 * 1024 * 1024,
    command: '/usr/bin/promtail -config.file=/etc/promtail/config.yml',
    restartPolicy: 'unless-stopped'
  },
  {
    name: 'adminer',
    image: 'adminer:4.8.1',
    project: 'tools',
    service: 'adminer',
    state: 'exited',
    health: 'none',
    hostPort: 8081,
    containerPort: 8080,
    uptimeSeconds: 0,
    cpuPercent: 0,
    memoryBytes: 0,
    command: 'entrypoint.sh docker-php-entrypoint php -S 0.0.0.0:8080 -t /var/www/html',
    restartPolicy: 'no'
  },
  {
    name: 'mailhog',
    image: 'mailhog/mailhog:1.0.1',
    project: 'tools',
    service: 'mailhog',
    state: 'running',
    health: 'healthy',
    hostPort: 8025,
    containerPort: 8025,
    uptimeSeconds: 3 * 86_400,
    cpuPercent: 0.3,
    memoryBytes: 24 * 1024 * 1024,
    command: 'MailHog',
    restartPolicy: 'unless-stopped'
  }
]

function fakeId(index: number, salt = 7): string {
  const base = (index + 1) * 0x9e3779b1 * salt
  let hex = ''
  let value = BigInt(Math.abs(base))
  while (hex.length < 64) {
    value = (value * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn
    hex += value.toString(16).padStart(16, '0')
  }
  return hex.slice(0, 64)
}

export function mockContainers(now = MOCK_EPOCH): ContainerSummary[] {
  return SEEDS.map((seed, index) => {
    const id = fakeId(index)
    const running = seed.state === 'running'
    const startedAt = running ? new Date(now - seed.uptimeSeconds * 1000).toISOString() : null
    return {
      id,
      shortId: id.slice(0, 12),
      name: seed.name,
      names: [seed.name],
      image: seed.image,
      imageId: `sha256:${fakeId(index, 13)}`,
      command: seed.command,
      createdAt: new Date(now - (seed.uptimeSeconds + 3600) * 1000).toISOString(),
      startedAt,
      state: seed.state,
      status: running
        ? `Up ${Math.floor(seed.uptimeSeconds / 86_400)} days${seed.health === 'healthy' ? ' (healthy)' : ''}`
        : 'Exited (0) 4 hours ago',
      health: seed.health,
      ports: [
        {
          privatePort: seed.containerPort,
          publicPort: seed.hostPort,
          type: 'tcp',
          hostIp: '0.0.0.0'
        }
      ],
      networks: seed.project ? [`${seed.project}_default`] : ['bridge'],
      labels: {
        ...(seed.project ? { 'com.docker.compose.project': seed.project } : {}),
        ...(seed.service ? { 'com.docker.compose.service': seed.service } : {}),
        'org.opencontainers.image.source': 'https://github.com/fmussad/Harborlight'
      },
      composeProject: seed.project,
      composeService: seed.service,
      uptimeSeconds: running ? seed.uptimeSeconds : null,
      exitCode: running ? null : 0
    }
  })
}

export function mockContainerDetail(summary: ContainerSummary): ContainerDetail {
  const seed = SEEDS.find((entry) => entry.name === summary.name)
  return {
    ...summary,
    restartPolicy: seed?.restartPolicy ?? 'no',
    env: [
      { key: 'NODE_ENV', value: 'production', redacted: false },
      { key: 'DB_HOST', value: 'mariadb', redacted: false },
      { key: 'REDIS_URL', value: 'redis://redis:6379', redacted: false },
      { key: 'DB_PASSWORD', value: '••••••••', redacted: true },
      { key: 'API_TOKEN', value: '••••••••', redacted: true }
    ],
    mounts: [
      {
        type: 'volume',
        name: `${summary.composeProject ?? 'harborlight'}_data`,
        source: `/var/lib/docker/volumes/${summary.composeProject ?? 'harborlight'}_data/_data`,
        destination: '/data',
        mode: 'rw',
        rw: true
      }
    ],
    workingDir: '/app',
    user: '',
    entrypoint: ['/docker-entrypoint.sh'],
    args: [],
    restartCount: 0,
    platform: 'linux',
    logPath: `/var/lib/docker/containers/${summary.id}/${summary.id}-json.log`,
    networkDetails: summary.networks.map((name, index) => ({
      name,
      ipAddress: `172.20.0.${index + 2}`,
      gateway: '172.20.0.1',
      macAddress: '02:42:ac:14:00:02',
      aliases: [summary.composeService ?? summary.name]
    })),
    healthCheck:
      summary.health === 'none'
        ? null
        : {
            test: ['CMD-SHELL', 'curl -fsS http://localhost:8080/health || exit 1'],
            intervalSeconds: 30,
            timeoutSeconds: 5,
            retries: 3,
            failingStreak: 0,
            log: [
              {
                start: new Date(MOCK_EPOCH - 30_000).toISOString(),
                end: new Date(MOCK_EPOCH - 29_000).toISOString(),
                exitCode: 0,
                output: 'OK'
              }
            ]
          }
  }
}

export function mockStatsFor(
  summary: ContainerSummary,
  tick = 0
): {
  cpuPercent: number
  memoryUsage: number
  memoryLimit: number
} {
  const seed = SEEDS.find((entry) => entry.name === summary.name)
  const random = seededRandom(summary.name.length * 977 + tick)
  const jitter = (random() - 0.5) * 0.6
  return {
    cpuPercent: Math.max(0, Number(((seed?.cpuPercent ?? 0) + jitter).toFixed(2))),
    memoryUsage: Math.round((seed?.memoryBytes ?? 0) * (1 + (random() - 0.5) * 0.04)),
    memoryLimit: 8 * 1024 * 1024 * 1024
  }
}

const IMAGE_SEEDS: { repository: string; tag: string; size: number; containers: number }[] = [
  { repository: 'ghcr.io/fcs/api', tag: '1.4.2', size: 2.1 * 1024 ** 3, containers: 1 },
  { repository: 'ghcr.io/fcs/ui', tag: '2.1.0', size: 1.2 * 1024 ** 3, containers: 1 },
  { repository: 'mariadb', tag: '11.3', size: 1.1 * 1024 ** 3, containers: 1 },
  { repository: 'redis', tag: '7.2-alpine', size: 280 * 1024 ** 2, containers: 1 },
  { repository: 'grafana/promtail', tag: '2.9.2', size: 240 * 1024 ** 2, containers: 1 },
  { repository: 'adminer', tag: '4.8.1', size: 157 * 1024 ** 2, containers: 1 },
  { repository: 'mailhog/mailhog', tag: '1.0.1', size: 120 * 1024 ** 2, containers: 1 },
  { repository: 'ghcr.io/fcs/tracer', tag: '0.9.1', size: 96 * 1024 ** 2, containers: 1 },
  { repository: '<none>', tag: '<none>', size: 320 * 1024 ** 2, containers: 0 }
]

export function mockImages(now = MOCK_EPOCH): ImageSummary[] {
  return IMAGE_SEEDS.map((seed, index) => {
    const id = `sha256:${fakeId(index, 31)}`
    const dangling = seed.repository === '<none>'
    return {
      id,
      shortId: id.slice(7, 19),
      repository: seed.repository,
      tag: seed.tag,
      reference: dangling ? id.slice(7, 19) : `${seed.repository}:${seed.tag}`,
      repoTags: dangling ? [] : [`${seed.repository}:${seed.tag}`],
      digest: `${fakeId(index, 41)}`,
      createdAt: new Date(now - (index + 1) * 86_400_000).toISOString(),
      size: Math.round(seed.size),
      sharedSize: 0,
      containers: seed.containers,
      dangling,
      unused: seed.containers === 0,
      labels: {}
    }
  })
}

export function mockImageHistory(reference: string): ImageLayer[] {
  return [
    { createdBy: 'COPY /app /app', size: 420 * 1024 ** 2, comment: '' },
    { createdBy: 'RUN npm ci --omit=dev', size: 310 * 1024 ** 2, comment: '' },
    { createdBy: 'WORKDIR /app', size: 0, comment: '' },
    { createdBy: 'FROM node:20-bookworm-slim', size: 240 * 1024 ** 2, comment: 'base image' }
  ].map((entry, index) => ({
    id: index === 0 ? `sha256:${fakeId(index, 53)}` : '<missing>',
    createdAt: new Date(MOCK_EPOCH - (index + 1) * 3_600_000).toISOString(),
    createdBy: entry.createdBy,
    size: entry.size,
    comment: entry.comment,
    tags: index === 0 ? [reference] : []
  }))
}

export function mockVolumes(): VolumeSummary[] {
  const containers = mockContainers()
  return [
    { name: 'fcs_mariadb_data', project: 'fcs', size: 3.4 * 1024 ** 3, users: ['mariadb'] },
    { name: 'fcs_redis_data', project: 'fcs', size: 780 * 1024 ** 2, users: ['redis'] },
    {
      name: 'observability_traces',
      project: 'observability',
      size: 640 * 1024 ** 2,
      users: ['event-tracer']
    },
    { name: 'orphaned_build_cache', project: null, size: 1.1 * 1024 ** 3, users: [] }
  ].map((seed): VolumeSummary => ({
    name: seed.name,
    driver: 'local',
    mountpoint: `/var/lib/docker/volumes/${seed.name}/_data`,
    createdAt: new Date(MOCK_EPOCH - 6 * 86_400_000).toISOString(),
    scope: 'local',
    labels: seed.project ? { 'com.docker.compose.project': seed.project } : {},
    size: Math.round(seed.size),
    refCount: seed.users.length,
    inUse: seed.users.length > 0,
    containers: seed.users.map((name) => {
      const match = containers.find((container) => container.name === name)
      return { id: match?.id ?? name, name }
    }),
    composeProject: seed.project
  }))
}

export function mockNetworks(): NetworkSummary[] {
  const containers = mockContainers()
  return [
    { name: 'bridge', driver: 'bridge', system: true, project: null, subnet: '172.17.0.0/16' },
    { name: 'host', driver: 'host', system: true, project: null, subnet: '' },
    { name: 'none', driver: 'null', system: true, project: null, subnet: '' },
    {
      name: 'fcs_default',
      driver: 'bridge',
      system: false,
      project: 'fcs',
      subnet: '172.20.0.0/16'
    },
    {
      name: 'observability_default',
      driver: 'bridge',
      system: false,
      project: 'observability',
      subnet: '172.21.0.0/16'
    },
    {
      name: 'tools_default',
      driver: 'bridge',
      system: false,
      project: 'tools',
      subnet: '172.22.0.0/16'
    }
  ].map((seed, index): NetworkSummary => {
    const id = fakeId(index, 67)
    const attached = containers
      .filter((container) => container.networks.includes(seed.name))
      .map((container, position) => ({
        id: container.id,
        name: container.name,
        ipv4Address: `${seed.subnet.split('/')[0]?.split('.').slice(0, 3).join('.') ?? '172.17.0'}.${position + 2}/16`,
        macAddress: `02:42:ac:14:00:0${position + 2}`
      }))
    return {
      id,
      shortId: id.slice(0, 12),
      name: seed.name,
      driver: seed.driver,
      scope: 'local',
      internal: false,
      attachable: !seed.system,
      ipv6: false,
      createdAt: new Date(MOCK_EPOCH - 7 * 86_400_000).toISOString(),
      subnets: seed.subnet
        ? [{ subnet: seed.subnet, gateway: `${seed.subnet.split('/')[0]?.replace(/\.0$/, '.1')}` }]
        : [],
      labels: seed.project ? { 'com.docker.compose.project': seed.project } : {},
      containers: attached,
      system: seed.system,
      inUse: attached.length > 0,
      composeProject: seed.project
    }
  })
}

export function mockDiskUsage(): DiskUsage {
  return {
    layersSize: 28 * 1024 ** 3,
    images: { count: 9, size: 28 * 1024 ** 3, reclaimable: Math.round(1.92 * 1024 ** 3) },
    containers: {
      count: 8,
      size: Math.round(8.2 * 1024 ** 3),
      reclaimable: Math.round(0.21 * 1024 ** 3)
    },
    volumes: {
      count: 4,
      size: Math.round(4.8 * 1024 ** 3),
      reclaimable: Math.round(1.1 * 1024 ** 3)
    },
    buildCache: {
      count: 24,
      size: Math.round(1.2 * 1024 ** 3),
      reclaimable: Math.round(1.1 * 1024 ** 3)
    }
  }
}

/** 24 hours of samples shaped like the reference chart. */
export function mockUsageHistory(windowHours = 24, now = MOCK_EPOCH): UsageSample[] {
  const points = windowHours * 4
  const random = seededRandom(20_260_516)
  const samples: UsageSample[] = []
  for (let index = 0; index < points; index += 1) {
    const progress = index / points
    const wave = Math.sin(progress * Math.PI * 1.6) * 6
    samples.push({
      timestamp: new Date(now - (points - index) * (3_600_000 / 4)).toISOString(),
      cpuPercent: Math.max(1, Number((14 + wave + random() * 4 + progress * 6).toFixed(2))),
      memoryBytes: Math.round((5.4 + progress * 0.9 + random() * 0.35) * 1024 ** 3),
      diskBytes: Math.round((39 + progress * 3.2 + random() * 0.4) * 1024 ** 3)
    })
  }
  return samples
}

export const MOCK_COMPOSE_YAML = `version: '3.9'

services:
  api:
    image: ghcr.io/fcs/api:1.4.2
    container_name: fcs-api
    ports:
      - "8080:8080"
    environment:
      DB_HOST: mariadb
      REDIS_URL: redis://redis:6379
    depends_on:
      - mariadb
      - redis
    restart: unless-stopped

  ui:
    image: ghcr.io/fcs/ui:2.1.0
    ports:
      - "3000:3000"
    depends_on:
      - api
    restart: unless-stopped

  mariadb:
    image: mariadb:11.3
    ports:
      - "3306:3306"
    environment:
      MARIADB_ROOT_PASSWORD: change-me
    volumes:
      - mariadb_data:/var/lib/mysql

  redis:
    image: redis:7.2-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  mariadb_data:
  redis_data:
`

export function mockComposeProjects(): ComposeProject[] {
  const containers = mockContainers()
  const byProject = new Map<string, ContainerSummary[]>()
  for (const container of containers) {
    if (!container.composeProject) continue
    const list = byProject.get(container.composeProject) ?? []
    list.push(container)
    byProject.set(container.composeProject, list)
  }

  return [...byProject.entries()].map(([name, members]) => ({
    name,
    workingDir: `/home/demo/projects/${name}`,
    configFiles: [`/home/demo/projects/${name}/compose.yml`],
    source: 'running' as const,
    running: members.filter((member) => member.state === 'running').length,
    total: members.length,
    services: members.map((member) => ({
      name: member.composeService ?? member.name,
      image: member.image,
      build: null,
      containerName: member.name,
      ports: member.ports.map((port) => `${port.publicPort}:${port.privatePort}`),
      dependsOn:
        member.composeService === 'api'
          ? ['mariadb', 'redis']
          : member.composeService === 'ui'
            ? ['api']
            : [],
      networks: member.networks,
      volumes: [],
      environmentKeys: ['DB_HOST', 'REDIS_URL'],
      replicas: 1,
      state: member.state,
      health: member.health,
      containers: [{ id: member.id, name: member.name, state: member.state }]
    })),
    networks: [`${name}_default`],
    volumes: name === 'fcs' ? ['mariadb_data', 'redis_data'] : []
  }))
}

export const MOCK_LOG_LINES: { level: string; scope: string; message: string }[] = [
  { level: 'INFO', scope: 'server', message: 'Starting FCS API server on :8080' },
  { level: 'INFO', scope: 'db', message: 'Connected to database mariadb:3306' },
  { level: 'INFO', scope: 'redis', message: 'Connected to Redis at redis:6379' },
  { level: 'INFO', scope: 'migrations', message: 'No pending migrations' },
  { level: 'INFO', scope: 'http', message: 'GET /health 200 OK (2ms)' },
  { level: 'WARN', scope: 'rate-limiter', message: 'High request rate detected from 10.0.0.5' },
  { level: 'WARN', scope: 'auth', message: 'Invalid token for user 7f8e...' },
  { level: 'INFO', scope: 'http', message: 'POST /v1/orders 201 Created (120ms)' },
  { level: 'INFO', scope: 'http', message: 'GET /v1/orders 200 OK (35ms)' },
  {
    level: 'ERROR',
    scope: 'db',
    message: 'Deadlock found when trying to get lock; try restarting transaction'
  }
]
