import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BrowserWindow,
  nativeImage,
  session,
  shell,
  type BrowserWindowConstructorOptions,
  type NativeImage
} from 'electron'
import { isAllowedExternalUrl } from '../ipc/handlers/system'
import { iconFile } from '../resources'
import { events } from '../services/events'
import { logger } from '../services/logger'

const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL

/**
 * Content Security Policy.
 *
 * Production is as tight as the app allows: no remote origins at all, and no
 * `unsafe-eval` anywhere. `style-src 'unsafe-inline'` is required because
 * CodeMirror, xterm.js and React Flow inject <style> elements at runtime.
 */
export function contentSecurityPolicy(isDev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'media-src': ["'none'"],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'base-uri': ["'self'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"]
  }

  if (isDev && DEV_SERVER_URL) {
    // Vite's dev server serves modules over HTTP and pushes HMR over a WebSocket.
    directives['script-src']?.push("'unsafe-inline'", DEV_SERVER_URL)
    directives['style-src']?.push(DEV_SERVER_URL)
    directives['connect-src']?.push(DEV_SERVER_URL, DEV_SERVER_URL.replace(/^http/, 'ws'))
    directives['img-src']?.push(DEV_SERVER_URL)
    directives['font-src']?.push(DEV_SERVER_URL)
  }

  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ')
}

export function applySecurityPolicies(isDev: boolean): void {
  const policy = contentSecurityPolicy(isDev)

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
        'X-Content-Type-Options': ['nosniff']
      }
    })
  })

  // The renderer has no legitimate need for any of these device permissions.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    logger.warn('security', `Denied permission request: ${permission}`)
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
}

/**
 * Window icon with a high-resolution representation.
 *
 * GNOME normally draws the dock and overview icon from the desktop entry, but
 * it falls back to the window's own icon whenever `StartupWMClass` does not
 * match — during development, for instance. Shipping the 2x representation
 * keeps that fallback sharp instead of upscaling a single bitmap.
 */
function windowIcon(): NativeImage {
  const image = nativeImage.createFromPath(iconFile('512x512.png'))
  if (image.isEmpty()) {
    logger.warn('app', 'Window icon could not be read; the desktop will fall back to a default')
    return image
  }
  try {
    image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(iconFile('1024x1024.png')) })
  } catch (error) {
    logger.debug('app', 'No 2x window icon available', error)
  }
  return image
}

export interface CreateWindowOptions {
  isDev: boolean
  startHidden: boolean
  onCloseRequested(window: BrowserWindow): boolean
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const preload = join(__dirname, '../preload/index.cjs')

  const config: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#faf9f9',
    title: 'Harborlight',
    icon: windowIcon(),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: options.isDev
    }
  }

  const window = new BrowserWindow(config)
  events.register(window)

  window.once('ready-to-show', () => {
    if (!options.startHidden) window.show()
  })

  // Navigation is fixed at load time; anything else is an attack or a bug.
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_SERVER_URL ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://')
    if (!allowed) {
      event.preventDefault()
      logger.warn('security', `Blocked in-window navigation to ${url}`)
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url)
    } else {
      logger.warn('security', `Blocked window.open to ${url}`)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
    logger.warn('security', 'Blocked a <webview> attachment')
  })

  window.on('close', (event) => {
    if (options.onCloseRequested(window)) {
      event.preventDefault()
      window.hide()
    }
  })

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
