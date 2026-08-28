import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { logger } from './logger'

const FILE_NAME = 'license-acceptance.json'

interface AcceptanceRecord {
  accepted: boolean
  version: string
  acceptedAt: string
}

function file(userDataPath: string): string {
  return join(userDataPath, FILE_NAME)
}

/**
 * Whether the licence gate has already been cleared on this machine.
 *
 * Kept out of settings.json on purpose: "Reset to defaults" must not put the
 * agreement back in front of someone who already accepted it, and an
 * unreadable or hand-edited file should re-prompt rather than fail open on a
 * value nobody can vouch for.
 */
export function hasAcceptedLicense(userDataPath: string): boolean {
  const target = file(userDataPath)
  if (!existsSync(target)) return false
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<AcceptanceRecord>
    return parsed.accepted === true
  } catch (error) {
    logger.warn('license', 'Could not read the licence acceptance record; asking again', error)
    return false
  }
}

export function recordLicenseAcceptance(userDataPath: string, version: string): void {
  const target = file(userDataPath)
  const record: AcceptanceRecord = {
    accepted: true,
    version,
    acceptedAt: new Date().toISOString()
  }
  try {
    mkdirSync(dirname(target), { recursive: true })
    const temporary = `${target}.tmp`
    writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600 })
    renameSync(temporary, target)
    logger.info('license', `Licence accepted for ${version}`)
  } catch (error) {
    // Not fatal: the user accepted, so let them in. They will be asked again
    // next time rather than being locked out by a read-only home directory.
    logger.error('license', 'Could not persist the licence acceptance', error)
  }
}
