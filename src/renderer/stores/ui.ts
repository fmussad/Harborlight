import { create } from 'zustand'
import type { AppNotification } from '@shared/schemas/domain'

export const SECTIONS = [
  'overview',
  'containers',
  'compose',
  'images',
  'volumes',
  'networks',
  'registry',
  'settings'
] as const

export type Section = (typeof SECTIONS)[number]

export type ContainerView = 'list' | 'cards'
export type ContainerPanel = 'details' | 'logs' | 'terminal' | 'inspect' | 'stats'

interface UiState {
  section: Section
  params: Record<string, string>
  commandPaletteOpen: boolean
  selectedContainerId: string | null
  containerPanel: ContainerPanel
  containerView: ContainerView
  containerSearch: string
  containerStack: string
  containerStatus: string
  notifications: AppNotification[]
  navigate(section: Section, params?: Record<string, string>): void
  navigateToPath(path: string): void
  setCommandPalette(open: boolean): void
  selectContainer(id: string | null, panel?: ContainerPanel): void
  setContainerPanel(panel: ContainerPanel): void
  setContainerView(view: ContainerView): void
  setContainerSearch(value: string): void
  setContainerStack(value: string): void
  setContainerStatus(value: string): void
  pushNotification(notification: AppNotification): void
  dismissNotification(id: string): void
  clearNotifications(): void
}

const MAX_NOTIFICATIONS = 50

function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value)
}

/**
 * Local UI state.
 *
 * Harborlight is a single-window desktop app, so navigation is plain state
 * instead of a URL router; the tray still addresses views with paths such as
 * `/containers?panel=logs`.
 */
export const useUiStore = create<UiState>((set) => ({
  section: 'overview',
  params: {},
  commandPaletteOpen: false,
  selectedContainerId: null,
  containerPanel: 'details',
  containerView: 'list',
  containerSearch: '',
  containerStack: 'all',
  containerStatus: 'all',
  notifications: [],

  navigate: (section, params = {}) => set({ section, params }),

  navigateToPath: (path) => {
    const [rawSection = '', rawQuery = ''] = path.replace(/^\//, '').split('?')
    const section = isSection(rawSection) ? rawSection : 'overview'
    const params: Record<string, string> = {}
    for (const pair of rawQuery.split('&')) {
      if (!pair) continue
      const [key, value = ''] = pair.split('=')
      if (key) params[key] = decodeURIComponent(value)
    }
    set((state) => ({
      section,
      params,
      containerPanel:
        params.panel === 'logs' || params.panel === 'terminal'
          ? (params.panel as ContainerPanel)
          : state.containerPanel
    }))
  },

  setCommandPalette: (open) => set({ commandPaletteOpen: open }),

  selectContainer: (id, panel) =>
    set((state) => ({
      selectedContainerId: id,
      containerPanel: panel ?? (id === null ? state.containerPanel : state.containerPanel)
    })),

  setContainerPanel: (panel) => set({ containerPanel: panel }),
  setContainerView: (view) => set({ containerView: view }),
  setContainerSearch: (value) => set({ containerSearch: value }),
  setContainerStack: (value) => set({ containerStack: value }),
  setContainerStatus: (value) => set({ containerStatus: value }),

  pushNotification: (notification) =>
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS)
    })),

  dismissNotification: (id) =>
    set((state) => ({ notifications: state.notifications.filter((entry) => entry.id !== id) })),

  clearNotifications: () => set({ notifications: [] })
}))
