import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  type WriteStream
} from 'node:fs'
import { join } from 'node:path'
import { redactText } from '@shared/utils/redact'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_LOG_BYTES = 5 * 1024 * 1024
const RING_BUFFER_SIZE = 500

export interface LogRecord {
  timestamp: string
  level: LogLevel
  scope: string
  message: string
}

/**
 * Application logger.
 *
 * Every line is passed through {@link redactText} before it reaches disk, the
 * console or the diagnostics export, so tokens and connection strings that
 * appear in Docker error payloads never get persisted.
 */
class Logger {
  private stream: WriteStream | null = null
  private filePath: string | null = null
  private minimum: LogLevel = process.env.HARBORLIGHT_LOG_LEVEL === 'debug' ? 'debug' : 'info'
  private readonly ring: LogRecord[] = []

  configure(directory: string, fileName = 'harborlight.log'): void {
    mkdirSync(directory, { recursive: true })
    const target = join(directory, fileName)
    this.rotateIfNeeded(target)
    this.filePath = target
    this.stream = createWriteStream(target, { flags: 'a' })
  }

  setLevel(level: LogLevel): void {
    this.minimum = level
  }

  getFilePath(): string | null {
    return this.filePath
  }

  recent(limit = RING_BUFFER_SIZE): LogRecord[] {
    return this.ring.slice(-limit)
  }

  debug(scope: string, message: string, extra?: unknown): void {
    this.write('debug', scope, message, extra)
  }

  info(scope: string, message: string, extra?: unknown): void {
    this.write('info', scope, message, extra)
  }

  warn(scope: string, message: string, extra?: unknown): void {
    this.write('warn', scope, message, extra)
  }

  error(scope: string, message: string, extra?: unknown): void {
    this.write('error', scope, message, extra)
  }

  private rotateIfNeeded(target: string): void {
    try {
      if (existsSync(target) && statSync(target).size > MAX_LOG_BYTES) {
        renameSync(target, `${target}.1`)
      }
    } catch {
      // A rotation failure must never prevent the app from starting.
    }
  }

  private write(level: LogLevel, scope: string, message: string, extra?: unknown): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minimum]) return

    const detail = extra === undefined ? '' : ` ${safeStringify(extra)}`
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      message: redactText(`${message}${detail}`)
    }

    this.ring.push(record)
    if (this.ring.length > RING_BUFFER_SIZE) this.ring.shift()

    const line = `${record.timestamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${record.message}\n`
    if (this.stream) this.stream.write(line)
    if (level === 'error') process.stderr.write(line)
    else if (!process.env.HARBORLIGHT_QUIET) process.stdout.write(line)
  }
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

export const logger = new Logger()
