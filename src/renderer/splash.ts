import { bootStageProgress, type BootStage } from '@shared/contracts/boot'
import splashArt from './assets/splash.jpg'

/**
 * The splash window.
 *
 * Intentionally plain DOM rather than React: this page has to paint on the
 * first frame, before the application bundle has even been parsed, so it
 * carries no framework and no stylesheet request. The artwork is inlined as a
 * data URL at build time (see `assetsInlineLimit` in electron.vite.config.ts).
 */

const STAGE_LABELS: Record<BootStage, string> = {
  starting: 'Starting Harborlight',
  connecting: 'Connecting to the container engine',
  interface: 'Loading the interface',
  ready: 'Ready'
}

const art = document.getElementById('art')
if (art instanceof HTMLImageElement) art.src = splashArt

const stageLabel = document.getElementById('stage')
const track = document.getElementById('track')
const bar = document.getElementById('bar')

function render(stage: BootStage): void {
  const percent = Math.round(bootStageProgress(stage) * 100)
  if (stageLabel) stageLabel.textContent = STAGE_LABELS[stage]
  if (bar) bar.style.width = `${percent}%`
  track?.setAttribute('aria-valuenow', String(percent))
}

render('starting')
window.harborlightBoot?.onStage(render)
