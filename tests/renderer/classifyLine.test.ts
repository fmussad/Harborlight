import { describe, expect, it } from 'vitest'
import { classifyLine } from '@/lib/useLogStream'

describe('classifyLine', () => {
  it('recognises the common level words', () => {
    expect(classifyLine('ERROR db connection refused').level).toBe('error')
    expect(classifyLine('FATAL cannot start').level).toBe('error')
    expect(classifyLine('WARN auth slow request').level).toBe('warn')
    expect(classifyLine('DEBUG http request served').level).toBe('debug')
    expect(classifyLine('TRACE cache lookup').level).toBe('trace')
    expect(classifyLine('INFO server listening').level).toBe('info')
  })

  it('accepts the abbreviated forms used by Go loggers', () => {
    expect(classifyLine('ERRO something broke').level).toBe('error')
    expect(classifyLine('DEBU verbose detail').level).toBe('debug')
  })

  it('defaults to info when no level is present', () => {
    expect(classifyLine('GET /health 200').level).toBe('info')
  })

  it('is case-insensitive', () => {
    expect(classifyLine('error: boom').level).toBe('error')
  })

  it('extracts the component that follows the level', () => {
    expect(classifyLine('INFO server Starting API on :8080').source).toBe('server')
    expect(classifyLine('WARN rate-limiter High request rate').source).toBe('rate-limiter')
  })

  it('leaves the source null when the shape does not match', () => {
    expect(classifyLine('INFO Starting').source).toBeNull()
    expect(classifyLine('plain message').source).toBeNull()
  })

  it('does not treat a substring as a level', () => {
    expect(classifyLine('terrorist-detector ready').level).toBe('info')
  })
})
