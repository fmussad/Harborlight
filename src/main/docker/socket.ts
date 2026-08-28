import { accessSync, constants, statSync } from 'node:fs'
import type { SocketCandidate } from '@shared/schemas/domain'
import { HarborlightError } from '../errors'

export const DEFAULT_SOCKET = '/var/run/docker.sock'

/**
 * Accepts `unix:///path`, `unix://path` or a bare absolute path and returns the
 * filesystem path. TCP endpoints are rejected on purpose: Harborlight never
 * silently talks to a remote daemon (see docs/SECURITY.md).
 */
export function normalizeSocketPath(input: string): string {
  const value = input.trim()
  if (!value) throw new HarborlightError('validation', 'The Docker socket path is empty.')

  if (/^(tcp|http|https|ssh):\/\//i.test(value)) {
    throw new HarborlightError(
      'unsupported',
      'Remote Docker endpoints are not supported in this version.',
      {
        hint: 'Harborlight only connects to local UNIX sockets. Remote contexts are planned behind an explicit, authenticated adapter.'
      }
    )
  }

  const withoutScheme = value.replace(/^unix:\/\//i, '')
  const path = withoutScheme.startsWith('/') ? withoutScheme : `/${withoutScheme}`

  if (path.split('/').includes('..')) {
    throw new HarborlightError('validation', 'The Docker socket path must not contain "..".')
  }
  if (/[\0\n\r]/.test(path)) {
    throw new HarborlightError('validation', 'The Docker socket path contains control characters.')
  }
  return path
}

export function rootlessSocketPath(uid: number): string {
  return `/run/user/${uid}/docker.sock`
}

/** Well-known socket locations, in the order Harborlight prefers them. */
export function candidateSocketPaths(uid: number, env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = []
  const fromEnv = env.DOCKER_HOST?.trim()
  if (fromEnv && /^unix:\/\//i.test(fromEnv)) {
    candidates.push(normalizeSocketPath(fromEnv))
  }
  const rootless = rootlessSocketPath(uid)
  const xdg = env.XDG_RUNTIME_DIR ? `${env.XDG_RUNTIME_DIR}/docker.sock` : null
  for (const candidate of [rootless, xdg, DEFAULT_SOCKET]) {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate)
  }
  return candidates
}

export function inspectSocket(path: string, uid: number): SocketCandidate {
  const rootless = path.startsWith('/run/user/')
  let exists: boolean
  let readable = false
  try {
    exists = statSync(path).isSocket()
  } catch {
    exists = false
  }
  if (exists) {
    try {
      accessSync(path, constants.R_OK | constants.W_OK)
      readable = true
    } catch {
      readable = false
    }
  }
  return {
    path,
    label: rootless
      ? `Rootless Docker (uid ${uid})`
      : path === DEFAULT_SOCKET
        ? 'System Docker'
        : 'Custom socket',
    exists,
    readable,
    rootless
  }
}

export function detectSockets(uid = process.getuid?.() ?? 0): SocketCandidate[] {
  return candidateSocketPaths(uid).map((path) => inspectSocket(path, uid))
}

/** First usable socket, preferring rootless when both are available. */
export function pickDefaultSocket(uid = process.getuid?.() ?? 0): SocketCandidate | null {
  const sockets = detectSockets(uid)
  return (
    sockets.find((socket) => socket.exists && socket.readable) ??
    sockets.find((s) => s.exists) ??
    null
  )
}
