import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertFileInsideWorkingDir,
  assertSafePath,
  defaultWorkingDirFor,
  isComposeFileName,
  resolveComposeFile,
  resolveWorkingDir
} from '@main/compose/paths'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'harborlight-paths-'))
  writeFileSync(join(root, 'compose.yml'), 'services: {}\n')
  writeFileSync(join(root, 'notes.txt'), 'not a compose file\n')
  symlinkSync(join(root, 'compose.yml'), join(root, 'docker-compose.yml'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('isComposeFileName', () => {
  it('accepts the canonical names', () => {
    for (const name of [
      'compose.yml',
      'compose.yaml',
      'docker-compose.yml',
      'docker-compose.yaml'
    ]) {
      expect(isComposeFileName(name), name).toBe(true)
    }
  })

  it('accepts prefixed variants used for overrides', () => {
    expect(isComposeFileName('prod.compose.yml')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const name of ['compose.txt', 'values.yml', 'compose', 'compose.yml.bak']) {
      expect(isComposeFileName(name), name).toBe(false)
    }
  })
})

describe('assertSafePath', () => {
  it('requires an absolute path', () => {
    expect(() => assertSafePath('relative/compose.yml')).toThrow(/absolute/)
  })

  it('rejects parent traversal', () => {
    expect(() => assertSafePath('/srv/app/../../etc/compose.yml')).toThrow(/\.\./)
  })

  it('rejects control characters', () => {
    expect(() => assertSafePath('/srv/app\n/compose.yml')).toThrow(/control characters/)
  })

  it('refuses sensitive system roots', () => {
    for (const path of ['/proc/self/environ', '/sys/kernel', '/dev/mem']) {
      expect(() => assertSafePath(path), path).toThrow(/will not read/)
    }
  })

  it('returns the normalized path for accepted input', () => {
    expect(assertSafePath('/srv/app/compose.yml')).toBe('/srv/app/compose.yml')
  })
})

describe('resolveComposeFile', () => {
  it('resolves an existing compose file', () => {
    expect(resolveComposeFile(join(root, 'compose.yml'))).toBe(join(root, 'compose.yml'))
  })

  it('follows symlinks to their real target', () => {
    expect(resolveComposeFile(join(root, 'docker-compose.yml'))).toBe(join(root, 'compose.yml'))
  })

  it('rejects files that are not Compose files', () => {
    expect(() => resolveComposeFile(join(root, 'notes.txt'))).toThrow(
      /recognised Compose file name/
    )
  })

  it('reports a missing file clearly', () => {
    expect(() => resolveComposeFile(join(root, 'missing', 'compose.yml'))).toThrow(/does not exist/)
  })
})

describe('resolveWorkingDir', () => {
  it('accepts a real directory', () => {
    expect(resolveWorkingDir(root)).toBe(root)
  })

  it('rejects a file', () => {
    expect(() => resolveWorkingDir(join(root, 'compose.yml'))).toThrow(/not a directory/)
  })
})

describe('assertFileInsideWorkingDir', () => {
  it('accepts files under the working directory', () => {
    expect(() => assertFileInsideWorkingDir('/srv/app/compose.yml', '/srv/app')).not.toThrow()
  })

  it('rejects files outside it, including sibling prefixes', () => {
    expect(() => assertFileInsideWorkingDir('/srv/other/compose.yml', '/srv/app')).toThrow()
    expect(() => assertFileInsideWorkingDir('/srv/app-evil/compose.yml', '/srv/app')).toThrow()
  })
})

describe('defaultWorkingDirFor', () => {
  it('uses the directory containing the file', () => {
    expect(defaultWorkingDirFor('/srv/app/compose.yml')).toBe('/srv/app')
  })
})
