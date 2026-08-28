import type { ComposeProject, ComposeService, ContainerSummary } from '@shared/schemas/domain'

/**
 * Rebuilds Compose projects from the labels Docker Compose writes onto every
 * container it creates. This is how Harborlight finds projects that are
 * already running without asking the user to locate their YAML first.
 */
export function projectsFromContainers(containers: ContainerSummary[]): ComposeProject[] {
  const groups = new Map<string, ContainerSummary[]>()
  for (const container of containers) {
    const project = container.composeProject
    if (!project) continue
    const list = groups.get(project) ?? []
    list.push(container)
    groups.set(project, list)
  }

  const projects: ComposeProject[] = []
  for (const [name, members] of groups) {
    const workingDir = firstLabel(members, 'com.docker.compose.project.working_dir')
    const configFiles = (firstLabel(members, 'com.docker.compose.project.config_files') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (entry.startsWith('/') || !workingDir ? entry : `${workingDir}/${entry}`))

    const services = new Map<string, ComposeService>()
    for (const member of members) {
      const serviceName = member.composeService ?? member.name
      const existing = services.get(serviceName)
      const containerEntry = { id: member.id, name: member.name, state: member.state }
      if (existing) {
        existing.replicas += 1
        existing.containers.push(containerEntry)
        if (member.state === 'running') existing.state = 'running'
        continue
      }
      services.set(serviceName, {
        name: serviceName,
        image: member.image,
        build: null,
        containerName: member.name,
        ports: member.ports.map((port) =>
          port.publicPort ? `${port.publicPort}:${port.privatePort}` : `${port.privatePort}`
        ),
        dependsOn: parseDependsOn(member.labels['com.docker.compose.depends_on']),
        networks: member.networks,
        volumes: [],
        environmentKeys: [],
        replicas: 1,
        state: member.state,
        health: member.health,
        containers: [containerEntry]
      })
    }

    const serviceList = [...services.values()].sort((a, b) => a.name.localeCompare(b.name))
    projects.push({
      name,
      workingDir: workingDir ?? null,
      configFiles,
      source: 'running',
      running: members.filter((member) => member.state === 'running').length,
      total: members.length,
      services: serviceList,
      networks: [...new Set(members.flatMap((member) => member.networks))],
      volumes: []
    })
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name))
}

function firstLabel(containers: ContainerSummary[], label: string): string | null {
  for (const container of containers) {
    const value = container.labels[label]
    if (value) return value
  }
  return null
}

/**
 * Compose stores dependencies as `service:condition:required` triples,
 * e.g. `mariadb:service_started:true,redis:service_healthy:true`.
 */
export function parseDependsOn(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.split(':')[0]?.trim() ?? '')
    .filter(Boolean)
}

/** Overlays live container state onto a project parsed from YAML. */
export function mergeProjectState(
  parsed: ComposeProject,
  running: ComposeProject | null
): ComposeProject {
  if (!running) return parsed
  const byName = new Map(running.services.map((service) => [service.name, service]))
  const services = parsed.services.map((service) => {
    const live = byName.get(service.name)
    if (!live) return service
    return {
      ...service,
      state: live.state,
      health: live.health,
      containers: live.containers,
      replicas: live.replicas
    }
  })
  return {
    ...parsed,
    services,
    running: services.filter((service) => service.state === 'running').length,
    total: services.length
  }
}
