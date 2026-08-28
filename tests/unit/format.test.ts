import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatPort,
  formatRelativeTime,
  pluralize,
  shortenId
} from '@shared/utils/format'

describe('formatBytes', () => {
  it('scales through the binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 ** 3 * 42)).toBe('42.0 GB')
  })

  it('drops the fraction once the number is large within a unit', () => {
    expect(formatBytes(1024 * 512)).toBe('512 KB')
  })

  it('keeps negatives readable and rejects nonsense', () => {
    expect(formatBytes(-2048)).toBe('-2.0 KB')
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('formatPercent', () => {
  it('renders one decimal by default', () => {
    expect(formatPercent(18.04)).toBe('18.0%')
    expect(formatPercent(18.04, 0)).toBe('18%')
    expect(formatPercent(undefined)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('uses the two most significant units', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(125)).toBe('2m 5s')
    expect(formatDuration(3600 * 5 + 120)).toBe('5h 2m')
    expect(formatDuration(86_400 * 2 + 3600 * 4)).toBe('2d 4h')
  })

  it('refuses negative and missing values', () => {
    expect(formatDuration(-1)).toBe('—')
    expect(formatDuration(null)).toBe('—')
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-05-16T18:00:00.000Z')

  it('collapses very recent timestamps', () => {
    expect(formatRelativeTime('2026-05-16T17:59:40.000Z', now)).toBe('just now')
  })

  it('describes older timestamps with a duration', () => {
    expect(formatRelativeTime('2026-05-16T16:00:00.000Z', now)).toBe('2h 0m ago')
  })

  it('handles unparsable input', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('—')
    expect(formatRelativeTime(null, now)).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('returns a dash for missing or invalid values', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('nope')).toBe('—')
  })

  it('formats a real timestamp', () => {
    expect(formatDateTime('2026-05-16T18:00:00.000Z')).toContain('2026')
  })
})

describe('shortenId', () => {
  it('strips the sha256 prefix', () => {
    expect(shortenId('sha256:abcdef0123456789', 6)).toBe('abcdef')
    expect(shortenId('abcdef0123456789')).toBe('abcdef012345')
  })
})

describe('formatPort', () => {
  it('shows only the container port when nothing is published', () => {
    expect(formatPort({ privatePort: 5432, type: 'tcp' })).toBe('5432')
  })

  it('shows the mapping and keeps non-tcp protocols visible', () => {
    expect(formatPort({ privatePort: 80, publicPort: 8080, type: 'tcp' })).toBe('8080:80')
    expect(formatPort({ privatePort: 53, publicPort: 5353, type: 'udp' })).toBe('5353:53/udp')
  })
})

describe('pluralize', () => {
  it('switches on the count', () => {
    expect(pluralize(1, 'container')).toBe('1 container')
    expect(pluralize(3, 'container')).toBe('3 containers')
    expect(pluralize(2, 'entry', 'entries')).toBe('2 entries')
  })
})
