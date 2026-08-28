import { load, type YAMLException } from 'js-yaml'
import type { ComposeProject, ComposeService, ComposeValidation } from '../schemas/domain'

/* eslint-disable @typescript-eslint/no-explicit-any --
 * A Compose file is arbitrary user YAML; every field is read defensively and
 * converted into the typed ComposeProject below. */

/**
 * Local YAML parsing used for the editor, the topology graph and instant
 * feedback. `docker compose config` remains the authority for validation —
 * this parser never rewrites the user's file.
 */
export function parseComposeYaml(content: string): {
  data: any | null
  error: ComposeValidation | null
} {
  try {
    const data = load(content, { filename: 'compose.yml' })
    if (data === null || data === undefined) {
      return {
        data: null,
        error: {
          valid: false,
          message: 'The Compose file is empty.',
          normalized: null,
          problems: [{ line: 1, column: 1, severity: 'error', message: 'No YAML document found.' }]
        }
      }
    }
    if (typeof data !== 'object' || Array.isArray(data)) {
      return {
        data: null,
        error: {
          valid: false,
          message: 'A Compose file must be a YAML mapping.',
          normalized: null,
          problems: [
            {
              line: 1,
              column: 1,
              severity: 'error',
              message: 'Expected a mapping at the top level.'
            }
          ]
        }
      }
    }
    return { data, error: null }
  } catch (error) {
    const yamlError = error as YAMLException
    return {
      data: null,
      error: {
        valid: false,
        message: yamlError.reason ?? 'The Compose file could not be parsed.',
        normalized: null,
        problems: [
          {
            line: yamlError.mark ? yamlError.mark.line + 1 : null,
            column: yamlError.mark ? yamlError.mark.column + 1 : null,
            severity: 'error',
            message: yamlError.reason ?? String(error)
          }
        ]
      }
    }
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry))
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>)
  return []
}

function portsOf(service: any): string[] {
  const ports = service?.ports
  if (!Array.isArray(ports)) return []
  return ports.map((port: any) => {
    if (typeof port === 'string' || typeof port === 'number') return String(port)
    const published = port?.published ?? ''
    const target = port?.target ?? ''
    return published ? `${published}:${target}` : String(target)
  })
}

function environmentKeys(service: any): string[] {
  const env = service?.environment
  if (Array.isArray(env)) return env.map((entry: string) => String(entry).split('=')[0] ?? '')
  if (env && typeof env === 'object') return Object.keys(env)
  return []
}

function dependsOn(service: any): string[] {
  const depends = service?.depends_on
  if (Array.isArray(depends)) return depends.map(String)
  if (depends && typeof depends === 'object') return Object.keys(depends)
  return []
}

/** Turns parsed YAML into the project model the Compose Studio renders. */
export function composeProjectFromYaml(
  data: any,
  options: { name: string; workingDir: string | null; configFiles: string[] }
): ComposeProject {
  const rawServices = (data?.services ?? {}) as Record<string, any>
  const services: ComposeService[] = Object.entries(rawServices).map(([name, service]) => ({
    name,
    image: service?.image ? String(service.image) : null,
    build: service?.build
      ? typeof service.build === 'string'
        ? String(service.build)
        : String(service.build?.context ?? '.')
      : null,
    containerName: service?.container_name ? String(service.container_name) : null,
    ports: portsOf(service),
    dependsOn: dependsOn(service),
    networks: toStringArray(service?.networks),
    volumes: toStringArray(service?.volumes),
    environmentKeys: environmentKeys(service),
    replicas: Number(service?.deploy?.replicas ?? 1) || 1,
    state: null,
    health: 'none',
    containers: []
  }))

  return {
    name: options.name,
    workingDir: options.workingDir,
    configFiles: options.configFiles,
    source: 'opened',
    running: 0,
    total: services.length,
    services,
    networks: Object.keys((data?.networks ?? {}) as Record<string, unknown>),
    volumes: Object.keys((data?.volumes ?? {}) as Record<string, unknown>)
  }
}

/** Structural checks that complement `docker compose config`. */
export function lintComposeDocument(data: any): ComposeValidation['problems'] {
  const problems: ComposeValidation['problems'] = []
  const services = data?.services

  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) {
    problems.push({
      line: null,
      column: null,
      severity: 'error',
      message: 'No services are defined.'
    })
    return problems
  }

  const names = Object.keys(services)
  for (const [name, service] of Object.entries<any>(services)) {
    if (!service || typeof service !== 'object') {
      problems.push({
        line: null,
        column: null,
        severity: 'error',
        message: `Service "${name}" is empty.`
      })
      continue
    }
    if (!service.image && !service.build) {
      problems.push({
        line: null,
        column: null,
        severity: 'error',
        message: `Service "${name}" declares neither "image" nor "build".`
      })
    }
    for (const dependency of dependsOn(service)) {
      if (!names.includes(dependency)) {
        problems.push({
          line: null,
          column: null,
          severity: 'error',
          message: `Service "${name}" depends on "${dependency}", which is not defined.`
        })
      }
    }
    for (const port of portsOf(service)) {
      const published = port.includes(':') ? Number(port.split(':')[0]) : null
      if (published !== null && (Number.isNaN(published) || published < 1 || published > 65_535)) {
        problems.push({
          line: null,
          column: null,
          severity: 'warning',
          message: `Service "${name}" publishes an unusual port mapping "${port}".`
        })
      }
    }
  }

  return problems
}
