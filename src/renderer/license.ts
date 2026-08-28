import { MIT_LICENSE_TEXT } from '@shared/license'

/**
 * The first-run licence gate.
 *
 * Plain DOM for the same reason as the splash: this page runs before the
 * application exists and has no business pulling in React. Its only capability
 * is `respondToLicense`; the main process owns what happens next.
 */

const text = document.getElementById('text')
if (text) text.textContent = MIT_LICENSE_TEXT

function respond(accepted: boolean): void {
  window.harborlightBoot?.respondToLicense(accepted)
}

document.getElementById('accept')?.addEventListener('click', () => respond(true))
document.getElementById('decline')?.addEventListener('click', () => respond(false))

// Escape is the same as declining, matching the window's close button.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') respond(false)
})

document.getElementById('accept')?.focus()
