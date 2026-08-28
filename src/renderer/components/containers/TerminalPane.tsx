import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { AlertTriangle, Copy, RotateCw, Trash2 } from 'lucide-react'
import { invoke, subscribe, toUiError } from '@/lib/bridge'
import { useSettings } from '@/lib/queries'
import { Badge, Button } from '@/components/ui/primitives'
import { useToast } from '@/providers/ToastProvider'

function readTheme(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback

  return {
    background: token('--hl-bg-canvas', '#15161e'),
    foreground: token('--hl-text', '#ececef'),
    cursor: token('--hl-brand', '#f04e23'),
    selectionBackground: `${token('--hl-accent', '#7c5cff')}55`,
    black: '#000000',
    red: token('--hl-danger', '#ef5a4a'),
    green: token('--hl-success', '#37c06b'),
    yellow: token('--hl-warning', '#e5a63c'),
    blue: token('--hl-info', '#6ea8fe'),
    magenta: token('--hl-accent', '#9b7bff'),
    cyan: token('--hl-teal', '#38c2d0'),
    white: token('--hl-text-secondary', '#a2a2ae')
  }
}

interface SessionInfo {
  sessionId: string
  shell: string
  user: string
  warnRoot: boolean
}

/**
 * Interactive `docker exec` session rendered with xterm.js.
 *
 * The renderer never talks to Docker: keystrokes go to the main process over
 * `exec.write`, and output arrives as `exec:data` events.
 */
export function TerminalPane({
  containerId,
  containerName,
  onSessionCount
}: {
  containerId: string
  containerName: string
  onSessionCount?(count: number): void
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string | null>(null)

  const { data: settings } = useSettings()
  const { toastError } = useToast()
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [error, setError] = useState<{ message: string; hint: string | null } | null>(null)
  const [exited, setExited] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const preferredShell = settings?.defaultShell ?? null

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    const terminal = new Terminal({
      fontFamily: "'Ubuntu Mono', 'JetBrains Mono', 'DejaVu Sans Mono', monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      convertEol: false,
      scrollback: 10_000,
      allowProposedApi: true,
      theme: readTheme()
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(new SearchAddon())
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(host)
    fit.fit()

    terminalRef.current = terminal
    fitRef.current = fit

    let disposed = false
    setError(null)
    setExited(null)

    const unsubscribe = subscribe((event) => {
      if (event.type === 'exec:data' && event.payload.sessionId === sessionRef.current) {
        terminal.write(event.payload.data)
      } else if (event.type === 'exec:exit' && event.payload.sessionId === sessionRef.current) {
        setExited(event.payload.message)
        sessionRef.current = null
        onSessionCount?.(0)
      }
    })

    const inputDisposable = terminal.onData((data) => {
      const id = sessionRef.current
      if (!id) return
      void invoke('exec.write', { sessionId: id, data }).catch((cause) =>
        setError({ message: toUiError(cause).message, hint: toUiError(cause).hint })
      )
    })

    const observer = new ResizeObserver(() => {
      if (disposed) return
      try {
        fit.fit()
      } catch {
        return
      }
      const id = sessionRef.current
      if (id) {
        void invoke('exec.resize', {
          sessionId: id,
          cols: terminal.cols,
          rows: terminal.rows
        }).catch(() => undefined)
      }
    })
    observer.observe(host)

    void invoke('exec.start', {
      containerId,
      shell: preferredShell,
      user: null,
      workingDir: null,
      cols: terminal.cols,
      rows: terminal.rows
    })
      .then((result) => {
        if (disposed) {
          void invoke('exec.stop', { sessionId: result.sessionId }).catch(() => undefined)
          return
        }
        sessionRef.current = result.sessionId
        setSession({
          sessionId: result.sessionId,
          shell: result.shell,
          user: result.user,
          warnRoot: result.warnRoot
        })
        onSessionCount?.(1)
        terminal.focus()
      })
      .catch((cause) => {
        const uiError = toUiError(cause)
        setError({ message: uiError.message, hint: uiError.hint })
      })

    return () => {
      disposed = true
      observer.disconnect()
      inputDisposable.dispose()
      unsubscribe()
      const id = sessionRef.current
      sessionRef.current = null
      if (id) void invoke('exec.stop', { sessionId: id }).catch(() => undefined)
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      onSessionCount?.(0)
    }
  }, [containerId, nonce, onSessionCount, preferredShell])

  // Re-theme in place when the user switches between light and dark.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (terminalRef.current) terminalRef.current.options.theme = readTheme()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const copySelection = async (): Promise<void> => {
    const selection = terminalRef.current?.getSelection()
    if (!selection) return
    try {
      await navigator.clipboard.writeText(selection)
    } catch (cause) {
      toastError(cause, 'Could not copy the selection')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
        <span className="text-xs font-medium text-ink">Terminal</span>
        <span className="font-mono text-[11px] text-ink-muted">
          {session ? `${session.user}@${containerName}:${session.shell}` : containerName}
        </span>
        {session?.warnRoot ? (
          <Badge tone="warning">
            <AlertTriangle className="size-3" aria-hidden />
            root
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<Copy className="size-3.5" />}
            onClick={() => void copySelection()}
          >
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            onClick={() => terminalRef.current?.clear()}
          >
            Clear
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<RotateCw className="size-3.5" />}
            onClick={() => setNonce((value) => value + 1)}
          >
            New session
          </Button>
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-fg">
          <p className="selectable font-medium">{error.message}</p>
          {error.hint ? <p className="selectable mt-0.5 text-ink-secondary">{error.hint}</p> : null}
        </div>
      ) : null}

      {exited ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 py-2 text-xs text-ink-secondary">
          <span className="selectable">{exited}</span>
          <button
            type="button"
            className="font-medium text-brand hover:underline"
            onClick={() => setNonce((value) => value + 1)}
          >
            Start a new session
          </button>
        </div>
      ) : null}

      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1.5" />
    </div>
  )
}
