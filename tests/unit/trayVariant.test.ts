import { describe, expect, it } from 'vitest'
import { hasDarkPanel, resolveTrayVariant, trayIconFileName } from '@main/tray/variant'

/**
 * The glyph has to be legible against the panel, which is not the same thing as
 * matching the application theme: Ubuntu keeps its top bar dark in light mode
 * too, so following the theme there would paint black on black.
 */

const gnome = { currentDesktop: 'ubuntu:GNOME', prefersDarkChrome: false }

describe('automatic selection', () => {
  it('keeps the pale glyph on Ubuntu regardless of the application theme', () => {
    expect(resolveTrayVariant('auto', gnome)).toBe('light')
    expect(resolveTrayVariant('auto', { ...gnome, prefersDarkChrome: true })).toBe('light')
  })

  it('follows the active theme on desktops whose panel is not always dark', () => {
    expect(resolveTrayVariant('auto', { currentDesktop: 'KDE', prefersDarkChrome: true })).toBe(
      'light'
    )
    expect(resolveTrayVariant('auto', { currentDesktop: 'KDE', prefersDarkChrome: false })).toBe(
      'dark'
    )
  })

  it('falls back to the theme when the desktop does not identify itself', () => {
    expect(resolveTrayVariant('auto', { currentDesktop: undefined, prefersDarkChrome: true })).toBe(
      'light'
    )
    expect(resolveTrayVariant('auto', { currentDesktop: '', prefersDarkChrome: false })).toBe(
      'dark'
    )
  })
})

describe('explicit preference', () => {
  it('wins over the heuristic, because no heuristic can see the real panel', () => {
    expect(resolveTrayVariant('dark', gnome)).toBe('dark')
    expect(resolveTrayVariant('light', { currentDesktop: 'KDE', prefersDarkChrome: false })).toBe(
      'light'
    )
  })
})

describe('desktop detection', () => {
  it('reads every entry of a colon-separated XDG_CURRENT_DESKTOP', () => {
    expect(hasDarkPanel('ubuntu:GNOME')).toBe(true)
    expect(hasDarkPanel('GNOME-Flashback:GNOME')).toBe(true)
    expect(hasDarkPanel('X-Cinnamon')).toBe(false)
  })

  it('ignores case', () => {
    expect(hasDarkPanel('gnome')).toBe(true)
    expect(hasDarkPanel('Unity')).toBe(true)
    expect(hasDarkPanel('Pantheon')).toBe(true)
  })

  it('treats a missing variable as unknown rather than assuming GNOME', () => {
    expect(hasDarkPanel(undefined)).toBe(false)
  })

  it('does not match a desktop that merely contains the name', () => {
    expect(hasDarkPanel('gnome-classic')).toBe(false)
  })
})

describe('file names', () => {
  it('maps a variant to the shipped glyph', () => {
    expect(trayIconFileName('light')).toBe('tray-light.png')
    expect(trayIconFileName('dark')).toBe('tray-dark.png')
  })
})
