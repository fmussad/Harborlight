import type { ScanResult } from '@shared/schemas/domain'
import { capture } from '../compose/runner'
import { logger } from './logger'

/* eslint-disable @typescript-eslint/no-explicit-any -- Trivy's JSON report is external, untyped input. */

/**
 * Optional vulnerability scanning.
 *
 * Trivy is never installed by Harborlight and never required: when it is
 * missing the UI explains how to add it instead of hiding the feature.
 */
export async function trivyAvailability(): Promise<{
  available: boolean
  version: string | null
  reason: string | null
}> {
  try {
    const result = await capture({
      program: 'trivy',
      args: ['--version'],
      cwd: process.cwd(),
      timeoutMs: 5000
    })
    if (result.code !== 0) {
      return { available: false, version: null, reason: 'trivy exited with an error.' }
    }
    const version = result.stdout.split('\n')[0]?.trim() ?? null
    return { available: true, version, reason: null }
  } catch {
    return {
      available: false,
      version: null,
      reason:
        'Trivy is not installed. Install it with "sudo apt install trivy" (or see aquasecurity.github.io/trivy) to scan images from Harborlight.'
    }
  }
}

export async function scanImage(reference: string): Promise<ScanResult> {
  const availability = await trivyAvailability()
  const empty: ScanResult = {
    available: availability.available,
    reason: availability.reason,
    scannedAt: null,
    reference,
    counts: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    findings: []
  }
  if (!availability.available) return empty

  const result = await capture({
    program: 'trivy',
    args: [
      'image',
      '--quiet',
      '--scanners',
      'vuln',
      '--format',
      'json',
      '--timeout',
      '5m',
      '--image-src',
      'docker',
      reference
    ],
    cwd: process.cwd(),
    timeoutMs: 5 * 60_000,
    maxBuffer: 32 * 1024 * 1024
  })

  if (result.code !== 0) {
    logger.warn('trivy', `Scan failed for ${reference}`, result.stderr.slice(0, 400))
    return { ...empty, reason: `Trivy failed: ${result.stderr.split('\n')[0] ?? 'unknown error'}` }
  }

  try {
    const report = JSON.parse(result.stdout) as any
    const findings: ScanResult['findings'] = []
    for (const target of report?.Results ?? []) {
      for (const vulnerability of target?.Vulnerabilities ?? []) {
        findings.push({
          severity: normalizeSeverity(vulnerability?.Severity),
          id: String(vulnerability?.VulnerabilityID ?? ''),
          package: String(vulnerability?.PkgName ?? ''),
          installedVersion: String(vulnerability?.InstalledVersion ?? ''),
          fixedVersion: vulnerability?.FixedVersion ? String(vulnerability.FixedVersion) : null,
          title: String(vulnerability?.Title ?? vulnerability?.Description ?? '').slice(0, 240)
        })
      }
    }

    const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 }
    for (const finding of findings) {
      if (finding.severity === 'CRITICAL') counts.critical += 1
      else if (finding.severity === 'HIGH') counts.high += 1
      else if (finding.severity === 'MEDIUM') counts.medium += 1
      else if (finding.severity === 'LOW') counts.low += 1
      else counts.unknown += 1
    }

    return {
      available: true,
      reason: null,
      scannedAt: new Date().toISOString(),
      reference,
      counts,
      findings: findings.slice(0, 500)
    }
  } catch (error) {
    logger.error('trivy', 'Could not parse the Trivy report', error)
    return {
      ...empty,
      available: true,
      reason: 'Trivy produced a report Harborlight could not parse.'
    }
  }
}

function normalizeSeverity(value: unknown): ScanResult['findings'][number]['severity'] {
  const severity = String(value ?? '').toUpperCase()
  if (
    severity === 'CRITICAL' ||
    severity === 'HIGH' ||
    severity === 'MEDIUM' ||
    severity === 'LOW'
  ) {
    return severity
  }
  return 'UNKNOWN'
}
