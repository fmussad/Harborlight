import { useState, type ReactElement } from 'react'
import { Bell, Check, Search, Settings as SettingsIcon, SquareTerminal, Trash2 } from 'lucide-react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { formatRelativeTime } from '@shared/utils/format'
import { cn } from '@/lib/cn'
import { useUiStore } from '@/stores/ui'
import { Badge, Button, Kbd, Tooltip } from '@/components/ui/primitives'

function NotificationsPopover(): ReactElement {
  const [open, setOpen] = useState(false)
  const notifications = useUiStore((state) => state.notifications)
  const dismiss = useUiStore((state) => state.dismissNotification)
  const clear = useUiStore((state) => state.clearNotifications)

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`Notifications (${notifications.length})`}
          className="relative flex size-8 items-center justify-center rounded-control text-ink-secondary hover:bg-surface-2 hover:text-ink"
        >
          <Bell className="size-4" />
          {notifications.length > 0 ? (
            <span
              className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-brand"
              aria-hidden
            />
          ) : null}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[360px] rounded-card border border-line bg-surface shadow-pop"
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[13px] font-semibold text-ink">Notifications</span>
            {notifications.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 className="size-3.5" />}
                onClick={clear}
              >
                Clear all
              </Button>
            ) : null}
          </div>
          <div className="hl-scroll max-h-96">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
                <Check className="size-5 text-ink-muted" aria-hidden />
                <p className="text-xs text-ink-muted">You are all caught up.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {notifications.map((notification) => (
                  <li key={notification.id} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium text-ink">{notification.title}</span>
                      <button
                        type="button"
                        aria-label="Dismiss notification"
                        onClick={() => dismiss(notification.id)}
                        className="text-[11px] text-ink-muted hover:text-ink"
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="selectable mt-0.5 text-xs break-words text-ink-secondary">
                      {notification.message}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge
                        tone={
                          notification.level === 'error'
                            ? 'danger'
                            : notification.level === 'warning'
                              ? 'warning'
                              : notification.level === 'success'
                                ? 'success'
                                : 'neutral'
                        }
                      >
                        {notification.level}
                      </Badge>
                      <span className="text-[11px] text-ink-muted">
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export function TopBar({ className }: { className?: string }): ReactElement {
  const setCommandPalette = useUiStore((state) => state.setCommandPalette)
  const navigate = useUiStore((state) => state.navigate)
  const selectContainer = useUiStore((state) => state.selectContainer)
  const selectedContainerId = useUiStore((state) => state.selectedContainerId)

  return (
    <header
      className={cn(
        'flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4',
        className
      )}
    >
      <button
        type="button"
        onClick={() => setCommandPalette(true)}
        className="flex h-8 max-w-xl flex-1 items-center gap-2 rounded-control border border-line bg-surface-2 px-2.5 text-left text-[13px] text-ink-muted transition-colors hover:border-line-strong"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Search containers, images, actions…</span>
        <Kbd>Ctrl+K</Kbd>
      </button>

      <div className="ml-auto flex items-center gap-0.5">
        <Tooltip content="Open a terminal in the selected container">
          <button
            type="button"
            aria-label="Open terminal"
            onClick={() => {
              navigate('containers')
              selectContainer(selectedContainerId, 'terminal')
            }}
            className="flex size-8 items-center justify-center rounded-control text-ink-secondary hover:bg-surface-2 hover:text-ink"
          >
            <SquareTerminal className="size-4" />
          </button>
        </Tooltip>

        <NotificationsPopover />

        <Tooltip content="Settings">
          <button
            type="button"
            aria-label="Settings"
            onClick={() => navigate('settings')}
            className="flex size-8 items-center justify-center rounded-control text-ink-secondary hover:bg-surface-2 hover:text-ink"
          >
            <SettingsIcon className="size-4" />
          </button>
        </Tooltip>
      </div>
    </header>
  )
}
