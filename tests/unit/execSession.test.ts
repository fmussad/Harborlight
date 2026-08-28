import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BrowserWindow } from 'electron'
import { MockEngineAdapter } from '@main/docker/mockAdapter'
import { execHandlers, DEFAULT_SHELL_CANDIDATES } from '@main/ipc/handlers/exec'
import { events } from '@main/services/events'
import { SettingsStore } from '@main/services/settings'
import { streams } from '@main/streams'
import type { AppContext } from '@main/context'
import type { AppEventMap } from '@shared/contracts/responses'
import { mockContainers } from '@shared/mock/fixtures'

/**
 * A terminal session is the one place where keystrokes reach a container, so
 * its lifecycle is covered end to end against the mock engine: start, echo,
 * write, resize, stop, and the errors a stale session must produce.
 */

const CONTAINER_ID = mockContainers()[0]!.id

interface Sent {
  type: keyof AppEventMap
  payload: unknown
}

let sent: Sent[]
let engine: MockEngineAdapter
let context: AppContext
let fakeWindow: BrowserWindow
let userData: string

/** Captures what the main process would push to the renderer. */
function registerFakeWindow(): BrowserWindow {
  const window = {
    isDestroyed: () => false,
    on: () => window,
    webContents: {
      send: (_channel: string, envelope: Sent) => {
        sent.push(envelope)
      }
    }
  } as unknown as BrowserWindow
  events.register(window)
  return window
}

const dataFor = (sessionId: string): string =>
  sent
    .filter((event) => event.type === 'exec:data')
    .map((event) => event.payload as { sessionId: string; data: string })
    .filter((payload) => payload.sessionId === sessionId)
    .map((payload) => payload.data)
    .join('')

const exitFor = (sessionId: string): { exitCode: number | null; message: string } | undefined =>
  sent
    .filter((event) => event.type === 'exec:exit')
    .map(
      (event) => event.payload as { sessionId: string; exitCode: number | null; message: string }
    )
    .find((payload) => payload.sessionId === sessionId)

/** Lets the mock engine's queued writes reach the event bus. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

async function start(payload: Partial<Parameters<(typeof execHandlers)['exec.start']>[0]> = {}) {
  return execHandlers['exec.start'](
    {
      containerId: CONTAINER_ID,
      shell: null,
      user: null,
      workingDir: null,
      cols: 80,
      rows: 24,
      ...payload
    },
    context
  )
}

beforeEach(() => {
  sent = []
  engine = new MockEngineAdapter()
  fakeWindow = registerFakeWindow()
  userData = mkdtempSync(join(tmpdir(), 'harborlight-exec-'))
  context = {
    settings: new SettingsStore(userData),
    engines: { requireConnected: () => engine },
    secrets: {} as AppContext['secrets'],
    getMainWindow: () => null,
    quit: () => undefined,
    hideToTray: () => undefined,
    refreshTray: () => undefined
  } as unknown as AppContext
})

afterEach(async () => {
  streams.stopAll()
  await engine.dispose()
  // The bus drops windows on 'closed'; the stub reports itself destroyed instead.
  Object.defineProperty(fakeWindow, 'isDestroyed', { value: () => true })
  rmSync(userData, { recursive: true, force: true })
})

describe('starting a session', () => {
  it('reports the shell, user and working directory it landed on', async () => {
    const session = await start()

    expect(session.sessionId).toBeTruthy()
    expect(session.shell).toBe(DEFAULT_SHELL_CANDIDATES[0])
    expect(session.user).toBe('container default')
    expect(session.workingDir).toBeTruthy()
  })

  it('registers the session so later commands can find it', async () => {
    const before = streams.counts().execs

    await start()

    expect(streams.counts().execs).toBe(before + 1)
  })

  it('warns when the session runs as root', async () => {
    expect((await start()).warnRoot).toBe(true)
    expect((await start({ user: 'root' })).warnRoot).toBe(true)
    expect((await start({ user: '0' })).warnRoot).toBe(true)
    expect((await start({ user: 'app' })).warnRoot).toBe(false)
  })

  it('honours an explicitly requested shell', async () => {
    expect((await start({ shell: '/bin/ash' })).shell).toBe('/bin/ash')
  })

  it('uses the configured default shell when the caller does not pick one', async () => {
    context.settings.update({ defaultShell: '/bin/sh' })

    expect((await start()).shell).toBe('/bin/sh')
  })

  it('delivers the banner printed before the session id existed', async () => {
    const session = await start()

    await flush()

    // The mock engine writes its banner asynchronously; nothing may be dropped
    // in the window between startExec resolving and the id being known.
    expect(dataFor(session.sessionId)).toContain('Harborlight mock shell')
  })

  it('fails for a container that does not exist', async () => {
    await expect(start({ containerId: 'does-not-exist' })).rejects.toThrow()
  })
})

describe('interacting with a session', () => {
  it('echoes what the user types', async () => {
    const session = await start()
    await flush()
    sent = []

    await execHandlers['exec.write']({ sessionId: session.sessionId, data: 'ls' })

    expect(dataFor(session.sessionId)).toBe('ls')
  })

  it('runs a command and prints a new prompt on Enter', async () => {
    const session = await start()
    await flush()
    sent = []

    await execHandlers['exec.write']({ sessionId: session.sessionId, data: 'ls\r' })

    const output = dataFor(session.sessionId)
    expect(output).toContain('total')
    expect(output).toMatch(/@[^\s]+:[^\s]+# $/)
  })

  it('handles backspace without dropping below an empty buffer', async () => {
    const session = await start()
    await flush()
    sent = []

    await execHandlers['exec.write']({
      sessionId: session.sessionId,
      data: '\u007f\u007fab\u007f\r'
    })

    expect(dataFor(session.sessionId)).toContain('\b \b')
  })

  it('accepts a resize', async () => {
    const session = await start()

    await expect(
      execHandlers['exec.resize']({ sessionId: session.sessionId, cols: 120, rows: 40 })
    ).resolves.toMatchObject({ ok: true })
  })
})

describe('ending a session', () => {
  it('emits an exit event and forgets the session when the shell exits', async () => {
    const session = await start()
    await flush()

    await execHandlers['exec.write']({ sessionId: session.sessionId, data: 'exit\r' })

    expect(exitFor(session.sessionId)).toMatchObject({ exitCode: 0 })
  })

  it('closes the session on request', async () => {
    const session = await start()
    const before = streams.counts().execs

    await execHandlers['exec.stop']({ sessionId: session.sessionId })

    expect(streams.counts().execs).toBe(before - 1)
    expect(exitFor(session.sessionId)).toMatchObject({ exitCode: 0 })
  })

  it('is idempotent when stopped twice', async () => {
    const session = await start()

    await execHandlers['exec.stop']({ sessionId: session.sessionId })
    await expect(
      execHandlers['exec.stop']({ sessionId: session.sessionId })
    ).resolves.toMatchObject({
      ok: true
    })
  })

  it('rejects writes to a session that is already closed', async () => {
    const session = await start()
    await execHandlers['exec.stop']({ sessionId: session.sessionId })

    await expect(
      execHandlers['exec.write']({ sessionId: session.sessionId, data: 'ls\r' })
    ).rejects.toThrow(/no longer open/)
  })

  it('rejects a resize for an unknown session instead of silently succeeding', async () => {
    await expect(
      execHandlers['exec.resize']({ sessionId: 'not-a-session', cols: 80, rows: 24 })
    ).rejects.toThrow(/no longer open/)
  })

  it('tears down every session when the app shuts down', async () => {
    await start()
    await start()

    streams.stopAll()

    expect(streams.counts().execs).toBe(0)
  })
})
