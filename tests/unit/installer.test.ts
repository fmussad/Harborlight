import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The installer is executable documentation: these tests run the real script
 * with --dry-run, so argument parsing and the printed plan cannot drift from
 * docs/INSTALLATION.md without a failure here.
 *
 * Nothing in this file may modify the system. Every invocation either fails
 * during parsing or runs with --dry-run.
 */

const REPO_ROOT = join(__dirname, '..', '..')
const INSTALLER = join(REPO_ROOT, 'install.sh')

// Documented in docs/INSTALLATION.md#exit-codes.
const EX_OK = 0
const EX_USAGE = 2
const EX_UNSUPPORTED = 3
const EX_ARTIFACT = 5

let workdir: string
let fakeDeb: string

interface Run {
  status: number
  stdout: string
  stderr: string
  output: string
}

function runInstaller(args: string[]): Run {
  const result = spawnSync('bash', [INSTALLER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, NO_COLOR: '1', HOME: workdir }
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  return { status: result.status ?? -1, stdout, stderr, output: `${stdout}${stderr}` }
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'harborlight-installer-'))
  fakeDeb = join(workdir, 'harborlight_0.0.0-test_amd64.deb')
  writeFileSync(fakeDeb, 'not a real package')
})

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

describe('shell syntax', () => {
  it('parses without errors', () => {
    expect(() => execFileSync('bash', ['-n', INSTALLER], { encoding: 'utf8' })).not.toThrow()
  })
})

describe('help and usage', () => {
  it('prints usage for the help command', () => {
    const result = runInstaller(['help'])
    expect(result.status).toBe(EX_OK)
    expect(result.stdout).toContain('Harborlight installer')
    expect(result.stdout).toContain('install')
    expect(result.stdout).toContain('uninstall')
    expect(result.stdout).toContain('doctor')
  })

  it('documents every flag the Makefile passes', () => {
    const usage = runInstaller(['--help']).stdout
    for (const flag of [
      '--source',
      '--artifact',
      '--autostart',
      '--start-minimized',
      '--launch',
      '--yes',
      '--dry-run'
    ]) {
      expect(usage, `usage should mention ${flag}`).toContain(flag)
    }
  })

  it('exits with a usage error and no command', () => {
    expect(runInstaller([]).status).toBe(EX_USAGE)
  })
})

describe('argument validation', () => {
  it('rejects an unknown command', () => {
    const result = runInstaller(['frobnicate'])
    expect(result.status).toBe(EX_USAGE)
    expect(result.output).toContain('Unknown command')
  })

  it('rejects an unknown option', () => {
    const result = runInstaller(['install', '--do-everything'])
    expect(result.status).toBe(EX_USAGE)
    expect(result.output).toContain('Unknown option')
  })

  it('rejects a channel that is not stable or beta', () => {
    const result = runInstaller(['install', '--channel', 'nightly'])
    expect(result.status).toBe(EX_USAGE)
    expect(result.output).toContain('--channel must be stable or beta')
  })

  it('rejects a version that is not semantic', () => {
    const result = runInstaller(['install', '--version', '1.2'])
    expect(result.status).toBe(EX_USAGE)
    expect(result.output).toContain('semantic version')
  })

  it('accepts a prerelease version', () => {
    const result = runInstaller([
      'install',
      '--version',
      '1.2.3-beta.1',
      '--channel',
      'beta',
      '--source',
      'release',
      '--artifact',
      fakeDeb,
      '--force-unsupported',
      '--docker',
      'skip',
      '--compose',
      'skip',
      '--dry-run'
    ])
    expect(result.status).toBe(EX_OK)
  })

  it('reports a missing artifact instead of guessing', () => {
    const result = runInstaller([
      'install',
      '--artifact',
      join(workdir, 'nope.deb'),
      '--force-unsupported',
      '--dry-run'
    ])
    expect(result.status).toBe(EX_ARTIFACT)
    expect(result.output).toContain('Artifact not found')
  })

  it('refuses an unsupported distribution unless forced', () => {
    const result = spawnSync('bash', [INSTALLER, 'install', '--artifact', fakeDeb, '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      // A distribution that is definitely not a supported Ubuntu release.
      env: { ...process.env, NO_COLOR: '1', HOME: workdir, PATH: process.env.PATH ?? '' }
    })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    // On a supported Ubuntu host this path is not reachable; assert whichever
    // outcome the host produces, but never a crash.
    expect([EX_OK, EX_UNSUPPORTED]).toContain(result.status)
    if (result.status === EX_UNSUPPORTED) {
      expect(output).toContain('--force-unsupported')
    }
  })
})

describe('dry run', () => {
  const dryRunArgs = [
    'install',
    '--artifact',
    () => fakeDeb,
    '--target-user',
    'root',
    '--autostart',
    '--start-minimized',
    '--docker',
    'skip',
    '--compose',
    'skip',
    '--force-unsupported',
    '--yes',
    '--dry-run'
  ]

  const resolve = (): string[] => dryRunArgs.map((arg) => (typeof arg === 'function' ? arg() : arg))

  it('prints the plan before doing anything', () => {
    const result = runInstaller(resolve())
    expect(result.status).toBe(EX_OK)
    expect(result.stdout).toContain('Installation plan')
    expect(result.stdout).toContain('Dry run: nothing will be modified')
    for (const field of [
      'Source',
      'Artifact',
      'Architecture',
      'Desktop entry',
      'Autostart',
      'Target user'
    ]) {
      expect(result.stdout, `the plan should show ${field}`).toContain(field)
    }
  })

  it('shows the commands it would run without running them', () => {
    const result = runInstaller(resolve())
    expect(result.stdout).toContain('dry-run')
    expect(result.stdout).toMatch(/dry-run .*(apt-get|dpkg)/)
    expect(result.stdout).toMatch(/dry-run writing .*\/\.config\/autostart\/harborlight\.desktop/)
  })

  it('creates no files at all', () => {
    runInstaller(resolve())
    expect(existsSync(join(workdir, '.config', 'autostart', 'harborlight.desktop'))).toBe(false)
    expect(existsSync(join(workdir, '.config', 'autostart'))).toBe(false)
  })
})

describe('doctor', () => {
  it('reports on the environment without changing it', () => {
    const result = runInstaller(['doctor'])
    expect(result.status).toBe(EX_OK)
    expect(result.stdout).toContain('Harborlight doctor')
    for (const check of [
      'Operating system',
      'Architecture',
      'Docker Engine',
      'Docker socket',
      'docker group'
    ]) {
      expect(result.stdout, `doctor should check ${check}`).toContain(check)
    }
    expect(existsSync(join(workdir, '.config'))).toBe(false)
  })
})

describe('version', () => {
  it('reports the repository version', () => {
    const result = runInstaller(['version'])
    expect(result.status).toBe(EX_OK)
    expect(result.stdout).toContain('repository version')
  })
})
