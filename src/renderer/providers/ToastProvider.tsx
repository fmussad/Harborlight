import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { toUiError } from '@/lib/bridge'

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

export interface ToastOptions {
  title: string
  message?: string
  hint?: string | null
  level?: ToastLevel
  durationMs?: number
}

interface ToastEntry extends Required<Omit<ToastOptions, 'hint' | 'message'>> {
  id: string
  message: string
  hint: string | null
}

interface ToastApi {
  toast(options: ToastOptions): void
  /** Renders an unknown error with its recovery hint, the Harborlight way. */
  toastError(error: unknown, fallbackTitle?: string): void
}

const ToastContext = createContext<ToastApi | null>(null)

const ICONS: Record<ToastLevel, ReactNode> = {
  info: <Info className="size-4 text-info" aria-hidden />,
  success: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  warning: <AlertTriangle className="size-4 text-warning" aria-hidden />,
  error: <XCircle className="size-4 text-danger" aria-hidden />
}

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [entries, setEntries] = useState<ToastEntry[]>([])

  const toast = useCallback((options: ToastOptions) => {
    const entry: ToastEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: options.title,
      message: options.message ?? '',
      hint: options.hint ?? null,
      level: options.level ?? 'info',
      durationMs: options.durationMs ?? (options.level === 'error' ? 12_000 : 5000)
    }
    setEntries((current) => [...current.slice(-4), entry])
  }, [])

  const toastError = useCallback(
    (error: unknown, fallbackTitle = 'Operation failed') => {
      const uiError = toUiError(error)
      toast({
        level: 'error',
        title: fallbackTitle,
        message: uiError.message,
        hint: uiError.hint
      })
    },
    [toast]
  )

  const api = useMemo<ToastApi>(() => ({ toast, toastError }), [toast, toastError])

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {entries.map((entry) => (
          <ToastPrimitive.Root
            key={entry.id}
            duration={entry.durationMs}
            onOpenChange={(open) => {
              if (!open) setEntries((current) => current.filter((item) => item.id !== entry.id))
            }}
            className={cn(
              'flex items-start gap-3 rounded-card border bg-surface p-3 shadow-pop',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out',
              entry.level === 'error' ? 'border-danger-line' : 'border-line'
            )}
          >
            <span className="mt-0.5">{ICONS[entry.level]}</span>
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-[13px] font-semibold text-ink">
                {entry.title}
              </ToastPrimitive.Title>
              {entry.message ? (
                <ToastPrimitive.Description className="selectable mt-0.5 text-xs break-words text-ink-secondary">
                  {entry.message}
                </ToastPrimitive.Description>
              ) : null}
              {entry.hint ? (
                <p className="selectable mt-1.5 rounded border border-line bg-surface-2 p-1.5 text-[11px] text-ink-muted">
                  {entry.hint}
                </p>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label="Dismiss"
              className="rounded p-0.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-3.5" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
