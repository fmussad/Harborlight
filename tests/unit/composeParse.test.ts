import { describe, expect, it } from 'vitest'
import {
  composeProjectFromYaml,
  lintComposeDocument,
  parseComposeYaml
} from '@shared/compose/parse'

const VALID = `services:
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
  mariadb:
    image: mariadb:11.3
  redis:
    image: redis:7.2-alpine
volumes:
  db_data:
networks:
  default:
`

describe('parseComposeYaml', () => {
  it('parses a valid document', () => {
    const { data, error } = parseComposeYaml(VALID)
    expect(error).toBeNull()
    expect(Object.keys(data.services)).toEqual(['api', 'mariadb', 'redis'])
  })

  it('reports the line of a syntax error', () => {
    const { data, error } = parseComposeYaml('services:\n  api:\n    image: "unterminated\n')
    expect(data).toBeNull()
    expect(error?.valid).toBe(false)
    expect(error?.problems[0]?.line).toBeGreaterThan(0)
  })

  it('rejects an empty document', () => {
    const { error } = parseComposeYaml('')
    expect(error?.message).toMatch(/empty|parsed/i)
  })

  it('rejects a top-level list', () => {
    const { error } = parseComposeYaml('- one\n- two\n')
    expect(error?.problems[0]?.message).toMatch(/mapping/i)
  })
})

describe('composeProjectFromYaml', () => {
  const { data } = parseComposeYaml(VALID)
  const project = composeProjectFromYaml(data, {
    name: 'fcs',
    workingDir: '/srv/fcs',
    configFiles: ['/srv/fcs/compose.yml']
  })

  it('captures the service graph', () => {
    expect(project.total).toBe(3)
    const api = project.services.find((service) => service.name === 'api')
    expect(api?.image).toBe('ghcr.io/fcs/api:1.4.2')
    expect(api?.dependsOn).toEqual(['mariadb', 'redis'])
    expect(api?.ports).toEqual(['8080:8080'])
  })

  it('lists environment keys without their values', () => {
    const api = project.services.find((service) => service.name === 'api')
    expect(api?.environmentKeys).toEqual(['DB_HOST', 'REDIS_URL'])
  })

  it('collects top-level volumes and networks', () => {
    expect(project.volumes).toEqual(['db_data'])
    expect(project.networks).toEqual(['default'])
  })

  it('understands the long port syntax and build contexts', () => {
    const { data: longForm } = parseComposeYaml(
      'services:\n  web:\n    build:\n      context: ./web\n    ports:\n      - target: 80\n        published: 8081\n'
    )
    const parsed = composeProjectFromYaml(longForm, {
      name: 'x',
      workingDir: null,
      configFiles: []
    })
    expect(parsed.services[0]?.build).toBe('./web')
    expect(parsed.services[0]?.ports).toEqual(['8081:80'])
  })
})

describe('lintComposeDocument', () => {
  it('accepts a well-formed project', () => {
    const { data } = parseComposeYaml(VALID)
    expect(lintComposeDocument(data)).toEqual([])
  })

  it('complains when there are no services', () => {
    const { data } = parseComposeYaml('version: "3.9"\n')
    expect(lintComposeDocument(data)[0]?.message).toMatch(/No services/)
  })

  it('flags a service with neither image nor build', () => {
    const { data } = parseComposeYaml('services:\n  api:\n    ports:\n      - "80:80"\n')
    expect(lintComposeDocument(data)[0]?.message).toMatch(/neither "image" nor "build"/)
  })

  it('flags a dependency that does not exist', () => {
    const { data } = parseComposeYaml(
      'services:\n  api:\n    image: nginx\n    depends_on:\n      - ghost\n'
    )
    expect(lintComposeDocument(data).some((problem) => problem.message.includes('ghost'))).toBe(
      true
    )
  })

  it('warns about an impossible published port', () => {
    const { data } = parseComposeYaml(
      'services:\n  api:\n    image: nginx\n    ports:\n      - "99999:80"\n'
    )
    const problems = lintComposeDocument(data)
    expect(problems.some((problem) => problem.severity === 'warning')).toBe(true)
  })
})
