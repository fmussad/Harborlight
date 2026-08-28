import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'

const ROOT = resolve(__dirname, '..', '..')

/**
 * Marks a profile as having cleared the first-run licence gate.
 *
 * Every suite except the first-run one starts from an accepted profile: the
 * agreement is a one-off dialog and re-clicking it in each test would only add
 * a way for unrelated tests to fail.
 */
export function acceptLicense(profile: string): void {
  writeFileSync(
    join(profile, 'license-acceptance.json'),
    JSON.stringify({ accepted: true, version: 'test', acceptedAt: new Date().toISOString() })
  )
}

/** The environment an Electron child needs to run against the mock engine. */
export function testEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    // Editors that are themselves Electron apps export this; it would turn
    // the child Electron binary into a plain Node process.
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue
    env[key] = value
  }
  return {
    ...env,
    HARBORLIGHT_ENGINE: 'mock',
    HARBORLIGHT_FORCE_UNSUPPORTED: '1',
    HARBORLIGHT_QUIET: '1',
    NODE_ENV: 'test'
  }
}

export function launchArgs(profile: string): string[] {
  return [
    join(ROOT, 'out', 'main', 'index.js'),
    `--user-data-dir=${profile}`,
    '--force-unsupported'
  ]
}

export const MAIN_WINDOW = 'index.html'
export const SPLASH_WINDOW = 'splash.html'
export const LICENSE_WINDOW = 'license.html'

/**
 * Waits for one of the app's windows by page name.
 *
 * Harborlight opens with a splash, so `firstWindow()` is no longer the window
 * a test wants; the pages are told apart by the file they loaded.
 */
export async function windowFor(
  app: ElectronApplication,
  page: string,
  timeoutMs = 30_000
): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  do {
    const match = app.windows().find((candidate) => candidate.url().includes(page))
    if (match) return match
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => undefined)
  } while (Date.now() < deadline)
  throw new Error(`No window loaded ${page} within ${timeoutMs}ms`)
}

interface HarborlightFixtures {
  app: ElectronApplication
  /** The main window. Named `ui` so `window` still means the browser global. */
  ui: Page
}

/**
 * Launches the built app with an isolated profile and the mock engine, so a
 * test run can never mutate the developer's containers or settings.
 */
export const test = base.extend<HarborlightFixtures>({
  // Playwright reads the destructuring pattern to work out fixture dependencies,
  // so this one has to stay empty rather than being renamed away.
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const profile = mkdtempSync(join(tmpdir(), 'harborlight-e2e-'))
    acceptLicense(profile)

    const app = await electron.launch({
      args: launchArgs(profile),
      cwd: ROOT,
      env: testEnv()
    })

    await use(app)

    await app.close().catch(() => undefined)
    rmSync(profile, { recursive: true, force: true })
  },

  ui: async ({ app }, use) => {
    const page = await windowFor(app, MAIN_WINDOW)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    // The splash holds the screen for a moment after the renderer has painted.
    // Waiting for the handover keeps tests off a window that is mid-transition.
    await expect.poll(() => app.windows().length, { timeout: 20_000 }).toBe(1)
    await use(page)
  }
})

export { expect } from '@playwright/test'
