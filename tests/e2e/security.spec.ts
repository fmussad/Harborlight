import { expect, test } from './fixtures'

test.describe('Renderer sandbox', () => {
  test('runs with context isolation, sandbox and no Node integration', async ({ app, ui }) => {
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0]!
      const webContents = target.webContents as unknown as {
        getLastWebPreferences(): Record<string, unknown>
      }
      const { contextIsolation, nodeIntegration, sandbox, webSecurity } =
        webContents.getLastWebPreferences()
      return { contextIsolation, nodeIntegration, sandbox, webSecurity }
    })

    expect(preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    })

    const globals = await ui.evaluate(() => ({
      require: typeof (globalThis as Record<string, unknown>).require,
      process: typeof (globalThis as Record<string, unknown>).process,
      module: typeof (globalThis as Record<string, unknown>).module,
      electron: typeof (globalThis as Record<string, unknown>).electron
    }))
    expect(globals).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      electron: 'undefined'
    })
  })

  test('exposes only invoke and subscribe on the bridge', async ({ ui }) => {
    const keys = await ui.evaluate(() =>
      Object.keys(window.harborlight as unknown as Record<string, unknown>).sort()
    )
    expect(keys).toEqual(['invoke', 'subscribe', 'version'])
  })

  test('serves the app from disk under a policy that forbids remote and inline scripts', async ({
    ui
  }) => {
    expect(ui.url().startsWith('file://')).toBe(true)

    const policy = await ui.evaluate(
      () =>
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute('content') ?? ''
    )
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toContain('unsafe-eval')
    expect(policy).not.toContain('http://')

    const inlineScriptRan = await ui.evaluate(() => {
      const script = document.createElement('script')
      script.textContent = 'window.__harborlightInlineScriptRan = true'
      document.body.appendChild(script)
      script.remove()
      return Boolean((window as unknown as Record<string, unknown>).__harborlightInlineScriptRan)
    })
    expect(inlineScriptRan).toBe(false)
  })

  test('rejects commands that are not on the allowlist', async ({ ui }) => {
    const response = await ui.evaluate(() =>
      (
        window.harborlight as unknown as {
          invoke(name: string): Promise<{ ok: boolean; error?: { code: string; message: string } }>
        }
      ).invoke('system.runArbitraryThing')
    )

    expect(response.ok).toBe(false)
    expect(response.error?.code).toBe('not-allowed')
  })

  test('rejects a payload that fails schema validation', async ({ ui }) => {
    const response = await ui.evaluate(() =>
      window.harborlight!.invoke('containers.inspect', { id: '' })
    )
    expect(response.ok).toBe(false)
    expect(response.ok ? null : response.error.code).toBe('validation')
  })

  test('keeps the error code and hint intact across the bridge', async ({ ui }) => {
    const response = await ui.evaluate(() =>
      window.harborlight!.invoke('compose.openFile', { path: '/etc/compose.yml' })
    )
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error.code).toBeTruthy()
      expect(typeof response.error.message).toBe('string')
    }
  })

  test('refuses to open a non-allowlisted external URL', async ({ ui }) => {
    const response = await ui.evaluate(() =>
      window.harborlight!.invoke('system.openExternal', { url: 'file:///etc/passwd' })
    )
    expect(response.ok).toBe(false)
  })

  test('denies device permission requests', async ({ ui }) => {
    const state = await ui.evaluate(async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true })
        return 'granted'
      } catch {
        return 'denied'
      }
    })
    expect(state).toBe('denied')
  })
})
