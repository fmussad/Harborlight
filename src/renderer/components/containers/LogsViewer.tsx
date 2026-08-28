import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowDownToLine, Download, Eraser, Pause, Play, Search, WrapText } from 'lucide-react'
import { cn } from '@/lib/cn'
import { invoke } from '@/lib/bridge'
import { useSettings } from '@/lib/queries'
import { useLogStream, type LogLevel } from '@/lib/useLogStream'
import { Button, Input, Select, Switch, Tooltip } from '@/components/ui/primitives'
import { useToast } from '@/providers/ToastProvider'

const LEVEL_OPTIONS = [
  { value: 'all', label: 'All levels' },
  { value: 'error', label: 'Errors' },
  { value: 'warn', label: 'Warnings and above' },
  { value: 'info', label: 'Info and above' },
  { value: 'debug', label: 'Debug and above' }
]

const SINCE_OPTIONS = [
  { value: '0', label: 'All time' },
  { value: '900', label: 'Since 15 minutes' },
  { value: '3600', label: 'Since 1 hour' },
  { value: '21600', label: 'Since 6 hours' },
  { value: '86400', label: 'Since 24 hours' }
]

const LEVEL_RANK: Record<LogLevel, number> = { error: 4, warn: 3, info: 2, debug: 1, trace: 0 }

const LEVEL_STYLE: Record<LogLevel, string> = {
  error: 'bg-danger-soft text-danger-fg',
  warn: 'bg-warning-soft text-warning-fg',
  info: 'bg-surface-3 text-ink-muted',
  debug: 'bg-accent-soft text-accent',
  trace: 'bg-surface-3 text-ink-muted'
}

/** Splits a line so the search term can be highlighted without dangerous HTML. */
function highlight(text: string, needle: string): ReactElement {
  if (!needle) return <>{text}</>

  const segments: { text: string; match: boolean }[] = []
  const lower = text.toLowerCase()
  const target = needle.toLowerCase()
  let index = 0

  while (index < text.length) {
    const found = lower.indexOf(target, index)
    if (found === -1) {
      segments.push({ text: text.slice(index), match: false })
      break
    }
    if (found > index) segments.push({ text: text.slice(index, found), match: false })
    segments.push({ text: text.slice(found, found + needle.length), match: true })
    index = found + needle.length
  }

  return (
    <>
      {segments.map((segment, position) =>
        segment.match ? (
          <mark key={position} className="rounded-sm bg-warning-soft text-warning-fg">
            {segment.text}
          </mark>
        ) : (
          <span key={position}>{segment.text}</span>
        )
      )}
    </>
  )
}

export function LogsViewer({
  containerId,
  containerName
}: {
  containerId: string
  containerName: string
}): ReactElement {
  const { data: settings } = useSettings()
  const { toast, toastError } = useToast()
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState('all')
  const [since, setSince] = useState('0')
  const [follow, setFollow] = useState(true)
  const [wrap, setWrap] = useState(settings?.logWordWrap ?? true)
  const [exporting, setExporting] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  const stream = useLogStream({
    containerId,
    tail: settings?.logTailLines ?? 500,
    timestamps: settings?.logTimestamps ?? true,
    sinceSeconds: since === '0' ? null : Number(since),
    enabled: true
  })

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const minimum = level === 'all' ? -1 : LEVEL_RANK[level as LogLevel]
    return stream.lines.filter((line) => {
      if (minimum >= 0 && LEVEL_RANK[line.level] < minimum) return false
      if (needle && !line.text.toLowerCase().includes(needle)) return false
      return true
    })
  }, [level, search, stream.lines])

  useLayoutEffect(() => {
    if (!follow || stream.paused) return
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [filtered.length, follow, stream.paused])

  // Scrolling up is an implicit request to stop following the tail.
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return undefined
    const onScroll = (): void => {
      const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
      if (!atBottom && follow) setFollow(false)
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [follow])

  const exportLogs = async (): Promise<void> => {
    setExporting(true)
    try {
      const result = await invoke('logs.export', {
        containerId,
        tail: 20_000,
        timestamps: settings?.logTimestamps ?? true
      })
      if (!result.cancelled && result.path) {
        toast({
          level: 'success',
          title: 'Logs exported',
          message: `${result.lines} lines written to ${result.path}`
        })
      }
    } catch (error) {
      toastError(error, 'Could not export logs')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search logs…"
          icon={<Search className="size-3.5" />}
          wrapperClassName="w-64"
          aria-label="Search logs"
        />
        <Select
          ariaLabel="Log level"
          value={level}
          onChange={setLevel}
          options={LEVEL_OPTIONS}
          className="w-44"
        />
        <Select
          ariaLabel="Time range"
          value={since}
          onChange={setSince}
          options={SINCE_OPTIONS}
          className="w-40"
        />

        <div className="ml-auto flex items-center gap-1.5">
          <Tooltip content={wrap ? 'Disable word wrap' : 'Enable word wrap'}>
            <span className="mr-1 flex items-center gap-1.5 text-xs text-ink-muted">
              <WrapText className="size-3.5" aria-hidden />
              <Switch checked={wrap} onCheckedChange={setWrap} ariaLabel="Word wrap" />
            </span>
          </Tooltip>
          <Button
            size="sm"
            variant="secondary"
            icon={stream.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            onClick={() => stream.setPaused(!stream.paused)}
          >
            {stream.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Eraser className="size-3.5" />}
            onClick={stream.clear}
          >
            Clear
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={exporting}
            icon={<Download className="size-3.5" />}
            onClick={() => void exportLogs()}
          >
            Export
          </Button>
          <Button
            size="sm"
            variant={follow ? 'primary' : 'secondary'}
            icon={<ArrowDownToLine className="size-3.5" />}
            onClick={() => {
              setFollow(true)
              const node = scrollRef.current
              if (node) node.scrollTop = node.scrollHeight
            }}
          >
            Follow
          </Button>
        </div>
      </div>

      {stream.error ? (
        <div className="shrink-0 border-b border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-fg">
          <span className="selectable">{stream.error}</span>
          {stream.hint ? (
            <span className="selectable ml-1 text-ink-secondary">{stream.hint}</span>
          ) : null}
          <button type="button" onClick={stream.restart} className="ml-2 font-medium underline">
            Retry
          </button>
        </div>
      ) : null}

      <div ref={scrollRef} className="hl-scroll min-h-0 flex-1 bg-canvas font-mono text-xs">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-ink-muted">
            {stream.lines.length === 0
              ? `No output from ${containerName} yet.`
              : 'No lines match the current filters.'}
          </p>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {filtered.map((line) => (
                <tr key={line.key} className="align-top hover:bg-surface-2/60">
                  {settings?.logTimestamps !== false && line.timestamp ? (
                    <td className="w-[168px] py-[3px] pr-2 pl-3 whitespace-nowrap text-ink-muted select-none">
                      {new Date(line.timestamp).toLocaleString([], { hour12: false })}
                    </td>
                  ) : null}
                  <td className="w-14 py-[3px] pr-2 select-none">
                    <span
                      className={cn(
                        'inline-block w-full rounded px-1 text-center text-[10px] font-semibold uppercase',
                        LEVEL_STYLE[line.level]
                      )}
                    >
                      {line.level}
                    </span>
                  </td>
                  <td className="w-24 py-[3px] pr-2 truncate text-accent select-none">
                    {line.source ?? ''}
                  </td>
                  <td
                    className={cn(
                      'selectable py-[3px] pr-4',
                      wrap ? 'break-all whitespace-pre-wrap' : 'truncate whitespace-pre',
                      line.stream === 'stderr' ? 'text-danger-fg' : 'text-ink-secondary'
                    )}
                  >
                    {highlight(line.text, search.trim())}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-line bg-surface px-3 py-1.5 text-[11px] text-ink-muted">
        <span>
          {filtered.length.toLocaleString()} of {stream.lines.length.toLocaleString()} lines
          {stream.paused ? ' · paused' : stream.streaming ? ' · streaming' : ' · stopped'}
        </span>
        <span>{containerName}</span>
      </div>
    </div>
  )
}
