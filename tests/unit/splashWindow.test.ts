import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_BOOT_STAGE_CHANNEL } from '@shared/contracts/boot'

/**
 * Two bugs live here, and both were found on screen rather than in review: the
 * first stages were sent before the page had a listener, so the bar never
 * moved, and work that finishes out of order could send it backwards.
 */

type Listener = () => void

const send = vi.fn<(channel: string, stage: string) => void>()
const destroy = vi.fn()
const show = vi.fn()
const loadURL = vi.fn()

let windowListeners: Record<string, Listener[]> = {}
let contentsListeners: Record<string, Listener[]> = {}
let destroyed = false

function fire(listeners: Record<string, Listener[]>, event: string): void {
  for (const listener of listeners[event] ?? []) listener()
}

vi.mock('electron', () => {
  class BrowserWindowStub {
    webContents = {
      send,
      once: (event: string, listener: Listener) => {
        ;(contentsListeners[event] ??= []).push(listener)
      }
    }

    once(event: string, listener: Listener): void {
      ;(windowListeners[event] ??= []).push(listener)
    }

    show = show
    loadURL = loadURL
    destroy = (): void => {
      destroyed = true
      destroy()
    }
    isDestroyed = (): boolean => destroyed
  }

  return { app: { isPackaged: false }, BrowserWindow: BrowserWindowStub }
})

const { createSplashWindow } = await import('@main/windows/splashWindow')

/** Brings the window up to the state it reaches once the page has loaded. */
function pageReady(): void {
  fire(windowListeners, 'ready-to-show')
  fire(contentsListeners, 'did-finish-load')
}

const stagesSent = (): string[] =>
  send.mock.calls
    .filter(([channel]) => channel === IPC_BOOT_STAGE_CHANNEL)
    .map(([, stage]) => stage)

beforeEach(() => {
  vi.useFakeTimers()
  windowListeners = {}
  contentsListeners = {}
  destroyed = false
  send.mockClear()
  destroy.mockClear()
  show.mockClear()
  loadURL.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('creating the splash', () => {
  it('loads the splash page and shows it only once it can paint', () => {
    createSplashWindow(false)

    expect(loadURL).toHaveBeenCalledWith(expect.stringContaining('splash.html'))
    expect(show).not.toHaveBeenCalled()

    fire(windowListeners, 'ready-to-show')
    expect(show).toHaveBeenCalledTimes(1)
  })
})

describe('stage updates', () => {
  it('holds the stage until the page can receive it', () => {
    const splash = createSplashWindow(false)!

    splash.setStage('connecting')
    expect(stagesSent()).toEqual([])

    pageReady()
    expect(stagesSent()).toEqual(['connecting'])
  })

  it('replays only the furthest stage reached before the page loaded', () => {
    const splash = createSplashWindow(false)!

    splash.setStage('connecting')
    splash.setStage('interface')
    pageReady()

    expect(stagesSent()).toEqual(['interface'])
  })

  it('sends stages straight through once loaded', () => {
    const splash = createSplashWindow(false)!
    pageReady()

    splash.setStage('connecting')
    splash.setStage('interface')
    splash.setStage('ready')

    expect(stagesSent()).toEqual(['connecting', 'interface', 'ready'])
  })

  it('never moves the bar backwards when work finishes out of order', () => {
    const splash = createSplashWindow(false)!
    pageReady()

    splash.setStage('ready')
    splash.setStage('interface')
    splash.setStage('connecting')

    expect(stagesSent()).toEqual(['ready'])
  })

  it('ignores stages once the window is gone', async () => {
    const splash = createSplashWindow(false)!
    pageReady()
    await vi.advanceTimersByTimeAsync(2000)
    await splash.finish()
    send.mockClear()

    splash.setStage('ready')
    expect(stagesSent()).toEqual([])
  })
})

describe('handing over to the main window', () => {
  it('stays on screen long enough to be read', async () => {
    const splash = createSplashWindow(false)!
    pageReady()

    const finished = splash.finish()
    await vi.advanceTimersByTimeAsync(500)
    expect(destroy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(700)
    await finished
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('closes immediately when it has already been up for a while', async () => {
    const splash = createSplashWindow(false)!
    pageReady()
    await vi.advanceTimersByTimeAsync(3000)

    await splash.finish()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('gives up on its own if the main window never arrives', async () => {
    createSplashWindow(false)
    pageReady()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('does not close twice when the safety timeout has already fired', async () => {
    const splash = createSplashWindow(false)!
    pageReady()

    await vi.advanceTimersByTimeAsync(15_000)
    await splash.finish()

    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
