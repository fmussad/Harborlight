import { useState, type ReactElement, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './primitives'

/* ----------------------------------------------------------------- Dialog */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md'
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg' | 'xl'
}): ReactElement {
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-4rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-card border border-line bg-surface shadow-pop focus:outline-none',
            widths[width]
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-sm font-semibold text-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-xs text-ink-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close dialog">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children ? <div className="hl-scroll max-h-[65vh] px-5 py-4">{children}</div> : null}
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/* ---------------------------------------------------------- ConfirmDialog */

export interface ConfirmRequest {
  title: string
  description: ReactNode
  /** The exact resources the action will affect. Always shown to the user. */
  resources?: string[]
  confirmLabel: string
  destructive?: boolean
  /** When set, the user must type this text before confirming. */
  requireTyped?: string
  extra?: ReactNode
  onConfirm(): void | Promise<void>
}

/**
 * Destructive confirmation.
 *
 * Every destructive action lists the exact resources it will touch, and the
 * riskiest ones additionally require typing the resource name.
 */
export function ConfirmDialog({
  request,
  onClose
}: {
  request: ConfirmRequest | null
  onClose(): void
}): ReactElement | null {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  if (!request) return null
  const typedOk = !request.requireTyped || typed.trim() === request.requireTyped

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      await request.onConfirm()
      setTyped('')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setTyped('')
          onClose()
        }
      }}
      title={
        <span className="flex items-center gap-2">
          {request.destructive ? (
            <AlertTriangle className="size-4 text-danger" aria-hidden />
          ) : null}
          {request.title}
        </span>
      }
      description={request.description}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setTyped('')
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button
            variant={request.destructive ? 'danger' : 'primary'}
            disabled={!typedOk}
            loading={busy}
            onClick={() => void confirm()}
          >
            {request.confirmLabel}
          </Button>
        </>
      }
    >
      {request.resources && request.resources.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium text-ink-secondary">
            This affects {request.resources.length} resource
            {request.resources.length === 1 ? '' : 's'}:
          </p>
          <ul className="hl-scroll max-h-40 rounded-control border border-line bg-surface-2 p-2 font-mono text-[11px] text-ink-secondary">
            {request.resources.map((resource) => (
              <li key={resource} className="selectable truncate py-0.5">
                {resource}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {request.extra}

      {request.requireTyped ? (
        <label className="mt-3 block">
          <span className="text-xs text-ink-secondary">
            Type <code className="font-mono text-ink">{request.requireTyped}</code> to confirm
          </span>
          <input
            autoFocus
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="mt-1 h-8 w-full rounded-control border border-line bg-surface px-2.5 font-mono text-[13px] text-ink outline-none focus:border-danger focus:ring-2 focus:ring-danger/20"
          />
        </label>
      ) : null}
    </Dialog>
  )
}

/* ----------------------------------------------------------------- Drawer */

export function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  width = 'w-[420px]'
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
}): ReactElement {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            'fixed top-0 right-0 z-30 flex h-full flex-col border-l border-line bg-surface shadow-pop',
            'focus:outline-none',
            width
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-sm font-semibold text-ink">
                {title}
              </DialogPrimitive.Title>
              {subtitle ? <div className="mt-0.5 text-xs text-ink-muted">{subtitle}</div> : null}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close panel">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="hl-scroll flex-1">{children}</div>
          {footer ? <div className="border-t border-line px-4 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/* --------------------------------------------------------------- Dropdown */

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect?(): void
  destructive?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  shortcut?: string
}

export function DropdownMenu({
  trigger,
  items,
  align = 'end'
}: {
  trigger: ReactNode
  items: MenuItem[]
  align?: 'start' | 'center' | 'end'
}): ReactElement {
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-52 rounded-control border border-line bg-surface p-1 shadow-pop"
        >
          {items.map((item, index) => (
            <div key={`${item.label}-${index}`}>
              {item.separatorBefore ? (
                <DropdownPrimitive.Separator className="my-1 h-px bg-line" />
              ) : null}
              <DropdownPrimitive.Item
                disabled={item.disabled}
                onSelect={() => item.onSelect?.()}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none',
                  'data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
                  item.destructive ? 'text-danger-fg' : 'text-ink'
                )}
              >
                {item.icon ? <span className="text-ink-muted">{item.icon}</span> : null}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <span className="text-[11px] text-ink-muted">{item.shortcut}</span>
                ) : null}
              </DropdownPrimitive.Item>
            </div>
          ))}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  )
}

/* ------------------------------------------------------------------- Tabs */

export function Tabs({
  value,
  onValueChange,
  tabs,
  className,
  size = 'md'
}: {
  value: string
  onValueChange(value: string): void
  tabs: { value: string; label: ReactNode; badge?: ReactNode }[]
  className?: string
  size?: 'sm' | 'md'
}): ReactElement {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={className}>
      <TabsPrimitive.List className="flex items-center gap-4 border-b border-line">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              'relative -mb-px flex items-center gap-1.5 border-b-2 border-transparent font-medium transition-colors',
              size === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-[13px]',
              'text-ink-muted hover:text-ink-secondary',
              'data-[state=active]:border-brand data-[state=active]:text-ink'
            )}
          >
            {tab.label}
            {tab.badge}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}
