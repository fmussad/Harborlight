import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LogChunk } from '@shared/contracts/responses'
import { useLogStream } from '@/lib/useLogStream'
import { installFakeTransport, type FakeTransport } from './testUtils'

let transport: FakeTransport
let sequence = 0

function chunk(message: string): LogChunk {
  sequence += 1
  return { stream: 'stdout', timestamp: null, message, sequence }
}

function emitLines(streamId: string, ...messages: string[]): void {
  act(() => {
    transport.emit({ type: 'logs:data', payload: { streamId, chunk: messages.map(chunk) } })
  })
}

beforeEach(() => {
  sequence = 0
  transport = installFakeTransport({
    'logs.start': async () => ({ streamId: 'stream-1' }),
    'logs.stop': async () => ({ ok: true, message: 'stopped' })
  })
})

const OPTIONS = {
  containerId: 'abc',
  tail: 500,
  timestamps: true,
  sinceSeconds: null,
  enabled: true
}

describe('useLogStream', () => {
  it('starts a stream with the requested options', async () => {
    const { result } = renderHook(() => useLogStream(OPTIONS))
    await waitFor(() => expect(result.current.streaming).toBe(true))

    expect(transport.calls[0]).toEqual({
      command: 'logs.start',
      payload: { containerId: 'abc', tail: 500, timestamps: true, sinceSeconds: null, follow: true }
    })
  })

  it('appends incoming lines and classifies them', async () => {
    const { result } = renderHook(() => useLogStream(OPTIONS))
    await waitFor(() => expect(result.current.streaming).toBe(true))

    emitLines('stream-1', 'INFO server listening', 'ERROR db connection refused')

    expect(result.current.lines).toHaveLength(2)
    expect(result.current.lines[0]?.level).toBe('info')
    expect(result.current.lines[1]?.level).toBe('error')
    expect(result.current.lines[0]?.key).not.toBe(result.current.lines[1]?.key)
  })

  it('ignores events from a different stream', async () => {
    const { result } = renderHook(() => useLogStream(OPTIONS))
    await waitFor(() => expect(result.current.streaming).toBe(true))

    emitLines('someone-elses-stream', 'INFO not mine')
    expect(result.current.lines).toHaveLength(0)
  })

  it('buffers while paused and releases on resume without losing lines', async () => {
    const { result } = renderHook(() => useLogStream(OPTIONS))
    await waitFor(() => expect(result.current.streaming).toBe(true))

    emitLines('stream-1', 'INFO one')
    act(() => result.current.setPaused(true))
    emitLines('stream-1', 'INFO two', 'INFO three')

    expect(result.current.paused).toBe(true)
    expect(result.current.lines).toHaveLength(1)

    act(() => result.current.setPaused(false))
    expect(result.current.lines.map((line) => line.text)).toEqual([
      'INFO one',
      'INFO two',
      'INFO three'
    ])
  })

  it('clears the buffer on demand', async () => {
    const { result } = renderHook(() => useLogStream(OPTIONS))
    await waitFor(() => expect(result.current.streaming).toBe(true))

    emitLines('stream-1', 'INFO one', 'INFO two')
    act(() => result.current.clear())
    expect(result.current.lines).toHaveLength(0)
  })

  it('surfaces stream errors with their hint', async () => {
    transport = installFakeTransport({
      'logs.start': async () => {
        throw Object.assign(new Error('Container is not running.'), {
          code: 'conflict',
          hint: 'Start it first.'
        })
      },
      'logs.stop': async () => ({ ok: true, message: 'stopped' })
    })

    const { result } = renderHook(() => useLogStream(OPTIONS))
    await waitFor(() => expect(result.current.error).toBe('Container is not running.'))
    expect(result.current.hint).toBe('Start it first.')
    expect(result.current.streaming).toBe(false)
  })

  it('marks the stream as finished when the container exits', async () => {
    const { result } = renderHook(() => useLogStream(OPTIONS))
    await waitFor(() => expect(result.current.streaming).toBe(true))

    act(() => {
      transport.emit({
        type: 'logs:end',
        payload: { streamId: 'stream-1', reason: 'container exited' }
      })
    })
    expect(result.current.streaming).toBe(false)
  })

  it('starts nothing when disabled or without a container', async () => {
    renderHook(() => useLogStream({ ...OPTIONS, enabled: false }))
    renderHook(() => useLogStream({ ...OPTIONS, containerId: null }))
    await Promise.resolve()
    expect(transport.calls).toHaveLength(0)
  })

  it('resets the view and restarts when the container changes', async () => {
    const { result, rerender } = renderHook((props: typeof OPTIONS) => useLogStream(props), {
      initialProps: OPTIONS
    })
    await waitFor(() => expect(result.current.streaming).toBe(true))
    emitLines('stream-1', 'INFO one')
    expect(result.current.lines).toHaveLength(1)

    rerender({ ...OPTIONS, containerId: 'other' })
    expect(result.current.lines).toHaveLength(0)
    await waitFor(() =>
      expect(transport.calls.filter((call) => call.command === 'logs.start')).toHaveLength(2)
    )
  })

  it('stops the stream when the component unmounts', async () => {
    const { result, unmount } = renderHook(() => useLogStream(OPTIONS))
    await waitFor(() => expect(result.current.streaming).toBe(true))

    unmount()
    await waitFor(() =>
      expect(transport.calls.some((call) => call.command === 'logs.stop')).toBe(true)
    )
  })
})
