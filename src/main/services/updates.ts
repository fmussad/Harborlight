import type { UpdateInfo } from '@shared/schemas/domain'
import { APP_VERSION } from '../build-info'
import { logger } from './logger'

/**
 * Update checks read the same `latest.json` channel manifest that
 * `make publish` produces and `install.sh --source release` consumes.
 *
 * Harborlight never downloads or installs an update by itself: it reports what
 * is available and points at the documented upgrade command.
 */
const DEFAULT_BASE_URL = process.env.HARBORLIGHT_UPDATE_BASE_URL ?? ''

export interface ChannelManifest {
  channel: string
  version: string
  releasedAt?: string
  releaseUrl?: string
  artifacts?: { name: string; sha256: string; url?: string }[]
}

/** Semver-ish comparison, tolerant of prerelease suffixes. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): { parts: number[]; pre: string } => {
    const [core = '0.0.0', pre = ''] = value.replace(/^v/, '').split('-', 2)
    return { parts: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  if (a.pre === b.pre) return 0
  if (a.pre === '') return 1
  if (b.pre === '') return -1
  return a.pre > b.pre ? 1 : -1
}

export async function checkForUpdates(channel: 'stable' | 'beta'): Promise<UpdateInfo> {
  const checkedAt = new Date().toISOString()
  const base = DEFAULT_BASE_URL.replace(/\/+$/, '')

  if (!base) {
    return {
      checkedAt,
      channel,
      currentVersion: APP_VERSION,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      message:
        'No update endpoint is configured. Set HARBORLIGHT_UPDATE_BASE_URL to the base URL of your published release directory (see docs/PUBLISHING.md).'
    }
  }

  const url = `${base}/${channel}/latest.json`
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    clearTimeout(timeout)

    if (!response.ok) {
      return {
        checkedAt,
        channel,
        currentVersion: APP_VERSION,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        message: `The ${channel} channel manifest responded with HTTP ${response.status}.`
      }
    }

    const manifest = (await response.json()) as ChannelManifest
    const latest = String(manifest.version ?? '')
    const available = latest !== '' && compareVersions(latest, APP_VERSION) > 0

    return {
      checkedAt,
      channel,
      currentVersion: APP_VERSION,
      latestVersion: latest || null,
      updateAvailable: available,
      releaseUrl: manifest.releaseUrl ?? null,
      message: available
        ? `Harborlight ${latest} is available. Upgrade with: ./install.sh upgrade --source release --channel ${channel}`
        : `Harborlight ${APP_VERSION} is the latest ${channel} release.`
    }
  } catch (error) {
    logger.warn('updates', `Update check failed for ${url}`, error)
    return {
      checkedAt,
      channel,
      currentVersion: APP_VERSION,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      message: `Could not reach the update endpoint (${url}). Check your network or update manually.`
    }
  }
}
