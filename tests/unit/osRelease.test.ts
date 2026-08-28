import { describe, expect, it } from 'vitest'
import { evaluateSupport, parseOsRelease } from '@main/services/osRelease'

const UBUNTU_2404 = `PRETTY_NAME="Ubuntu 24.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.1 LTS (Noble Numbat)"
ID=ubuntu
ID_LIKE=debian
# a comment

HOME_URL="https://www.ubuntu.com/"
`

describe('parseOsRelease', () => {
  it('reads keys and strips quotes', () => {
    const parsed = parseOsRelease(UBUNTU_2404)
    expect(parsed.ID).toBe('ubuntu')
    expect(parsed.VERSION_ID).toBe('24.04')
    expect(parsed.PRETTY_NAME).toBe('Ubuntu 24.04.1 LTS')
  })

  it('ignores comments and blank lines', () => {
    expect(Object.keys(parseOsRelease(UBUNTU_2404))).not.toContain('# a comment')
  })

  it('returns an empty map for empty input', () => {
    expect(parseOsRelease('')).toEqual({})
  })
})

describe('evaluateSupport', () => {
  it('accepts the supported Ubuntu LTS releases on x64 and arm64', () => {
    for (const version of ['22.04', '24.04', '26.04']) {
      for (const architecture of ['x64', 'arm64']) {
        const result = evaluateSupport({ ID: 'ubuntu', VERSION_ID: version }, architecture)
        expect(result.supported, `${version} ${architecture}`).toBe(true)
        expect(result.reason).toBeNull()
      }
    }
  })

  it('rejects other Ubuntu releases with a helpful reason', () => {
    const result = evaluateSupport({ ID: 'ubuntu', VERSION_ID: '20.04' }, 'x64')
    expect(result.supported).toBe(false)
    expect(result.reason).toContain('20.04')
  })

  it('rejects other distributions but hints at Debian compatibility', () => {
    const debian = evaluateSupport({ ID: 'debian', ID_LIKE: 'debian', NAME: 'Debian' }, 'x64')
    expect(debian.supported).toBe(false)
    expect(debian.reason).toContain('Debian derivatives')

    const fedora = evaluateSupport({ ID: 'fedora', NAME: 'Fedora Linux' }, 'x64')
    expect(fedora.reason).toContain('Fedora Linux')
    expect(fedora.reason).not.toContain('Debian derivatives')
  })

  it('rejects unsupported architectures before anything else', () => {
    const result = evaluateSupport({ ID: 'ubuntu', VERSION_ID: '24.04' }, 'ia32')
    expect(result.supported).toBe(false)
    expect(result.reason).toContain('architecture')
  })

  it('handles a completely unknown system', () => {
    const result = evaluateSupport({}, 'x64')
    expect(result.supported).toBe(false)
    expect(result.reason).toContain('unknown')
  })
})
