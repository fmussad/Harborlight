import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Where the pre-application pages live.
 *
 * The licence gate and the splash are separate Vite entry points rather than
 * routes inside the app bundle, so they can paint without loading React. In
 * development they come from the Vite dev server; in a build they sit next to
 * `index.html` in the renderer output.
 */
export type BootPage = 'splash' | 'license'

export function bootPageUrl(page: BootPage): string {
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) return `${devServer}/${page}.html`
  return pathToFileURL(join(__dirname, `../renderer/${page}.html`)).href
}

export function bootPagePreload(): string {
  return join(__dirname, '../preload/boot.cjs')
}
