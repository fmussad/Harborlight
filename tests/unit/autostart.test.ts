import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  autostartPath,
  buildAutostartDesktopEntry,
  isAutostartEnabled,
  setAutostart
} from '@main/services/autostart'

const REPO_ROOT = join(__dirname, '..', '..')

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harborlight-home-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('buildAutostartDesktopEntry', () => {
  it('produces a valid freedesktop entry', () => {
    const entry = buildAutostartDesktopEntry({
      execPath: '/usr/local/bin/harborlight',
      startMinimized: false
    })

    expect(entry.startsWith('[Desktop Entry]\n')).toBe(true)
    expect(entry).toContain('Type=Application')
    expect(entry).toContain('Name=Harborlight')
    expect(entry).toContain('Exec=/usr/local/bin/harborlight')
    expect(entry).toContain('Icon=harborlight')
    expect(entry).toContain('X-GNOME-Autostart-enabled=true')
    expect(entry.endsWith('\n')).toBe(true)
  })

  it('adds --hidden only when starting minimized', () => {
    const visible = buildAutostartDesktopEntry({
      execPath: '/usr/local/bin/harborlight',
      startMinimized: false
    })
    const hidden = buildAutostartDesktopEntry({
      execPath: '/usr/local/bin/harborlight',
      startMinimized: true
    })

    expect(visible).toContain('Exec=/usr/local/bin/harborlight\n')
    expect(hidden).toContain('Exec=/usr/local/bin/harborlight --hidden\n')
  })

  it('quotes an executable path that contains spaces', () => {
    const entry = buildAutostartDesktopEntry({
      execPath: '/home/user/Apps/Harborlight 0.1.0.AppImage',
      startMinimized: false
    })
    expect(entry).toContain('Exec="/home/user/Apps/Harborlight 0.1.0.AppImage"')
  })

  it('keeps extra arguments ahead of --hidden', () => {
    const entry = buildAutostartDesktopEntry({
      execPath: '/usr/local/bin/harborlight',
      startMinimized: true,
      extraArgs: ['--force-unsupported']
    })
    expect(entry).toContain('Exec=/usr/local/bin/harborlight --force-unsupported --hidden')
  })
})

describe('setAutostart', () => {
  it('creates the entry with user-only write permissions', () => {
    setAutostart(true, { execPath: '/usr/local/bin/harborlight', startMinimized: false }, home)

    const target = autostartPath(home)
    expect(existsSync(target)).toBe(true)
    expect(isAutostartEnabled(home)).toBe(true)
    expect(target).toBe(join(home, '.config', 'autostart', 'harborlight.desktop'))
    expect(statSync(target).mode & 0o777).toBe(0o644)
  })

  it('rewrites the entry when the minimized preference changes', () => {
    const options = { execPath: '/usr/local/bin/harborlight', startMinimized: false }
    setAutostart(true, options, home)
    expect(readFileSync(autostartPath(home), 'utf8')).not.toContain('--hidden')

    setAutostart(true, { ...options, startMinimized: true }, home)
    expect(readFileSync(autostartPath(home), 'utf8')).toContain('--hidden')
  })

  it('removes the entry when disabled, and is safe to repeat', () => {
    setAutostart(true, { execPath: '/usr/local/bin/harborlight', startMinimized: false }, home)
    setAutostart(false, { execPath: '/usr/local/bin/harborlight', startMinimized: false }, home)
    setAutostart(false, { execPath: '/usr/local/bin/harborlight', startMinimized: false }, home)

    expect(existsSync(autostartPath(home))).toBe(false)
    expect(isAutostartEnabled(home)).toBe(false)
  })
})

describe('install.sh autostart template', () => {
  /**
   * The installer and the in-app toggle write the same file, so a user who
   * installs with --autostart and then toggles the setting does not end up with
   * two subtly different entries.
   */
  it('matches the entry the application writes', () => {
    const script = readFileSync(join(REPO_ROOT, 'install.sh'), 'utf8')
    const heredoc =
      /as_target_user tee "\$\{autostart_file\}" >\/dev\/null <<EOF\n([\s\S]*?)\nEOF/.exec(script)
    expect(heredoc, 'the autostart heredoc should exist in install.sh').not.toBeNull()

    const rendered = `${heredoc![1]!}\n`
      .replaceAll('${APP_NAME}', 'Harborlight')
      .replaceAll('${APP_ID}', 'harborlight')
      .replaceAll('${exec_line}', '/usr/local/bin/harborlight --hidden')

    expect(rendered).toBe(
      buildAutostartDesktopEntry({ execPath: '/usr/local/bin/harborlight', startMinimized: true })
    )
  })
})
