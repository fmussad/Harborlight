import { realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { HarborlightError } from '../errors'

const COMPOSE_FILE_PATTERN = /^(docker-)?compose\.ya?ml$/i
const ALTERNATE_PATTERN = /^[\w.-]+\.compose\.ya?ml$/i

/** Directories Harborlight refuses to treat as a Compose project root. */
const FORBIDDEN_ROOTS = ['/proc', '/sys', '/dev', '/boot', '/etc/shadow']

export function isComposeFileName(name: string): boolean {
  return COMPOSE_FILE_PATTERN.test(name) || ALTERNATE_PATTERN.test(name)
}

/**
 * Rejects anything that is not a plain, absolute, non-traversing path.
 * Symlinks are resolved first so a link cannot smuggle the target outside the
 * project directory.
 */
export function assertSafePath(input: string, label = 'path'): string {
  if (!input || !isAbsolute(input)) {
    throw new HarborlightError('validation', `The ${label} must be an absolute path.`)
  }
  if (input.split(sep).includes('..')) {
    throw new HarborlightError('validation', `The ${label} must not contain "..".`)
  }
  if (/[\0\n\r]/.test(input)) {
    throw new HarborlightError('validation', `The ${label} contains control characters.`)
  }
  const normalized = resolve(input)
  if (
    FORBIDDEN_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}${sep}`))
  ) {
    throw new HarborlightError('not-allowed', `Harborlight will not read from ${normalized}.`)
  }
  return normalized
}

export function resolveComposeFile(input: string): string {
  const normalized = assertSafePath(input, 'Compose file')
  const name = normalized.split(sep).pop() ?? ''
  if (!isComposeFileName(name)) {
    throw new HarborlightError('validation', `"${name}" is not a recognised Compose file name.`, {
      hint: 'Use compose.yml, compose.yaml, docker-compose.yml or docker-compose.yaml.'
    })
  }

  let real: string
  try {
    real = realpathSync(normalized)
  } catch {
    throw new HarborlightError('not-found', `The Compose file ${normalized} does not exist.`)
  }
  if (!statSync(real).isFile()) {
    throw new HarborlightError('validation', `${real} is not a regular file.`)
  }
  return real
}

export function resolveWorkingDir(input: string): string {
  const normalized = assertSafePath(input, 'working directory')
  let real: string
  try {
    real = realpathSync(normalized)
  } catch {
    throw new HarborlightError('not-found', `The directory ${normalized} does not exist.`)
  }
  if (!statSync(real).isDirectory()) {
    throw new HarborlightError('validation', `${real} is not a directory.`)
  }
  return real
}

/** Compose files must live inside the project working directory. */
export function assertFileInsideWorkingDir(file: string, workingDir: string): void {
  const normalizedDir = workingDir.endsWith(sep) ? workingDir : `${workingDir}${sep}`
  if (!file.startsWith(normalizedDir)) {
    throw new HarborlightError(
      'not-allowed',
      'The Compose file must be inside the project working directory.',
      { hint: `File: ${file}\nWorking directory: ${workingDir}` }
    )
  }
}

export function defaultWorkingDirFor(file: string): string {
  return dirname(file)
}
