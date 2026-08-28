import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import {
  acceptLicense,
  launchArgs,
  testEnv,
  windowFor,
  LICENSE_WINDOW,
  MAIN_WINDOW,
  SPLASH_WINDOW
} from './fixtures'

const ROOT = resolve(__dirname, '..', '..')

/**
 * These tests own their profile rather than using the shared fixture, because
 * what they assert is precisely what happens on a profile nobody has used yet.
 */
function pristineProfile(): string {
  return mkdtempSync(join(tmpdir(), 'harborlight-startup-'))
}

async function launch(profile: string): Promise<ElectronApplication> {
  return electron.launch({ args: launchArgs(profile), cwd: ROOT, env: testEnv() })
}

test.describe('First run', () => {
  test('asks for the licence before opening the application', async () => {
    const profile = pristineProfile()
    const app = await launch(profile)

    try {
      const gate = await windowFor(app, LICENSE_WINDOW)
      await expect(gate.getByRole('heading', { name: 'Before you start' })).toBeVisible()
      await expect(gate.getByText('MIT License')).toBeVisible()
      await expect(gate.getByText('WITHOUT WARRANTY OF ANY KIND')).toBeVisible()

      // Nothing else exists yet: no splash and no application window.
      expect(app.windows()).toHaveLength(1)

      await gate.getByRole('button', { name: 'Accept and continue' }).click()

      const ui = await windowFor(app, MAIN_WINDOW)
      await expect(ui.getByRole('navigation', { name: 'Main' })).toBeVisible()

      const record = JSON.parse(
        readFileSync(join(profile, 'license-acceptance.json'), 'utf8')
      ) as Record<string, unknown>
      expect(record.accepted).toBe(true)
    } finally {
      await app.close().catch(() => undefined)
      rmSync(profile, { recursive: true, force: true })
    }
  })

  test('quits without starting the app when the licence is declined', async () => {
    const profile = pristineProfile()
    const app = await launch(profile)

    try {
      const gate = await windowFor(app, LICENSE_WINDOW)
      await gate.getByRole('button', { name: 'Decline and quit' }).click()

      await expect.poll(() => app.windows().length, { timeout: 15_000 }).toBe(0)
      expect(existsSync(join(profile, 'license-acceptance.json'))).toBe(false)
    } finally {
      await app.close().catch(() => undefined)
      rmSync(profile, { recursive: true, force: true })
    }
  })
})

test.describe('Splash', () => {
  test('shows on a launch that has already accepted the licence', async () => {
    const profile = pristineProfile()
    acceptLicense(profile)
    const app = await launch(profile)

    try {
      const splash = await windowFor(app, SPLASH_WINDOW)
      await expect(splash.getByRole('progressbar', { name: 'Loading Harborlight' })).toBeVisible()

      // No licence window this time.
      expect(app.windows().some((page) => page.url().includes(LICENSE_WINDOW))).toBe(false)

      const ui = await windowFor(app, MAIN_WINDOW)
      await expect(ui.getByRole('navigation', { name: 'Main' })).toBeVisible()

      // The splash hands over and closes, leaving only the application window.
      await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBe(1)
      expect(app.windows()[0]?.url()).toContain(MAIN_WINDOW)
    } finally {
      await app.close().catch(() => undefined)
      rmSync(profile, { recursive: true, force: true })
    }
  })

  test('reports startup progress and reaches the end of the bar', async () => {
    const profile = pristineProfile()
    acceptLicense(profile)
    const app = await launch(profile)

    try {
      const splash = await windowFor(app, SPLASH_WINDOW)

      await expect(
        splash.getByRole('progressbar', { name: 'Loading Harborlight' })
      ).toHaveAttribute('aria-valuenow', '100')
      await expect(splash.getByRole('status')).toHaveText('Ready')
    } finally {
      await app.close().catch(() => undefined)
      rmSync(profile, { recursive: true, force: true })
    }
  })
})

test.describe('Second launch', () => {
  test('reuses the running window instead of showing another splash', async () => {
    const profile = pristineProfile()
    acceptLicense(profile)
    const app = await launch(profile)

    try {
      const ui = await windowFor(app, MAIN_WINDOW)
      await expect(ui.getByRole('navigation', { name: 'Main' })).toBeVisible()
      await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBe(1)

      const electronBinary = createRequire(__filename)('electron') as unknown as string
      const exitCode = await new Promise<number | null>((done) => {
        const second = execFile(electronBinary, launchArgs(profile), {
          cwd: ROOT,
          env: testEnv()
        })
        second.on('exit', done)
      })

      // The single-instance lock sends the second process straight back out.
      expect(exitCode).toBe(0)

      // Give a stray splash time to appear before ruling it out.
      await new Promise((done) => setTimeout(done, 2000))
      expect(app.windows()).toHaveLength(1)
      expect(app.windows()[0]?.url()).toContain(MAIN_WINDOW)
    } finally {
      await app.close().catch(() => undefined)
      rmSync(profile, { recursive: true, force: true })
    }
  })
})
