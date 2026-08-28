/**
 * Secret redaction shared by the log writer, the diagnostics export and the
 * container environment viewer. Redaction is intentionally conservative: it is
 * better to hide a harmless value than to leak a token into a log file.
 */

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /pass(word|wd)?/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /credential/i,
  /auth/i,
  /session/i,
  /cookie/i,
  /salt/i,
  /signature/i,
  /^pgpassword$/i,
  /^mysql_.*password$/i,
  /_dsn$/i,
  /connection[_-]?string/i
]

const VALUE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, replacement: '«redacted-github-token»' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: '«redacted-slack-token»' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '«redacted-aws-key»' },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '«redacted-jwt»'
  },
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '«redacted-private-key»'
  },
  {
    pattern: /\b([a-z][a-z0-9+.-]*):\/\/([^\s/@:]+):([^\s/@]+)@/gi,
    replacement: '$1://$2:«redacted»@'
  },
  { pattern: /("(?:password|secret|token)"\s*:\s*)"[^"]*"/gi, replacement: '$1"«redacted»"' }
]

export const REDACTED_PLACEHOLDER = '••••••••'

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

/** Redacts secret-looking substrings inside free-form text (log lines, errors). */
export function redactText(input: string): string {
  let output = input
  for (const { pattern, replacement } of VALUE_PATTERNS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

/** Splits `KEY=value` env entries and hides values behind sensitive keys. */
export function redactEnvEntry(
  entry: string,
  enabled = true
): { key: string; value: string; redacted: boolean } {
  const separator = entry.indexOf('=')
  const key = separator === -1 ? entry : entry.slice(0, separator)
  const rawValue = separator === -1 ? '' : entry.slice(separator + 1)
  const shouldRedact = enabled && rawValue.length > 0 && isSensitiveKey(key)
  return {
    key,
    value: shouldRedact ? REDACTED_PLACEHOLDER : redactText(rawValue),
    redacted: shouldRedact
  }
}

/** Deep-redacts an arbitrary JSON-ish structure for diagnostics exports. */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 12) return '«max-depth»'
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED_PLACEHOLDER : redactDeep(item, depth + 1)
    }
    return result
  }
  return value
}
