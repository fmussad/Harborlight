import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasAcceptedLicense, recordLicenseAcceptance } from '@main/services/license'
import { MIT_LICENSE_TEXT } from '@shared/license'

let directory: string
const record = (): string => join(directory, 'license-acceptance.json')

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'harborlight-license-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('the licence text shown on first run', () => {
  it('is the repository LICENSE, byte for byte', () => {
    const onDisk = readFileSync(resolve(__dirname, '..', '..', 'LICENSE'), 'utf8')
    expect(MIT_LICENSE_TEXT).toBe(onDisk)
  })
})

describe('acceptance', () => {
  it('treats a profile that has never run as not accepted', () => {
    expect(hasAcceptedLicense(directory)).toBe(false)
  })

  it('remembers the answer across restarts', () => {
    recordLicenseAcceptance(directory, '1.2.3')
    expect(hasAcceptedLicense(directory)).toBe(true)
  })

  it('records the version and time it was accepted', () => {
    recordLicenseAcceptance(directory, '1.2.3')

    const stored = JSON.parse(readFileSync(record(), 'utf8')) as Record<string, unknown>
    expect(stored.accepted).toBe(true)
    expect(stored.version).toBe('1.2.3')
    expect(Date.parse(String(stored.acceptedAt))).not.toBeNaN()
  })

  it('writes the file with user-only permissions', () => {
    recordLicenseAcceptance(directory, '1.2.3')
    expect(statSync(record()).mode & 0o777).toBe(0o600)
  })

  it('asks again when the record is unreadable rather than letting the user in', () => {
    writeFileSync(record(), '{ not json')
    expect(hasAcceptedLicense(directory)).toBe(false)
  })

  it('asks again when the record says the licence was not accepted', () => {
    writeFileSync(record(), JSON.stringify({ accepted: false }))
    expect(hasAcceptedLicense(directory)).toBe(false)
  })

  it('lets the user in even if the record cannot be written', () => {
    // A profile path that cannot hold a file at all: the parent is a file.
    writeFileSync(join(directory, 'blocked'), '')
    const unwritable = join(directory, 'blocked', 'profile')

    // Being unable to save the answer must not lock anyone out; they are
    // simply asked again next time.
    expect(() => recordLicenseAcceptance(unwritable, '1.2.3')).not.toThrow()
    expect(hasAcceptedLicense(unwritable)).toBe(false)
  })
})
