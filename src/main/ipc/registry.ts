import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import { IPC_INVOKE_CHANNEL } from '@shared/contracts/channels'
import {
  commandSchemas,
  isCommandName,
  type CommandName,
  type CommandPayload
} from '@shared/contracts/commands'
import type { CommandResult, IpcResponse } from '@shared/contracts/responses'
import type { AppContext } from '../context'
import { HarborlightError, toErrorPayload } from '../errors'
import { logger } from '../services/logger'

export type CommandHandler<K extends CommandName> = (
  payload: CommandPayload<K>,
  context: AppContext
) => Promise<CommandResult<K>>

export type CommandHandlers = { [K in CommandName]: CommandHandler<K> }

/** Commands that are noisy enough to log only at debug level. */
const QUIET_COMMANDS = new Set<CommandName>([
  'containers.list',
  'containers.stats',
  'engine.getStatus',
  'engine.getUsageHistory',
  'system.listTasks',
  'exec.write',
  'exec.resize',
  'images.list',
  'volumes.list',
  'networks.list'
])

/**
 * Single entry point for every renderer -> main call.
 *
 * The order matters: the sender is checked first, then the command is matched
 * against the allowlist, then the payload is parsed by that command's schema.
 * A handler therefore only ever runs with a validated payload from a frame we
 * created ourselves.
 */
export function registerIpcGateway(handlers: CommandHandlers, context: AppContext): void {
  ipcMain.handle(IPC_INVOKE_CHANNEL, async (event: IpcMainInvokeEvent, raw: unknown) => {
    const started = Date.now()
    let command = '<unknown>'

    try {
      assertTrustedSender(event)

      if (typeof raw !== 'object' || raw === null) {
        throw new HarborlightError('validation', 'Malformed IPC request.')
      }
      const request = raw as { command?: unknown; payload?: unknown }
      if (!isCommandName(request.command)) {
        throw new HarborlightError(
          'not-allowed',
          `"${String(request.command)}" is not an allowed command.`
        )
      }
      command = request.command

      const schema = commandSchemas[request.command]
      const payload = schema.parse(request.payload ?? {})
      const handler = handlers[request.command] as CommandHandler<CommandName>
      const data = await handler(payload as CommandPayload<CommandName>, context)

      if (!QUIET_COMMANDS.has(request.command)) {
        logger.debug('ipc', `${command} ok in ${Date.now() - started}ms`)
      }
      return { ok: true, data } satisfies IpcResponse<CommandName>
    } catch (error) {
      if (error instanceof ZodError) {
        const issue = error.issues[0]
        const payload = new HarborlightError(
          'validation',
          `Invalid arguments for "${command}": ${issue?.message ?? 'schema mismatch'}`,
          { details: issue ? `at ${issue.path.join('.') || '<root>'}` : null }
        ).toPayload()
        logger.warn('ipc', `${command} rejected: ${payload.message}`)
        return { ok: false, error: payload } satisfies IpcResponse<CommandName>
      }

      const payload = toErrorPayload(error)
      const level = payload.code === 'unknown' ? 'error' : 'warn'
      logger[level]('ipc', `${command} failed: ${payload.message}`)
      return { ok: false, error: payload } satisfies IpcResponse<CommandName>
    }
  })
}

/**
 * Only frames loaded from our own bundle may call the gateway. This blocks a
 * compromised iframe or an unexpected navigation from reaching Docker.
 */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const trusted =
    url.startsWith('file://') ||
    url.startsWith('devtools://') ||
    /^http:\/\/localhost:\d+/.test(url) ||
    /^http:\/\/127\.0\.0\.1:\d+/.test(url)
  if (!trusted) {
    throw new HarborlightError('not-allowed', 'IPC from an untrusted frame was rejected.', {
      details: url.slice(0, 200)
    })
  }
}

export function disposeIpcGateway(): void {
  ipcMain.removeHandler(IPC_INVOKE_CHANNEL)
}
