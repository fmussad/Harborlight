import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { HarborlightError } from '../errors'
import { events } from '../services/events'
import { logger } from '../services/logger'
import { tasks } from '../services/tasks'
import { redactText } from '@shared/utils/redact'

export interface ComposeRunOptions {
  args: string[]
  cwd: string
  label: string
  detail: string
  timeoutMs?: number
}

export interface ComposeCapture {
  code: number | null
  stdout: string
  stderr: string
}

interface ComposeBinary {
  program: string
  prefix: string[]
}

let cachedBinary: ComposeBinary | null | undefined

/**
 * Locates Docker Compose.
 *
 * The v2 plugin (`docker compose`) is preferred; the legacy `docker-compose`
 * binary is accepted as a fallback. Commands are always executed with an
 * argument array and `shell: false`.
 */
export async function resolveComposeBinary(): Promise<ComposeBinary> {
  if (cachedBinary !== undefined) {
    if (cachedBinary === null) {
      throw new HarborlightError('not-found', 'Docker Compose is not installed.', {
        hint: 'Install the plugin with "sudo apt install docker-compose-plugin", or run ./install.sh install --compose install.'
      })
    }
    return cachedBinary
  }

  const candidates: ComposeBinary[] = [
    { program: 'docker', prefix: ['compose'] },
    { program: 'docker-compose', prefix: [] }
  ]

  for (const candidate of candidates) {
    const probe = await capture({
      program: candidate.program,
      args: [...candidate.prefix, 'version', '--short'],
      cwd: process.cwd(),
      timeoutMs: 8000
    }).catch(() => null)
    if (probe && probe.code === 0) {
      cachedBinary = candidate
      logger.info(
        'compose',
        `Using ${candidate.program} ${candidate.prefix.join(' ')} ${probe.stdout.trim()}`
      )
      return candidate
    }
  }

  cachedBinary = null
  throw new HarborlightError('not-found', 'Docker Compose is not installed.', {
    hint: 'Install the plugin with "sudo apt install docker-compose-plugin", or run ./install.sh install --compose install.'
  })
}

/** For argument arrays already starting with "compose", strip our own prefix. */
export function withBinary(
  binary: ComposeBinary,
  args: string[]
): { program: string; args: string[] } {
  if (binary.prefix.length > 0) return { program: binary.program, args }
  return { program: binary.program, args: args[0] === 'compose' ? args.slice(1) : args }
}

const running = new Map<string, ChildProcess>()

/** Runs a Compose command and streams stdout/stderr to the renderer. */
export async function runComposeStreaming(options: ComposeRunOptions): Promise<string> {
  const binary = await resolveComposeBinary()
  const { program, args } = withBinary(binary, options.args)
  const operationId = randomUUID()
  const task = tasks.start({
    kind: 'compose',
    label: options.label,
    detail: options.detail,
    cancellable: true
  })

  logger.info('compose', `Running: ${program} ${args.join(' ')} (cwd=${options.cwd})`)

  const child = spawn(program, args, {
    cwd: options.cwd,
    shell: false,
    env: { ...process.env, COMPOSE_PROGRESS: 'plain', DOCKER_CLI_HINTS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  running.set(operationId, child)

  const emit = (stream: 'stdout' | 'stderr', data: Buffer): void => {
    events.emit('compose:output', { operationId, stream, data: redactText(data.toString('utf8')) })
  }
  child.stdout.on('data', (data: Buffer) => emit('stdout', data))
  child.stderr.on('data', (data: Buffer) => emit('stderr', data))

  const timeout = options.timeoutMs
    ? setTimeout(() => {
        child.kill('SIGTERM')
      }, options.timeoutMs)
    : null

  task.signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true })

  child.on('error', (error) => {
    if (timeout) clearTimeout(timeout)
    running.delete(operationId)
    task.fail(error)
    events.emit('compose:exit', { operationId, exitCode: null, message: error.message })
  })

  child.on('close', (code) => {
    if (timeout) clearTimeout(timeout)
    running.delete(operationId)
    if (code === 0) {
      task.succeed(`${options.label} finished.`)
      events.emit('compose:exit', {
        operationId,
        exitCode: 0,
        message: `${options.label} finished successfully.`
      })
    } else {
      task.fail(new Error(`Exit code ${code ?? 'unknown'}`))
      events.emit('compose:exit', {
        operationId,
        exitCode: code,
        message: `${options.label} failed with exit code ${code ?? 'unknown'}.`
      })
    }
  })

  return operationId
}

export function cancelComposeOperation(operationId: string): void {
  const child = running.get(operationId)
  if (!child)
    throw new HarborlightError('not-found', 'That Compose operation is no longer running.')
  child.kill('SIGTERM')
}

/** Runs a Compose (or docker) command and buffers its output. */
export function capture(options: {
  program: string
  args: string[]
  cwd: string
  timeoutMs?: number
  maxBuffer?: number
}): Promise<ComposeCapture> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.program, options.args, {
      cwd: options.cwd,
      shell: false,
      env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const limit = options.maxBuffer ?? 8 * 1024 * 1024
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
          if (!settled) {
            settled = true
            reject(new HarborlightError('timeout', `${options.program} did not answer in time.`))
          }
        }, options.timeoutMs)
      : null

    child.stdout.on('data', (data: Buffer) => {
      if (stdout.length < limit) stdout += data.toString('utf8')
    })
    child.stderr.on('data', (data: Buffer) => {
      if (stderr.length < limit) stderr += data.toString('utf8')
    })
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      if (settled) return
      settled = true
      reject(
        new HarborlightError('not-found', `Could not run "${options.program}": ${error.message}`, {
          hint: `Make sure ${options.program} is installed and on PATH.`
        })
      )
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (settled) return
      settled = true
      resolve({ code, stdout, stderr })
    })
  })
}
