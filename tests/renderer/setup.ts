import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { setTransport } from '@/lib/bridge'

// jsdom implements neither of these, and the layout components rely on both.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}

Element.prototype.scrollIntoView ??= function scrollIntoView(): void {}

afterEach(() => {
  cleanup()
  setTransport(null)
})
