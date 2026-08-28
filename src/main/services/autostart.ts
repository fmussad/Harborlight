import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from './logger'

export const AUTOSTART_FILE_NAME = 'harborlight.desktop'

export interface AutostartOptions {
  execPath: string
  startMinimized: boolean
  /** Extra arguments needed when running from a development checkout. */
  extraArgs?: string[]
}

/**
 * Builds the freedesktop autostart entry.
 *
 * Pure so the installer and the app produce byte-identical files, and so the
 * behaviour can be asserted in unit tests.
 */
export function buildAutostartDesktopEntry(options: AutostartOptions): string {
  const args = [...(options.extraArgs ?? [])]
  if (options.startMinimized) args.push('--hidden')
  const exec = [quoteExec(options.execPath), ...args].join(' ')

  return `[Desktop Entry]
Type=Application
Name=Harborlight
GenericName=Container Manager
Comment=Container workflows, reimagined for Ubuntu
Exec=${exec}
Icon=harborlight
Terminal=false
Categories=Development;System;
StartupWMClass=harborlight
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5
`
}

function quoteExec(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

export function autostartPath(home = homedir()): string {
  return join(home, '.config', 'autostart', AUTOSTART_FILE_NAME)
}

export function isAutostartEnabled(home = homedir()): boolean {
  return existsSync(autostartPath(home))
}

export function setAutostart(enabled: boolean, options: AutostartOptions, home = homedir()): void {
  const target = autostartPath(home)
  try {
    if (!enabled) {
      if (existsSync(target)) rmSync(target)
      logger.info('autostart', 'Removed the autostart entry')
      return
    }
    mkdirSync(join(home, '.config', 'autostart'), { recursive: true })
    writeFileSync(target, buildAutostartDesktopEntry(options), { mode: 0o644 })
    logger.info('autostart', `Wrote ${target} (minimized=${options.startMinimized})`)
  } catch (error) {
    logger.error('autostart', 'Could not update the autostart entry', error)
    throw error
  }
}
