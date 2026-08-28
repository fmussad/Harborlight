import { describe, expect, it } from 'vitest'
import {
  buildComposeArgs,
  buildComposeConfigArgs,
  formatCommandPreview,
  isDestructiveAction,
  requiresVolumeConfirmation,
  type ComposeCommandSpec
} from '@main/compose/args'

function spec(overrides: Partial<ComposeCommandSpec> = {}): ComposeCommandSpec {
  return {
    action: 'up',
    projectName: 'fcs',
    workingDir: '/srv/fcs',
    files: ['/srv/fcs/compose.yml'],
    services: [],
    detach: true,
    removeVolumes: false,
    removeOrphans: false,
    noCache: false,
    ...overrides
  }
}

describe('buildComposeArgs', () => {
  it('always scopes the command to the project and its files', () => {
    expect(buildComposeArgs(spec())).toEqual([
      'compose',
      '--project-name',
      'fcs',
      '--file',
      '/srv/fcs/compose.yml',
      'up',
      '--detach'
    ])
  })

  it('passes every override file', () => {
    const args = buildComposeArgs(
      spec({ files: ['/srv/fcs/compose.yml', '/srv/fcs/prod.compose.yml'], detach: false })
    )
    expect(args.filter((entry) => entry === '--file')).toHaveLength(2)
    expect(args).not.toContain('--detach')
  })

  it('adds --volumes only when the user asked for it', () => {
    expect(buildComposeArgs(spec({ action: 'down' }))).not.toContain('--volumes')
    expect(buildComposeArgs(spec({ action: 'down', removeVolumes: true }))).toContain('--volumes')
  })

  it('never passes service names to down', () => {
    const args = buildComposeArgs(spec({ action: 'down', services: ['api'] }))
    expect(args).not.toContain('api')
  })

  it('limits other actions to the selected services', () => {
    expect(buildComposeArgs(spec({ action: 'restart', services: ['api', 'ui'] }))).toEqual([
      'compose',
      '--project-name',
      'fcs',
      '--file',
      '/srv/fcs/compose.yml',
      'restart',
      'api',
      'ui'
    ])
  })

  it('maps rebuild onto up --build --force-recreate', () => {
    expect(buildComposeArgs(spec({ action: 'rebuild' }))).toContain('--force-recreate')
  })

  it('honours --no-cache for build', () => {
    expect(buildComposeArgs(spec({ action: 'build', noCache: true }))).toContain('--no-cache')
    expect(buildComposeArgs(spec({ action: 'build' }))).not.toContain('--no-cache')
  })
})

describe('buildComposeConfigArgs', () => {
  it('builds the validation command', () => {
    expect(buildComposeConfigArgs({ projectName: 'fcs', files: ['/srv/fcs/compose.yml'] })).toEqual(
      ['compose', '--project-name', 'fcs', '--file', '/srv/fcs/compose.yml', 'config']
    )
  })
})

describe('formatCommandPreview', () => {
  it('quotes only what needs quoting', () => {
    expect(
      formatCommandPreview('docker', ['compose', '--file', '/srv/my project/compose.yml'])
    ).toBe("docker compose --file '/srv/my project/compose.yml'")
  })
})

describe('destructive actions', () => {
  it('flags down as destructive', () => {
    expect(isDestructiveAction({ action: 'down', removeVolumes: false })).toBe(true)
    expect(isDestructiveAction({ action: 'up', removeVolumes: false })).toBe(false)
    expect(isDestructiveAction({ action: 'stop', removeVolumes: false })).toBe(false)
  })

  it('requires an extra confirmation before deleting volumes', () => {
    expect(requiresVolumeConfirmation({ action: 'down', removeVolumes: true })).toBe(true)
    expect(requiresVolumeConfirmation({ action: 'down', removeVolumes: false })).toBe(false)
  })
})
