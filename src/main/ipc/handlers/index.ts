import type { CommandHandlers } from '../registry'
import { composeHandlers } from './compose'
import { containerHandlers } from './containers'
import { execHandlers } from './exec'
import { imageHandlers } from './images'
import { logHandlers } from './logs'
import { cleanupHandlers, engineHandlers, registryHandlers, settingsHandlers } from './misc'
import { resourceHandlers } from './resources'
import { systemHandlers } from './system'

/**
 * The complete handler table.
 *
 * TypeScript fails the build if a command in the allowlist has no handler, so
 * the contract and the implementation cannot drift apart.
 */
export const handlers: CommandHandlers = {
  ...systemHandlers,
  ...settingsHandlers,
  ...engineHandlers,
  ...containerHandlers,
  ...logHandlers,
  ...execHandlers,
  ...imageHandlers,
  ...resourceHandlers,
  ...cleanupHandlers,
  ...composeHandlers,
  ...registryHandlers
}
