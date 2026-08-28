import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowLeft, PanelBottomClose, PanelBottomOpen } from 'lucide-react'
import type { ContainerSummary } from '@shared/schemas/domain'
import { cn } from '@/lib/cn'
import { useUiStore } from '@/stores/ui'
import { Button, Spinner } from '@/components/ui/primitives'
import { Tabs } from '@/components/ui/overlays'
import { StateBadge } from '@/components/common/StatusBits'
import { ContainerActions } from './ContainerActions'
import { LogsViewer } from './LogsViewer'

// xterm.js and its addons only load when a terminal is actually opened.
const TerminalPane = lazy(async () => ({ default: (await import('./TerminalPane')).TerminalPane }))

const MIN_TERMINAL = 140
const MIN_LOGS = 160

/**
 * Focused view for a single container: log stream on top, optional interactive
 * terminal docked at the bottom, with a draggable divider between them.
 */
export function ContainerWorkspace({ container }: { container: ContainerSummary }): ReactElement {
  const panel = useUiStore((state) => state.containerPanel)
  const setPanel = useUiStore((state) => state.setContainerPanel)

  // `null` means "follow the requested panel"; a boolean is an explicit toggle.
  const [terminalOverride, setTerminalOverride] = useState<boolean | null>(null)
  const [terminalHeight, setTerminalHeight] = useState(260)
  const splitRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const terminalOpen = container.state === 'running' && (terminalOverride ?? panel === 'terminal')

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!draggingRef.current) return
    const node = splitRef.current
    if (!node) return
    const bounds = node.getBoundingClientRect()
    const next = bounds.bottom - event.clientY
    setTerminalHeight(
      Math.min(Math.max(next, MIN_TERMINAL), Math.max(bounds.height - MIN_LOGS, MIN_TERMINAL))
    )
  }, [])

  useEffect(() => {
    const stop = (): void => {
      draggingRef.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stop)
      stop()
    }
  }, [onPointerMove])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowLeft className="size-4" />}
          onClick={() => setPanel('details')}
        >
          Containers
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{container.name}</span>
          <StateBadge state={container.state} exitCode={container.exitCode} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={terminalOpen ? 'primary' : 'secondary'}
            disabled={container.state !== 'running'}
            icon={
              terminalOpen ? (
                <PanelBottomClose className="size-3.5" />
              ) : (
                <PanelBottomOpen className="size-3.5" />
              )
            }
            onClick={() => setTerminalOverride(!terminalOpen)}
          >
            Terminal
          </Button>
          <ContainerActions containers={[container]} layout="toolbar" />
        </div>
      </div>

      <div className="shrink-0 border-b border-line bg-surface px-4">
        <Tabs
          value="logs"
          onValueChange={(value) => setPanel(value as 'details' | 'inspect' | 'stats')}
          tabs={[
            { value: 'logs', label: 'Logs' },
            { value: 'details', label: 'Details' },
            { value: 'inspect', label: 'Inspect' },
            { value: 'stats', label: 'Stats' }
          ]}
        />
      </div>

      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <LogsViewer containerId={container.id} containerName={container.name} />
        </div>

        {terminalOpen ? (
          <>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize terminal"
              onPointerDown={() => {
                draggingRef.current = true
                document.body.style.cursor = 'row-resize'
              }}
              className={cn(
                'h-1.5 shrink-0 cursor-row-resize bg-line transition-colors hover:bg-brand/40'
              )}
            />
            <div style={{ height: terminalHeight }} className="min-h-0 shrink-0">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center bg-canvas">
                    <Spinner />
                  </div>
                }
              >
                <TerminalPane containerId={container.id} containerName={container.name} />
              </Suspense>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
