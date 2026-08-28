import type { TrayIconPreference } from '@shared/schemas/domain'

/** The glyph itself, not the theme it sits under. */
export type TrayIconVariant = 'light' | 'dark'

/**
 * Desktops whose panel stays dark no matter which theme the user picked.
 * GNOME's top bar is the reason the automatic choice cannot simply follow
 * `nativeTheme.shouldUseDarkColors`: on Ubuntu in light mode that would put a
 * near-black glyph on a near-black bar.
 */
const DARK_PANEL_DESKTOPS = ['gnome', 'unity', 'pantheon']

export function hasDarkPanel(currentDesktop: string | undefined): boolean {
  if (!currentDesktop) return false
  const entries = currentDesktop.toLowerCase().split(':')
  return entries.some((entry) => DARK_PANEL_DESKTOPS.includes(entry))
}

/**
 * Picks the tray glyph.
 *
 * An explicit preference always wins, because no heuristic can see the panel a
 * user actually has. Automatic assumes a dark panel on GNOME-based desktops and
 * otherwise follows the active theme.
 */
export function resolveTrayVariant(
  preference: TrayIconPreference,
  context: { currentDesktop: string | undefined; prefersDarkChrome: boolean }
): TrayIconVariant {
  if (preference !== 'auto') return preference
  if (hasDarkPanel(context.currentDesktop)) return 'light'
  return context.prefersDarkChrome ? 'light' : 'dark'
}

export function trayIconFileName(variant: TrayIconVariant): string {
  return `tray-${variant}.png`
}
