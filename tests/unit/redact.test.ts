import { describe, expect, it } from 'vitest'
import {
  REDACTED_PLACEHOLDER,
  isSensitiveKey,
  redactDeep,
  redactEnvEntry,
  redactText
} from '@shared/utils/redact'

describe('isSensitiveKey', () => {
  it('matches the usual secret-bearing names', () => {
    for (const key of [
      'PASSWORD',
      'db_password',
      'API_KEY',
      'GITHUB_TOKEN',
      'SESSION_SECRET',
      'DATABASE_DSN'
    ]) {
      expect(isSensitiveKey(key), key).toBe(true)
    }
  })

  it('leaves ordinary configuration alone', () => {
    for (const key of ['PORT', 'NODE_ENV', 'LOG_LEVEL', 'HOSTNAME']) {
      expect(isSensitiveKey(key), key).toBe(false)
    }
  })
})

describe('redactText', () => {
  it('removes GitHub tokens', () => {
    const line = 'cloning with ghp_abcdefghijklmnopqrstuvwxyz0123 now'
    expect(redactText(line)).toBe('cloning with «redacted-github-token» now')
  })

  it('removes JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(redactText(`authorization: Bearer ${jwt}`)).toContain('«redacted-jwt»')
  })

  it('keeps connection strings usable but hides the password', () => {
    expect(redactText('postgres://app:sup3rs3cret@db:5432/app')).toBe(
      'postgres://app:«redacted»@db:5432/app'
    )
  })

  it('hides private keys entirely', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----'
    expect(redactText(key)).toBe('«redacted-private-key»')
  })

  it('leaves ordinary log lines untouched', () => {
    const line = 'GET /v1/orders 200 OK (23ms)'
    expect(redactText(line)).toBe(line)
  })
})

describe('redactEnvEntry', () => {
  it('masks values behind sensitive keys', () => {
    expect(redactEnvEntry('POSTGRES_PASSWORD=hunter2')).toEqual({
      key: 'POSTGRES_PASSWORD',
      value: REDACTED_PLACEHOLDER,
      redacted: true
    })
  })

  it('keeps harmless values readable', () => {
    expect(redactEnvEntry('LOG_LEVEL=debug')).toEqual({
      key: 'LOG_LEVEL',
      value: 'debug',
      redacted: false
    })
  })

  it('can be disabled but still scrubs token-looking values', () => {
    const result = redactEnvEntry('API_KEY=ghp_abcdefghijklmnopqrstuvwxyz0123', false)
    expect(result.redacted).toBe(false)
    expect(result.value).toBe('«redacted-github-token»')
  })

  it('handles entries without a value', () => {
    expect(redactEnvEntry('EMPTY')).toEqual({ key: 'EMPTY', value: '', redacted: false })
  })
})

describe('redactDeep', () => {
  it('walks nested objects and arrays', () => {
    const input = {
      name: 'api',
      env: [{ token: 'abc' }, { port: 8080 }],
      nested: { credential: 'x', url: 'https://user:pw@example.com/' }
    }
    expect(redactDeep(input)).toEqual({
      name: 'api',
      env: [{ token: REDACTED_PLACEHOLDER }, { port: 8080 }],
      nested: { credential: REDACTED_PLACEHOLDER, url: 'https://user:«redacted»@example.com/' }
    })
  })

  it('stops at a sane depth', () => {
    let deep: unknown = 'leaf'
    for (let index = 0; index < 20; index += 1) deep = { deep }
    expect(JSON.stringify(redactDeep(deep))).toContain('«max-depth»')
  })
})
