import type { AppContext } from '../../context'
import { events } from '../../services/events'
import { streams } from '../../streams'
import type { CommandHandlers } from '../registry'

/** Shells tried in order when the user has not picked one explicitly. */
export const DEFAULT_SHELL_CANDIDATES = ['/bin/bash', '/bin/sh', '/bin/ash'] as const

/**
 * Interactive container sessions.
 *
 * Only `docker exec` inside an existing container is possible — Harborlight
 * never exposes a host shell.
 */
export const execHandlers = {
  'exec.start': async (payload, context: AppContext) => {
    const settings = context.settings.get()
    const requested =
      payload.shell ?? (settings.defaultShell === 'auto' ? null : settings.defaultShell)

    let sessionId: string | null = null
    const buffered: string[] = []

    const handle = await context.engines.requireConnected().startExec(
      {
        containerId: payload.containerId,
        shell: requested,
        user: payload.user,
        workingDir: payload.workingDir,
        cols: payload.cols,
        rows: payload.rows,
        shellCandidates: [...DEFAULT_SHELL_CANDIDATES]
      },
      {
        onData: (data) => {
          if (sessionId) events.emit('exec:data', { sessionId, data })
          else buffered.push(data)
        },
        onExit: (exitCode, message) => {
          if (sessionId) events.emit('exec:exit', { sessionId, exitCode, message })
        }
      }
    )

    sessionId = handle.id
    streams.addExec(handle)
    if (buffered.length > 0) events.emit('exec:data', { sessionId, data: buffered.join('') })

    // Root inside a container is not root on the host, but it can still write
    // to bind mounts as uid 0, so the UI warns before the first keystroke.
    const effectiveUser = payload.user ?? ''
    const warnRoot = effectiveUser === '' || effectiveUser === 'root' || effectiveUser === '0'

    return {
      sessionId: handle.id,
      shell: handle.shell,
      user: effectiveUser || 'container default',
      workingDir: handle.workingDir || 'image default',
      warnRoot
    }
  },

  'exec.write': async (payload) => {
    streams.requireExec(payload.sessionId).write(payload.data)
    return { ok: true as const, message: 'Sent.' }
  },

  'exec.resize': async (payload) => {
    streams.requireExec(payload.sessionId).resize(payload.cols, payload.rows)
    return { ok: true as const, message: 'Resized.' }
  },

  'exec.stop': async (payload) => {
    streams.stopExec(payload.sessionId)
    return { ok: true as const, message: 'Session closed.' }
  }
} satisfies Partial<CommandHandlers>
