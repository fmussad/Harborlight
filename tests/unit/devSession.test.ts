import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * `make dev` and `make stop` manage a PID file so a development session can be
 * stopped without ever signalling an unrelated Electron process — including the
 * editor the contributor is using.
 *
 * The scripts derive their root from their own location, so each test copies
 * them into a throwaway directory. A real session in this checkout is never
 * touched.
 */

const REPO_ROOT = join(__dirname, '..', '..')

let root: string
let pidFile: string
let started: number[] = []

function script(name: string): string {
  return join(root, 'scripts', name)
}

function run(name: string): { status: number; output: string } {
  const result = spawnSync('bash', [script(name)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000
  })
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/**
 * A long-lived process leading its own session, exactly like scripts/dev.sh
 * creates. It is deliberately not a child of the test process: an orphan is
 * reaped by init, so `kill -0` reflects real liveness rather than lingering as
 * a zombie while Vitest blocks on a synchronous script run.
 */
function startFakeSession(record = true): number {
  const output = spawnSync(
    'bash',
    ['-c', 'setsid sleep 120 >/dev/null 2>&1 </dev/null & echo $!'],
    {
      encoding: 'utf8'
    }
  ).stdout.trim()
  const pid = Number(output)
  expect(Number.isInteger(pid) && pid > 1).toBe(true)
  started.push(pid)
  if (record) writeFileSync(pidFile, String(pid))
  return pid
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A PID that is guaranteed to be gone by the time it is used. */
function deadPid(): string {
  return spawnSync('bash', ['-c', 'sleep 0 & pid=$!; wait $pid; echo $pid'], {
    encoding: 'utf8'
  }).stdout.trim()
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harborlight-dev-'))
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, '.harborlight'))
  for (const name of ['dev.sh', 'stop.sh']) {
    copyFileSync(join(REPO_ROOT, 'scripts', name), join(root, 'scripts', name))
  }
  pidFile = join(root, '.harborlight', 'dev.pid')
})

afterEach(() => {
  for (const pid of started) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // already stopped
    }
  }
  started = []
  rmSync(root, { recursive: true, force: true })
})

describe('scripts/stop.sh', () => {
  it('succeeds when nothing was ever started', () => {
    const result = run('stop.sh')
    expect(result.status).toBe(0)
    expect(result.output).toContain('No development session is recorded')
  })

  it('terminates the recorded process group and removes the PID file', () => {
    const pid = startFakeSession()

    const result = run('stop.sh')

    expect(result.status).toBe(0)
    expect(result.output).toContain('Stopped')
    expect(result.output).not.toContain('SIGKILL')
    expect(existsSync(pidFile)).toBe(false)
    expect(isAlive(pid)).toBe(false)
  })

  it('cleans up a stale PID file without signalling anything', () => {
    writeFileSync(pidFile, deadPid())

    const result = run('stop.sh')

    expect(result.status).toBe(0)
    expect(result.output).toContain('already gone')
    expect(existsSync(pidFile)).toBe(false)
  })

  it('handles an empty PID file', () => {
    writeFileSync(pidFile, '')

    const result = run('stop.sh')

    expect(result.status).toBe(0)
    expect(result.output).toContain('empty')
    expect(existsSync(pidFile)).toBe(false)
  })

  it('is safe to run twice', () => {
    startFakeSession()

    expect(run('stop.sh').status).toBe(0)
    const second = run('stop.sh')

    expect(second.status).toBe(0)
    expect(second.output).toContain('No development session is recorded')
  })

  it('leaves processes it did not start alone', () => {
    const bystander = startFakeSession(false)
    const session = startFakeSession()

    run('stop.sh')

    expect(isAlive(session)).toBe(false)
    expect(isAlive(bystander)).toBe(true)
  })
})

describe('scripts/dev.sh', () => {
  it('does not start a second session when one is already recorded', () => {
    const pid = startFakeSession()

    const result = run('dev.sh')

    expect(result.status).toBe(0)
    expect(result.output).toContain(`already running (pid ${pid})`)
    expect(readFileSync(pidFile, 'utf8')).toBe(String(pid))
    expect(isAlive(pid)).toBe(true)
  })

  it('refuses to start before dependencies are installed', () => {
    // No node_modules in the throwaway root, and no live PID file.
    const result = run('dev.sh')

    expect(result.status).toBe(1)
    expect(result.output).toContain('make bootstrap')
    expect(existsSync(pidFile)).toBe(false)
  })

  it('discards a stale PID file instead of refusing to start', () => {
    writeFileSync(pidFile, deadPid())

    // Without node_modules the script stops right after clearing the stale file,
    // which is the behaviour under test: it did not report "already running".
    const result = run('dev.sh')

    expect(result.output).not.toContain('already running')
    expect(existsSync(pidFile)).toBe(false)
  })
})
