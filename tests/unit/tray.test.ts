import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { iconFile } from '@main/resources'
import type { AppContext } from '@main/context'
import type { Settings } from '@shared/schemas/domain'

/**
 * The bug this covers: the glyph stayed as it was created, because nothing
 * re-evaluated it when the preference changed. The tray only exists inside
 * Electron, so the module runs against a stub of the parts it touches.
 */

interface StubImage {
  path: string
  isEmpty(): boolean
}

const created: StubImage[] = []
const setImage = vi.fn<(image: StubImage) => void>()
const themeListeners: (() => void)[] = []
let prefersDark = false
/** Files the stub reports as unreadable, standing in for a missing icon. */
let unreadable: string[] = []

vi.mock('electron', () => {
  class TrayStub {
    constructor(image: StubImage) {
      created.push(image)
    }
    setImage = setImage
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    destroy = vi.fn()
    on = vi.fn()
  }

  return {
    app: { isPackaged: false },
    Menu: { buildFromTemplate: (template: unknown) => template },
    Tray: TrayStub,
    nativeImage: {
      createFromPath: (path: string): StubImage => ({
        path,
        isEmpty: () => unreadable.includes(path)
      }),
      createEmpty: (): StubImage => ({ path: '', isEmpty: () => true })
    },
    nativeTheme: {
      get shouldUseDarkColors() {
        return prefersDark
      },
      on: (_event: string, listener: () => void) => themeListeners.push(listener)
    }
  }
})

// Imported after the stubs above are initialised, so the mock factory can use them.
const { createTray, destroyTray, refreshTray } = await import('@main/tray/tray')

const CALLBACKS = {
  show: vi.fn(),
  hide: vi.fn(),
  quit: vi.fn(),
  navigate: vi.fn(),
  checkForUpdates: vi.fn(),
  showAbout: vi.fn()
}

let settings: Settings
const context = {
  settings: { get: () => settings },
  engines: { getStatus: () => null }
} as unknown as AppContext

function prefer(trayIcon: Settings['trayIcon']): void {
  settings = { ...settings, trayIcon }
}

const fileName = (path: string): string => path.split('/').at(-1) ?? ''

/** The glyph the tray is showing, whether set at construction or later. */
function shownIcon(): string {
  const latest = setImage.mock.calls.at(-1)?.[0] ?? created.at(-1)
  return latest ? fileName(latest.path) : ''
}

beforeEach(() => {
  vi.clearAllMocks()
  created.length = 0
  themeListeners.length = 0
  unreadable = []
  prefersDark = false
  process.env.XDG_CURRENT_DESKTOP = 'ubuntu:GNOME'
  settings = { trayIcon: 'auto', startAtLogin: false, startMinimized: false } as Settings
})

afterEach(() => {
  destroyTray()
  delete process.env.XDG_CURRENT_DESKTOP
})

describe('creating the tray', () => {
  it('starts with the glyph the preference resolves to', () => {
    prefer('dark')

    createTray(context, CALLBACKS)

    expect(shownIcon()).toBe('tray-dark.png')
  })

  it('reads the icon from outside the asar archive', () => {
    createTray(context, CALLBACKS)

    expect(created.at(-1)?.path).not.toContain('app.asar/')
  })

  it('still starts when the icon cannot be read', () => {
    unreadable = [iconFile('tray-light.png')]

    expect(createTray(context, CALLBACKS)).not.toBeNull()
    expect(shownIcon()).toBe('')
  })

  it('picks the icon up on the next refresh after a failed read', () => {
    unreadable = [iconFile('tray-light.png')]
    createTray(context, CALLBACKS)
    unreadable = []

    refreshTray(context, CALLBACKS)

    expect(shownIcon()).toBe('tray-light.png')
  })
})

describe('reacting to a preference change', () => {
  it('swaps the glyph when the setting changes', () => {
    createTray(context, CALLBACKS)
    prefer('dark')

    refreshTray(context, CALLBACKS)

    expect(shownIcon()).toBe('tray-dark.png')
  })

  it('swaps back', () => {
    createTray(context, CALLBACKS)
    prefer('dark')
    refreshTray(context, CALLBACKS)
    prefer('light')

    refreshTray(context, CALLBACKS)

    expect(shownIcon()).toBe('tray-light.png')
  })

  it('leaves the panel alone when nothing changed', () => {
    createTray(context, CALLBACKS)

    refreshTray(context, CALLBACKS)
    refreshTray(context, CALLBACKS)

    expect(setImage).not.toHaveBeenCalled()
  })
})

describe('reacting to the desktop theme', () => {
  it('follows the theme where the panel is not always dark', () => {
    process.env.XDG_CURRENT_DESKTOP = 'KDE'
    createTray(context, CALLBACKS)
    expect(shownIcon()).toBe('tray-dark.png')

    prefersDark = true
    for (const listener of themeListeners) listener()

    expect(shownIcon()).toBe('tray-light.png')
  })

  it('keeps the pale glyph on Ubuntu, where the top bar stays dark', () => {
    createTray(context, CALLBACKS)

    prefersDark = true
    for (const listener of themeListeners) listener()

    expect(setImage).not.toHaveBeenCalled()
    expect(shownIcon()).toBe('tray-light.png')
  })
})
