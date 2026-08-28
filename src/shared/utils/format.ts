/** Presentation helpers shared by the renderer and the tray/menu labels. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export function formatBytes(bytes: number | null | undefined, fractionDigits = 1): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes === 0) return '0 B'
  const negative = bytes < 0
  let value = Math.abs(bytes)
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : fractionDigits
  return `${negative ? '-' : ''}${value.toFixed(digits)} ${BYTE_UNITS[unit]}`
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toFixed(fractionDigits)}%`
}

/** Compact "2d 4h" style uptime used in the container tables. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return '—'
  const deltaSeconds = Math.round((now - time) / 1000)
  if (deltaSeconds < 45) return 'just now'
  return `${formatDuration(deltaSeconds)} ago`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function shortenId(id: string, length = 12): string {
  const value = id.startsWith('sha256:') ? id.slice(7) : id
  return value.slice(0, length)
}

/** `8080:80/tcp` style label used in tables and the details drawer. */
export function formatPort(port: {
  privatePort: number
  publicPort?: number | undefined
  type: string
}): string {
  const base = port.publicPort ? `${port.publicPort}:${port.privatePort}` : `${port.privatePort}`
  return port.type && port.type !== 'tcp' ? `${base}/${port.type}` : base
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
