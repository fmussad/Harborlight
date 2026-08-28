#!/usr/bin/env node
/**
 * Writes the release manifest for one version.
 *
 * The same document is used three ways: as `release.json` inside the version
 * directory, as the channel's `latest.json`, and by `install.sh --source
 * release` to find and verify artifacts. Keeping one shape avoids the two
 * drifting apart.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const {
  VERSION,
  CHANNEL,
  GIT_SHA,
  RELEASED_AT,
  BASE_URL = '',
  RELEASE_URL = '',
  RELEASE_DIR
} = process.env

for (const [key, value] of Object.entries({
  VERSION,
  CHANNEL,
  GIT_SHA,
  RELEASED_AT,
  RELEASE_DIR
})) {
  if (!value) {
    console.error(`write-manifest: ${key} is required`)
    process.exit(1)
  }
}

/** `harborlight_0.1.0_amd64.deb` and `Harborlight-0.1.0-arm64.AppImage`. */
function architectureOf(name) {
  if (/(_|-)(amd64|x86_64|x64)\./.test(name)) return 'amd64'
  if (/(_|-)(arm64|aarch64)\./.test(name)) return 'arm64'
  return 'any'
}

function kindOf(name) {
  if (name.endsWith('.deb')) return 'deb'
  if (name.endsWith('.AppImage')) return 'appimage'
  if (name === 'install.sh') return 'installer'
  return 'other'
}

const checksums = new Map()
for (const line of readFileSync(join(RELEASE_DIR, 'checksums.sha256'), 'utf8').split('\n')) {
  const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim())
  if (match) checksums.set(match[2], match[1])
}

const artifacts = readdirSync(RELEASE_DIR)
  .filter((name) => name !== 'checksums.sha256' && name !== 'release.json')
  .sort()
  .map((name) => ({
    name,
    kind: kindOf(name),
    architecture: architectureOf(name),
    sha256: checksums.get(name) ?? null,
    url: BASE_URL ? `${BASE_URL.replace(/\/+$/, '')}/${name}` : null
  }))

const manifest = {
  schema: 1,
  product: 'Harborlight',
  channel: CHANNEL,
  version: VERSION,
  commit: GIT_SHA,
  releasedAt: RELEASED_AT,
  releaseUrl: RELEASE_URL || null,
  minimumUbuntu: '22.04',
  architectures: [...new Set(artifacts.map((a) => a.architecture).filter((a) => a !== 'any'))],
  artifacts
}

const target = join(RELEASE_DIR, 'release.json')
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`  ok ${target} (${artifacts.length} artifacts)`)
