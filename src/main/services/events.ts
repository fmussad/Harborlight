import type { BrowserWindow } from 'electron'
import { IPC_EVENT_CHANNEL } from '@shared/contracts/channels'
import type { AppEventMap } from '@shared/contracts/responses'

/**
 * One-way main -> renderer channel. Windows register themselves here so that
 * background work (engine polling, log streams, compose output) can push
 * updates without the renderer polling for them.
 */
class EventBus {
  private readonly windows = new Set<BrowserWindow>()

  register(window: BrowserWindow): void {
    this.windows.add(window)
    window.on('closed', () => this.windows.delete(window))
  }

  emit<K extends keyof AppEventMap>(type: K, payload: AppEventMap[K]): void {
    for (const window of this.windows) {
      if (window.isDestroyed()) {
        this.windows.delete(window)
        continue
      }
      window.webContents.send(IPC_EVENT_CHANNEL, { type, payload })
    }
  }

  hasWindows(): boolean {
    return [...this.windows].some((window) => !window.isDestroyed())
  }
}

export const events = new EventBus()
