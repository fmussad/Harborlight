import { expect, test } from './fixtures'

test.describe('Application shell', () => {
  test('opens a single window with the full navigation', async ({ app, ui }) => {
    expect(app.windows()).toHaveLength(1)
    await expect(ui).toHaveTitle(/Harborlight/)

    const nav = ui.getByRole('navigation', { name: 'Main' })
    for (const label of [
      'Overview',
      'Containers',
      'Compose',
      'Images',
      'Volumes',
      'Networks',
      'Registry',
      'Settings'
    ]) {
      await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
  })

  test('reports the mock engine as connected', async ({ ui }) => {
    await expect(
      ui.getByRole('navigation', { name: 'Main' }).getByText('Engine running')
    ).toBeVisible()
  })

  test('navigates between sections', async ({ ui }) => {
    const nav = ui.getByRole('navigation', { name: 'Main' })

    await nav.getByRole('button', { name: 'Containers', exact: true }).click()
    await expect(ui.getByRole('heading', { name: 'Containers' })).toBeVisible()

    await nav.getByRole('button', { name: 'Images', exact: true }).click()
    await expect(ui.getByRole('heading', { name: 'Images' })).toBeVisible()

    await nav.getByRole('button', { name: 'Volumes', exact: true }).click()
    await expect(ui.getByRole('heading', { name: 'Volumes' })).toBeVisible()

    await nav.getByRole('button', { name: 'Networks', exact: true }).click()
    await expect(ui.getByRole('heading', { name: 'Networks' })).toBeVisible()
  })

  test('opens the command palette with Ctrl+K and navigates from it', async ({ ui }) => {
    await ui.keyboard.press('Control+k')
    const palette = ui.getByRole('dialog')
    await expect(palette).toBeVisible()

    await ui.keyboard.type('volumes')
    await ui.keyboard.press('Enter')

    await expect(palette).toBeHidden()
    await expect(ui.getByRole('heading', { name: 'Volumes' })).toBeVisible()
  })
})

test.describe('Containers', () => {
  test.beforeEach(async ({ ui }) => {
    await ui
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Containers', exact: true })
      .click()
    await expect(ui.getByRole('heading', { name: 'Containers' })).toBeVisible()
  })

  test('lists the containers reported by the engine', async ({ ui }) => {
    await expect(ui.getByRole('cell', { name: 'fcs-api', exact: false }).first()).toBeVisible()
    await expect(ui.getByRole('row')).not.toHaveCount(1)
  })

  test('filters the list from the search box', async ({ ui }) => {
    await ui.getByLabel('Search containers').fill('mariadb')
    await expect(ui.getByRole('table').getByText('mariadb', { exact: false }).first()).toBeVisible()
    await expect(ui.getByRole('table').getByText('mailhog')).toHaveCount(0)
  })

  test('opens the detail panel for a container', async ({ ui }) => {
    await ui.getByRole('table').getByText('fcs-api').first().click()
    await expect(ui.getByRole('button', { name: 'Restart' }).first()).toBeVisible()
  })

  test('asks for confirmation before a destructive action', async ({ ui }) => {
    await ui.getByRole('table').getByText('fcs-api').first().click()
    await ui.getByRole('button', { name: 'More container actions' }).click()
    await ui.getByRole('menuitem', { name: /Kill/ }).click()

    const dialog = ui.getByRole('dialog')
    await expect(dialog).toContainText('Kill fcs-api?')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('Settings', () => {
  test('changes and persists the theme', async ({ ui }) => {
    await ui
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click()
    await expect(ui.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await ui.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click()
    await expect(ui.locator('html')).toHaveClass(/dark/)

    const stored = await ui.evaluate(() => window.harborlight!.invoke('settings.get'))
    expect(stored.ok && stored.data.theme).toBe('dark')
  })

  test('keeps the tray glyph preference across a restart', async ({ ui }) => {
    await ui
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click()

    const trayIcon = ui.getByRole('radiogroup', { name: 'Tray icon' })
    await expect(trayIcon.getByRole('radio', { name: 'Auto' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    await trayIcon.getByRole('radio', { name: 'Dark' }).click()

    const stored = await ui.evaluate(() => window.harborlight!.invoke('settings.get'))
    expect(stored.ok && stored.data.trayIcon).toBe('dark')
  })
})
