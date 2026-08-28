import { readFileSync } from 'node:fs'
import { arch, release, userInfo } from 'node:os'
import { execFileSync } from 'node:child_process'
import type { PlatformInfo } from '@shared/schemas/domain'

export const SUPPORTED_UBUNTU_VERSIONS = ['22.04', '24.04', '26.04'] as const
export const SUPPORTED_ARCHITECTURES = ['x64', 'arm64'] as const

/** Parses the shell-style key=value format of `/etc/os-release`. */
export function parseOsRelease(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

export interface SupportEvaluation {
  supported: boolean
  reason: string | null
}

/**
 * Harborlight targets Ubuntu LTS releases. Anything else still runs with
 * `--force-unsupported`, but the user gets an explicit warning first.
 */
export function evaluateSupport(
  osRelease: Record<string, string>,
  architecture: string
): SupportEvaluation {
  const id = (osRelease.ID ?? '').toLowerCase()
  const idLike = (osRelease.ID_LIKE ?? '').toLowerCase()
  const versionId = osRelease.VERSION_ID ?? ''

  if (!(SUPPORTED_ARCHITECTURES as readonly string[]).includes(architecture)) {
    return {
      supported: false,
      reason: `Unsupported architecture "${architecture}". Harborlight supports ${SUPPORTED_ARCHITECTURES.join(' and ')}.`
    }
  }

  if (id !== 'ubuntu') {
    const hint = idLike.includes('debian')
      ? ' Debian derivatives are untested but usually work.'
      : ''
    return {
      supported: false,
      reason: `Unsupported distribution "${osRelease.NAME ?? (id || 'unknown')}". Harborlight targets Ubuntu ${SUPPORTED_UBUNTU_VERSIONS.join(', ')}.${hint}`
    }
  }

  if (!(SUPPORTED_UBUNTU_VERSIONS as readonly string[]).includes(versionId)) {
    return {
      supported: false,
      reason: `Unsupported Ubuntu release "${versionId || 'unknown'}". Harborlight supports ${SUPPORTED_UBUNTU_VERSIONS.join(', ')}.`
    }
  }

  return { supported: true, reason: null }
}

export function readOsRelease(path = '/etc/os-release'): Record<string, string> {
  try {
    return parseOsRelease(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function currentUserGroups(): string[] {
  try {
    const output = execFileSync('id', ['-nG'], { encoding: 'utf8', timeout: 2000 })
    return output.trim().split(/\s+/)
  } catch {
    return []
  }
}

export function collectPlatformInfo(): PlatformInfo {
  const osRelease = readOsRelease()
  const architecture = arch()
  const support = evaluateSupport(osRelease, architecture)
  const desktop = process.env.XDG_CURRENT_DESKTOP ?? ''
  const sessionType = process.env.XDG_SESSION_TYPE ?? 'unknown'
  const groups = currentUserGroups()

  return {
    distroId: osRelease.ID ?? 'unknown',
    distroName: osRelease.PRETTY_NAME ?? osRelease.NAME ?? 'unknown',
    versionId: osRelease.VERSION_ID ?? 'unknown',
    supported: support.supported,
    sessionType,
    desktop: desktop || 'unknown',
    architecture,
    kernel: release(),
    isRoot: typeof process.getuid === 'function' ? process.getuid() === 0 : false,
    inDockerGroup: groups.includes('docker'),
    // GNOME ships no StatusNotifier host by default; the AppIndicator extension provides it.
    trayLikelySupported: !desktop.toUpperCase().includes('GNOME') || hasAppIndicatorSupport()
  }
}

function hasAppIndicatorSupport(): boolean {
  const candidates = [
    '/usr/lib/x86_64-linux-gnu/libayatana-appindicator3.so.1',
    '/usr/lib/aarch64-linux-gnu/libayatana-appindicator3.so.1',
    '/usr/lib/x86_64-linux-gnu/libappindicator3.so.1',
    '/usr/lib/aarch64-linux-gnu/libappindicator3.so.1'
  ]
  return candidates.some((candidate) => {
    try {
      readFileSync(candidate, { flag: 'r' })
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ENOENT'
    }
  })
}

export function currentUserName(): string {
  try {
    return userInfo().username
  } catch {
    return process.env.USER ?? 'unknown'
  }
}
