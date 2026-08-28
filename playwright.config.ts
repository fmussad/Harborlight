import { defineConfig } from '@playwright/test'

/**
 * Electron end-to-end suite.
 *
 * The app is launched from `out/` (run `npm run build` first) with the mock
 * engine so the tests never touch a real Docker daemon.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
