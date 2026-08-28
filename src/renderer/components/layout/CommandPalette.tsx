import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Boxes,
  CornerDownLeft,
  Database,
  Gauge,
  Layers,
  Moon,
  Network,
  Play,
  RefreshCw,
  ScrollText,
  Server,
  Settings as SettingsIcon,
  Square,
  SquareStack,
  SquareTerminal,
  Sun
} from 'lucide-react'
import { shortenId } from '@shared/utils/format'
import { cn } from '@/lib/cn'
import { invoke } from '@/lib/bridge'
import { queryKeys, useContainers, useImages, useSettings } from '@/lib/queries'
import { useUiStore, type Section } from '@/stores/ui'
import { Kbd } from '@/components/ui/primitives'
import { useToast } from '@/providers/ToastProvider'
import { useQueryClient } from '@tanstack/react-query'

interface Command {
  id: string
  label: string
  hint?: string
  group: 'Navigation' | 'Containers' | 'Images' | 'Actions'
  icon: ReactNode
  keywords?: string
  run(): void | Promise<void>
}

const NAV_ITEMS: { section: Section; label: string; icon: ReactNode }[] = [
  { section: 'overview', label: 'Overview', icon: <Gauge className="size-4" /> },
  { section: 'containers', label: 'Containers', icon: <Boxes className="size-4" /> },
  { section: 'compose', label: 'Compose', icon: <SquareStack className="size-4" /> },
  { section: 'images', label: 'Images', icon: <Layers className="size-4" /> },
  { section: 'volumes', label: 'Volumes', icon: <Database className="size-4" /> },
  { section: 'networks', label: 'Networks', icon: <Network className="size-4" /> },
  { section: 'registry', label: 'Registry', icon: <Server className="size-4" /> },
  { section: 'settings', label: 'Settings', icon: <SettingsIcon className="size-4" /> }
]

/**
 * Ctrl+K palette.
 *
 * It is a launcher, not a shortcut for destructive work: it navigates, starts
 * and stops containers, and opens logs or a terminal. Removals always go
 * through the confirmation dialogs on their pages.
 */
export function CommandPalette(): ReactElement {
  const open = useUiStore((state) => state.commandPaletteOpen)
  const setOpen = useUiStore((state) => state.setCommandPalette)
  const navigate = useUiStore((state) => state.navigate)
  const selectContainer = useUiStore((state) => state.selectContainer)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: containers = [] } = useContainers(open ? 5000 : false, open)
  const { data: images = [] } = useImages(false)
  const { data: settings } = useSettings()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  const close = (): void => {
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
  }

  const commands = ((): Command[] => {
    const list: Command[] = NAV_ITEMS.map((item) => ({
      id: `nav-${item.section}`,
      label: `Go to ${item.label}`,
      group: 'Navigation',
      icon: item.icon,
      keywords: item.section,
      run: () => {
        navigate(item.section)
        close()
      }
    }))

    list.push(
      {
        id: 'action-refresh',
        label: 'Refresh all data',
        group: 'Actions',
        icon: <RefreshCw className="size-4" />,
        run: () => {
          void client.invalidateQueries()
          close()
        }
      },
      {
        id: 'action-theme',
        label: settings?.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        icon: settings?.theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />,
        keywords: 'theme appearance dark light',
        run: async () => {
          close()
          try {
            const next = await invoke('settings.setTheme', {
              theme: settings?.theme === 'dark' ? 'light' : 'dark'
            })
            client.setQueryData(queryKeys.settings, next)
          } catch (error) {
            toastError(error, 'Could not change the theme')
          }
        }
      }
    )

    for (const container of containers.slice(0, 60)) {
      const running = container.state === 'running'
      list.push({
        id: `container-${container.id}`,
        label: container.name,
        hint: `${container.image} · ${shortenId(container.id, 12)}`,
        group: 'Containers',
        icon: <Boxes className="size-4" />,
        keywords: `${container.image} ${container.id} ${container.composeProject ?? ''}`,
        run: () => {
          navigate('containers')
          selectContainer(container.id, 'details')
          close()
        }
      })
      list.push({
        id: `container-logs-${container.id}`,
        label: `Logs: ${container.name}`,
        group: 'Containers',
        icon: <ScrollText className="size-4" />,
        keywords: `logs ${container.name}`,
        run: () => {
          navigate('containers')
          selectContainer(container.id, 'logs')
          close()
        }
      })
      if (running) {
        list.push({
          id: `container-term-${container.id}`,
          label: `Terminal: ${container.name}`,
          group: 'Containers',
          icon: <SquareTerminal className="size-4" />,
          keywords: `exec shell ${container.name}`,
          run: () => {
            navigate('containers')
            selectContainer(container.id, 'terminal')
            close()
          }
        })
      }
      list.push({
        id: `container-toggle-${container.id}`,
        label: `${running ? 'Stop' : 'Start'}: ${container.name}`,
        group: 'Containers',
        icon: running ? <Square className="size-4" /> : <Play className="size-4" />,
        keywords: `${running ? 'stop' : 'start'} ${container.name}`,
        run: async () => {
          close()
          try {
            if (running) {
              await invoke('containers.stop', { id: container.id })
            } else {
              await invoke('containers.start', { id: container.id })
            }
            await client.invalidateQueries({ queryKey: queryKeys.containers })
            toast({
              level: 'success',
              title: `${running ? 'Stopped' : 'Started'} ${container.name}`
            })
          } catch (error) {
            toastError(error, `Could not ${running ? 'stop' : 'start'} ${container.name}`)
          }
        }
      })
    }

    for (const image of images.slice(0, 40)) {
      const name = image.repoTags[0] ?? shortenId(image.id.replace('sha256:', ''), 12)
      list.push({
        id: `image-${image.id}`,
        label: name,
        hint: 'Show in Images',
        group: 'Images',
        icon: <Layers className="size-4" />,
        keywords: image.repoTags.join(' '),
        run: () => {
          navigate('images', { image: image.id })
          close()
        }
      })
    }

    return list
  })()

  const needle = query.trim().toLowerCase()
  const filtered = (
    needle
      ? commands.filter((command) =>
          `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''}`
            .toLowerCase()
            .includes(needle)
        )
      : commands.filter((command) => command.group === 'Navigation' || command.group === 'Actions')
  ).slice(0, 40)

  const groups = ((): [string, Command[]][] => {
    const map = new Map<string, Command[]>()
    for (const command of filtered) {
      const bucket = map.get(command.group) ?? []
      bucket.push(command)
      map.set(command.group, bucket)
    }
    return [...map.entries()]
  })()

  const activeCommandIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0))

  const runActive = (): void => {
    const command = filtered[activeCommandIndex]
    if (command) void command.run()
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true)
        else close()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-[14vh] left-1/2 z-50 w-[620px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-card border border-line bg-surface shadow-pop"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex(Math.min(activeCommandIndex + 1, filtered.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex(Math.max(activeCommandIndex - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              runActive()
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex items-center gap-2.5 border-b border-line px-3.5">
            <Gauge className="size-4 shrink-0 text-ink-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              placeholder="Search containers, images, actions…"
              aria-label="Command palette"
              className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            />
            <Kbd>Esc</Kbd>
          </div>

          <div className="hl-scroll max-h-[52vh] p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-ink-muted">
                No matches for “{query}”.
              </p>
            ) : (
              groups.map(([group, items]) => (
                <div key={group} className="mb-1">
                  <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                    {group}
                  </p>
                  {items.map((command) => {
                    const index = filtered.indexOf(command)
                    const active = index === activeCommandIndex
                    return (
                      <button
                        key={command.id}
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => void command.run()}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px]',
                          active ? 'bg-surface-2 text-ink' : 'text-ink-secondary'
                        )}
                      >
                        <span className="text-ink-muted">{command.icon}</span>
                        <span className="flex-1 truncate">{command.label}</span>
                        {command.hint ? (
                          <span className="truncate text-[11px] text-ink-muted">
                            {command.hint}
                          </span>
                        ) : null}
                        {active ? (
                          <CornerDownLeft className="size-3.5 text-ink-muted" aria-hidden />
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
