import { describe, expect, it } from 'vitest'
import { LogAssembler, splitTimestamp } from '@main/docker/logFrames'

function frame(stream: 1 | 2, payload: string): Buffer {
  const body = Buffer.from(payload, 'utf8')
  const header = Buffer.alloc(8)
  header.writeUInt8(stream, 0)
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

describe('LogAssembler (framed streams)', () => {
  it('separates stdout and stderr', () => {
    const assembler = new LogAssembler(false)
    const chunks = assembler.push(Buffer.concat([frame(1, 'hello\n'), frame(2, 'boom\n')]))

    expect(chunks.map((chunk) => [chunk.stream, chunk.message])).toEqual([
      ['stdout', 'hello'],
      ['stderr', 'boom']
    ])
  })

  it('waits for a frame that arrives in pieces', () => {
    const assembler = new LogAssembler(false)
    const full = frame(1, 'split across reads\n')

    expect(assembler.push(full.subarray(0, 5))).toEqual([])
    expect(assembler.push(full.subarray(5, 12))).toEqual([])
    const chunks = assembler.push(full.subarray(12))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.message).toBe('split across reads')
  })

  it('joins a line that spans two frames', () => {
    const assembler = new LogAssembler(false)
    expect(assembler.push(frame(1, 'first half '))).toEqual([])
    const chunks = assembler.push(frame(1, 'second half\n'))
    expect(chunks[0]?.message).toBe('first half second half')
  })

  it('numbers chunks so the renderer can key them', () => {
    const assembler = new LogAssembler(false)
    const chunks = assembler.push(frame(1, 'a\nb\nc\n'))
    expect(chunks.map((chunk) => chunk.sequence)).toEqual([1, 2, 3])
  })

  it('flushes a trailing line without a newline', () => {
    const assembler = new LogAssembler(false)
    expect(assembler.push(frame(1, 'no newline'))).toEqual([])
    expect(assembler.flush().map((chunk) => chunk.message)).toEqual(['no newline'])
  })
})

describe('LogAssembler (TTY streams)', () => {
  it('treats everything as stdout', () => {
    const assembler = new LogAssembler(true)
    const chunks = assembler.push(Buffer.from('raw line\n', 'utf8'))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.stream).toBe('stdout')
    expect(chunks[0]?.message).toBe('raw line')
  })
})

describe('splitTimestamp', () => {
  it('extracts the RFC3339 prefix Docker prepends', () => {
    expect(splitTimestamp('2026-05-16T18:32:11.123456789Z starting server')).toEqual({
      timestamp: '2026-05-16T18:32:11.123456789Z',
      message: 'starting server'
    })
  })

  it('leaves untimestamped lines untouched', () => {
    expect(splitTimestamp('starting server')).toEqual({
      timestamp: null,
      message: 'starting server'
    })
  })
})
