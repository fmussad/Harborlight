import type { LogChunk } from '@shared/contracts/responses'

/**
 * Docker multiplexes container logs into 8-byte framed records when the
 * container has no TTY: [stream(1)][000][size(4, big endian)][payload].
 * With a TTY the stream is raw bytes.
 *
 * The assembler is incremental: it keeps partial frames and partial lines
 * between socket reads so a line split across TCP packets is emitted once.
 */
export class LogAssembler {
  private buffer: Buffer = Buffer.alloc(0)
  private partial: { stdout: string; stderr: string } = { stdout: '', stderr: '' }
  private sequence = 0

  constructor(private readonly tty: boolean) {}

  push(data: Buffer): LogChunk[] {
    return this.tty ? this.pushRaw(data) : this.pushFramed(data)
  }

  /** Emits whatever is still buffered, e.g. a last line without a newline. */
  flush(): LogChunk[] {
    const chunks: LogChunk[] = []
    for (const stream of ['stdout', 'stderr'] as const) {
      const rest = this.partial[stream]
      if (rest.length > 0) {
        this.partial[stream] = ''
        chunks.push(this.toChunk(stream, rest))
      }
    }
    return chunks
  }

  private pushRaw(data: Buffer): LogChunk[] {
    return this.consumeText('stdout', data.toString('utf8'))
  }

  private pushFramed(data: Buffer): LogChunk[] {
    this.buffer = this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data])
    const chunks: LogChunk[] = []

    while (this.buffer.length >= 8) {
      const streamType = this.buffer.readUInt8(0)
      const size = this.buffer.readUInt32BE(4)
      if (this.buffer.length < 8 + size) break
      const payload = this.buffer.subarray(8, 8 + size).toString('utf8')
      this.buffer = this.buffer.subarray(8 + size)
      chunks.push(...this.consumeText(streamType === 2 ? 'stderr' : 'stdout', payload))
    }

    // A malformed/huge frame must never grow the buffer without bound.
    if (this.buffer.length > 8 * 1024 * 1024) this.buffer = Buffer.alloc(0)
    return chunks
  }

  private consumeText(stream: 'stdout' | 'stderr', text: string): LogChunk[] {
    const combined = this.partial[stream] + text
    const lines = combined.split('\n')
    this.partial[stream] = lines.pop() ?? ''
    // Guard against a pathological single line with no newline at all.
    if (this.partial[stream].length > 1_000_000) {
      const forced = this.partial[stream]
      this.partial[stream] = ''
      lines.push(forced)
    }
    return lines.filter((line) => line.length > 0).map((line) => this.toChunk(stream, line))
  }

  private toChunk(stream: 'stdout' | 'stderr', line: string): LogChunk {
    const cleaned = line.replace(/\r$/, '')
    const { timestamp, message } = splitTimestamp(cleaned)
    this.sequence += 1
    return { stream, timestamp, message, sequence: this.sequence }
  }
}

const RFC3339 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s(.*)$/s

/** Separates the RFC3339 prefix Docker adds when `timestamps: true`. */
export function splitTimestamp(line: string): { timestamp: string | null; message: string } {
  const match = line.match(RFC3339)
  if (!match?.[1]) return { timestamp: null, message: line }
  return { timestamp: match[1], message: match[2] ?? '' }
}
