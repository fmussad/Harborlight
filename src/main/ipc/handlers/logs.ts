import { writeFile } from 'node:fs/promises'
import { dialog } from 'electron'
import type { LogChunk } from '@shared/contracts/responses'
import type { AppContext } from '../../context'
import { events } from '../../services/events'
import { streams } from '../../streams'
import type { CommandHandlers } from '../registry'

/**
 * Log streaming.
 *
 * The engine adapter batches and throttles chunks; this layer forwards them to
 * the renderer. Events produced before the adapter returns its handle are
 * buffered so the very first lines are never lost.
 */
export const logHandlers = {
  'logs.start': async (payload, context: AppContext) => {
    let streamId: string | null = null
    const buffered: LogChunk[] = []
    let endedEarly: string | null = null

    const handle = await context.engines.requireConnected().streamLogs(
      {
        containerId: payload.containerId,
        tail: payload.tail,
        timestamps: payload.timestamps,
        sinceSeconds: payload.sinceSeconds,
        follow: payload.follow
      },
      {
        onChunk: (chunk) => {
          if (streamId) events.emit('logs:data', { streamId, chunk })
          else buffered.push(...chunk)
        },
        onError: (message) => {
          if (streamId) events.emit('logs:error', { streamId, message })
        },
        onEnd: (reason) => {
          if (streamId) events.emit('logs:end', { streamId, reason })
          else endedEarly = reason
        }
      }
    )

    streamId = handle.id
    streams.addLog(handle)
    if (buffered.length > 0) events.emit('logs:data', { streamId, chunk: buffered })
    if (endedEarly) events.emit('logs:end', { streamId, reason: endedEarly })

    return { streamId: handle.id }
  },

  'logs.stop': async (payload) => {
    streams.stopLog(payload.streamId)
    return { ok: true as const, message: 'Log stream closed.' }
  },

  'logs.export': async (payload, context: AppContext) => {
    const chunks = await context.engines.requireConnected().collectLogs({
      containerId: payload.containerId,
      tail: payload.tail,
      timestamps: payload.timestamps,
      sinceSeconds: null,
      follow: false
    })

    const window = context.getMainWindow()
    const suggested = `harborlight-${payload.containerId.slice(0, 12)}-${Date.now()}.log`
    const result = window
      ? await dialog.showSaveDialog(window, {
          title: 'Export container logs',
          defaultPath: suggested,
          filters: [{ name: 'Log files', extensions: ['log', 'txt'] }]
        })
      : await dialog.showSaveDialog({ title: 'Export container logs', defaultPath: suggested })

    if (result.canceled || !result.filePath)
      return { path: null, cancelled: true, lines: chunks.length }

    const body = chunks
      .map((chunk) => `${chunk.timestamp ? `${chunk.timestamp} ` : ''}${chunk.message}`)
      .join('\n')
    await writeFile(result.filePath, `${body}\n`, 'utf8')
    return { path: result.filePath, cancelled: false, lines: chunks.length }
  }
} satisfies Partial<CommandHandlers>
