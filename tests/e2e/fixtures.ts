import { mkdtempSync, rmSync } from 'node:fs'
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
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      // Editors that are themselves Electron apps export this; it would turn
      // the child Electron binary into a plain Node process.
      if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue
      env[key] = value
    }

    const app = await electron.launch({
      args: [
        join(ROOT, 'out', 'main', 'index.js'),
        `--user-data-dir=${profile}`,
        '--force-unsupported'
      ],
      cwd: ROOT,
      env: {
        ...env,
        HARBORLIGHT_ENGINE: 'mock',
        HARBORLIGHT_FORCE_UNSUPPORTED: '1',
        HARBORLIGHT_QUIET: '1',
        NODE_ENV: 'test'
      }
    })

    await use(app)

    await app.close().catch(() => undefined)
    rmSync(profile, { recursive: true, force: true })
  },

  ui: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await use(page)
  }
})

export { expect } from '@playwright/test'
