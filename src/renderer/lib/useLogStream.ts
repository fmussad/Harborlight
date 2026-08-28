import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogChunk } from '@shared/contracts/responses'
import { invoke, subscribe, toUiError } from './bridge'

export interface LogLine extends LogChunk {
  key: string
  level: LogLevel
  source: string | null
  text: string
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LEVEL_PATTERN =
  /\b(FATAL|CRITICAL|ERROR|ERRO|WARNING|WARN|NOTICE|INFO|DEBUG|DEBU|TRACE|VERBOSE)\b/i

/**
 * Classifies a line by its embedded level word.
 *
 * Docker gives Harborlight no structured level, so this is a best-effort read
 * of the text used only for colouring and the level filter; the raw line is
 * always preserved.
 */
export function classifyLine(message: string): { level: LogLevel; source: string | null } {
  const match = LEVEL_PATTERN.exec(message)
  const word = match?.[1]?.toUpperCase()
  const level: LogLevel =
    word === 'FATAL' || word === 'CRITICAL' || word === 'ERROR' || word === 'ERRO'
      ? 'error'
      : word === 'WARNING' || word === 'WARN'
        ? 'warn'
        : word === 'DEBUG' || word === 'DEBU'
          ? 'debug'
          : word === 'TRACE' || word === 'VERBOSE'
            ? 'trace'
            : 'info'

  // Common shape: "<level> <component> <message>" as produced by logrus/zap.
  const after = match ? message.slice(match.index + match[0].length).trimStart() : ''
  const sourceMatch = /^([a-z][\w.-]{1,24})\s/.exec(after)

  return { level, source: sourceMatch?.[1] ?? null }
}

const MAX_LINES = 20_000

interface LogStreamOptions {
  containerId: string | null
  tail: number
  timestamps: boolean
  sinceSeconds: number | null
  enabled: boolean
}

interface StreamState {
  key: string
  lines: LogLine[]
  streaming: boolean
  error: string | null
  hint: string | null
}

interface LogStreamResult {
  lines: LogLine[]
  paused: boolean
  streaming: boolean
  error: string | null
  hint: string | null
  setPaused(paused: boolean): void
  clear(): void
  restart(): void
}

function emptyState(key: string): StreamState {
  return { key, lines: [], streaming: false, error: null, hint: null }
}

/**
 * Owns one `logs.start` stream for a container.
 *
 * State is keyed by the stream parameters, so switching container resets the
 * view during render instead of through a cascade of effects. While paused,
 * incoming lines are held in a side buffer rather than dropped.
 */
export function useLogStream(options: LogStreamOptions): LogStreamResult {
  const { containerId, tail, timestamps, sinceSeconds, enabled } = options
  const streamKey = `${containerId ?? ''}|${tail}|${timestamps}|${sinceSeconds ?? 'all'}|${enabled}`

  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<StreamState>(() => emptyState(streamKey))
  const [paused, setPaused] = useState(false)

  const pausedRef = useRef(paused)
  const pendingRef = useRef<LogLine[]>([])
  const counterRef = useRef(0)

  const current = state.key === streamKey ? state : emptyState(streamKey)

  useEffect(() => {
    if (!containerId || !enabled) return undefined

    let streamId: string | null = null
    let cancelled = false
    counterRef.current = 0
    pendingRef.current = []

    const patch = (change: Partial<StreamState>): void => {
      setState((previous) =>
        previous.key === streamKey
          ? { ...previous, ...change }
          : { ...emptyState(streamKey), ...change }
      )
    }

    const append = (chunks: LogChunk[]): void => {
      const mapped = chunks.map((chunk) => {
        counterRef.current += 1
        const { level, source } = classifyLine(chunk.message)
        return { ...chunk, key: String(counterRef.current), level, source, text: chunk.message }
      })

      if (pausedRef.current) {
        pendingRef.current = [...pendingRef.current, ...mapped].slice(-MAX_LINES)
        return
      }
      setState((previous) => {
        const base = previous.key === streamKey ? previous : emptyState(streamKey)
        return { ...base, lines: [...base.lines, ...mapped].slice(-MAX_LINES) }
      })
    }

    const unsubscribe = subscribe((event) => {
      if (event.type === 'logs:data' && event.payload.streamId === streamId) {
        append(event.payload.chunk)
      } else if (event.type === 'logs:error' && event.payload.streamId === streamId) {
        patch({ error: event.payload.message, streaming: false })
      } else if (event.type === 'logs:end' && event.payload.streamId === streamId) {
        patch({ streaming: false })
      }
    })

    void invoke('logs.start', { containerId, tail, timestamps, sinceSeconds, follow: true })
      .then((result) => {
        if (cancelled) {
          void invoke('logs.stop', { streamId: result.streamId }).catch(() => undefined)
          return
        }
        streamId = result.streamId
        patch({ streaming: true })
      })
      .catch((cause) => {
        if (cancelled) return
        const uiError = toUiError(cause)
        patch({ error: uiError.message, hint: uiError.hint, streaming: false })
      })

    return () => {
      cancelled = true
      unsubscribe()
      if (streamId) void invoke('logs.stop', { streamId }).catch(() => undefined)
    }
  }, [containerId, enabled, nonce, sinceSeconds, streamKey, tail, timestamps])

  const changePaused = useCallback(
    (next: boolean) => {
      pausedRef.current = next
      setPaused(next)
      if (!next && pendingRef.current.length > 0) {
        const buffered = pendingRef.current
        pendingRef.current = []
        setState((previous) => {
          const base = previous.key === streamKey ? previous : emptyState(streamKey)
          return { ...base, lines: [...base.lines, ...buffered].slice(-MAX_LINES) }
        })
      }
    },
    [streamKey]
  )

  const clear = useCallback(() => {
    pendingRef.current = []
    setState((previous) => ({ ...previous, key: streamKey, lines: [] }))
  }, [streamKey])

  const restart = useCallback(() => {
    setState(emptyState(streamKey))
    setNonce((value) => value + 1)
  }, [streamKey])

  return {
    lines: current.lines,
    paused,
    streaming: current.streaming,
    error: current.error,
    hint: current.hint,
    setPaused: changePaused,
    clear,
    restart
  }
}
