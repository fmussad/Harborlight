import type { HarborlightErrorPayload } from '@shared/contracts/responses'

export type ErrorCode = HarborlightErrorPayload['code']

/**
 * The only error type that crosses the IPC boundary. Handlers throw it with a
 * code plus a recovery hint so the renderer can render an actionable message
 * instead of a raw stack trace.
 */
export class HarborlightError extends Error {
  readonly code: ErrorCode
  readonly hint: string | null
  readonly details: string | null

  constructor(
    code: ErrorCode,
    message: string,
    options: { hint?: string | null; details?: string | null; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'HarborlightError'
    this.code = code
    this.hint = options.hint ?? null
    this.details = options.details ?? null
  }

  toPayload(): HarborlightErrorPayload {
    return { code: this.code, message: this.message, hint: this.hint, details: this.details }
  }
}

interface DockerLikeError {
  statusCode?: number
  code?: string
  reason?: string
  json?: { message?: string }
  message?: string
  address?: string
}

const DOCKER_GROUP_HINT =
  'Your user needs read/write access to the Docker socket. Add yourself to the "docker" group (this grants root-equivalent power) and log out and back in, or switch Harborlight to a rootless socket in Settings.'

const ENGINE_DOWN_HINT =
  'Start the Docker Engine with "sudo systemctl start docker" (or "systemctl --user start docker" for rootless) and reconnect from Settings.'

/** Maps Dockerode / libc errors onto Harborlight error codes with hints. */
export function fromDockerError(error: unknown, context: string): HarborlightError {
  if (error instanceof HarborlightError) return error

  const candidate = (error ?? {}) as DockerLikeError
  const rawMessage =
    candidate.json?.message ?? candidate.reason ?? candidate.message ?? String(error)
  const message = rawMessage.trim() || 'Unknown Docker error'

  if (candidate.code === 'EACCES' || candidate.code === 'EPERM') {
    return new HarborlightError(
      'permission-denied',
      `${context}: permission denied by the Docker socket.`,
      {
        hint: DOCKER_GROUP_HINT,
        details: message,
        cause: error
      }
    )
  }

  if (candidate.code === 'ENOENT' || candidate.code === 'ECONNREFUSED') {
    return new HarborlightError(
      'engine-unavailable',
      `${context}: the Docker Engine is not reachable.`,
      {
        hint: ENGINE_DOWN_HINT,
        details: message,
        cause: error
      }
    )
  }

  if (candidate.code === 'ETIMEDOUT') {
    return new HarborlightError(
      'timeout',
      `${context}: the Docker Engine did not answer in time.`,
      {
        hint: 'The engine may be busy. Retry, or increase the polling interval in Settings.',
        details: message,
        cause: error
      }
    )
  }

  switch (candidate.statusCode) {
    case 304:
      return new HarborlightError(
        'conflict',
        `${context}: the resource is already in that state.`,
        {
          details: message,
          cause: error
        }
      )
    case 404:
      return new HarborlightError('not-found', `${context}: the resource no longer exists.`, {
        hint: 'Refresh the list — it was probably removed outside Harborlight.',
        details: message,
        cause: error
      })
    case 409:
      return new HarborlightError('conflict', `${context}: Docker refused the operation.`, {
        hint: 'The resource is in use. Stop or disconnect the dependent resources first, or use the force option.',
        details: message,
        cause: error
      })
    case 500:
      return new HarborlightError(
        'unknown',
        `${context}: the Docker Engine reported an internal error.`,
        {
          details: message,
          cause: error
        }
      )
    default:
      break
  }

  return new HarborlightError('unknown', `${context}: ${message}`, {
    details: message,
    cause: error
  })
}

export function toErrorPayload(error: unknown): HarborlightErrorPayload {
  if (error instanceof HarborlightError) return error.toPayload()
  if (error instanceof Error) {
    return { code: 'unknown', message: error.message, hint: null, details: error.stack ?? null }
  }
  return { code: 'unknown', message: String(error), hint: null, details: null }
}
