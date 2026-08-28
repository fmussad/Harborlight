import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockContainers, mockImages } from '@shared/mock/fixtures'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { useUiStore } from '@/stores/ui'
import {
  installFakeTransport,
  renderWithProviders,
  resetUiStore,
  TEST_SETTINGS,
  type FakeTransport
} from './testUtils'

/**
 * The palette is the keyboard path through the whole app, so these tests drive
 * it the way a user does: Ctrl+K, type, arrow, Enter.
 */

const CONTAINERS = mockContainers()
const RUNNING = CONTAINERS.find((container) => container.state === 'running')!
const STOPPED = CONTAINERS.find((container) => container.state === 'exited')!

let transport: FakeTransport

function setup(theme: 'light' | 'dark' | 'system' = 'system'): void {
  transport = installFakeTransport({
    'settings.get': async () => ({ ...TEST_SETTINGS, theme }),
    'settings.setTheme': async (payload) => ({
      ...TEST_SETTINGS,
      theme: (payload as { theme: 'light' | 'dark' }).theme
    }),
    'containers.list': async () => CONTAINERS,
    'images.list': async () => mockImages(),
    'containers.start': async () => ({ ok: true, message: 'started' }),
    'containers.stop': async () => ({ ok: true, message: 'stopped' })
  })
}

/** Opens the palette the same way the user does. */
async function open(user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> {
  await user.keyboard('{Control>}k{/Control}')
  return screen.findByRole('dialog')
}

function searchBox(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Command palette' })
}

function optionLabels(): string[] {
  return within(screen.getByRole('dialog'))
    .getAllByRole('button')
    .map((button) => button.querySelector('span:nth-of-type(2)')?.textContent?.trim() ?? '')
}

function calls(command: string): { command: string; payload: unknown }[] {
  return transport.calls.filter((call) => call.command === command)
}

beforeEach(() => {
  resetUiStore()
  setup()
})

afterEach(() => resetUiStore())

describe('opening and closing', () => {
  it('opens on Ctrl+K and closes on Escape', async () => {
    const { user } = renderWithProviders(<CommandPalette />)

    await open(user)
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows navigation and actions before anything is typed', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    const labels = optionLabels()
    expect(labels).toContain('Go to Containers')
    expect(labels).toContain('Refresh all data')
    // Containers are only listed once the user searches for them.
    expect(labels).not.toContain(RUNNING.name)
  })
})

describe('searching', () => {
  it('finds a container by name', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), RUNNING.name)

    await waitFor(() => expect(optionLabels()).toContain(RUNNING.name))
  })

  it('finds a container by image, not just by name', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), RUNNING.image)

    await waitFor(() => expect(optionLabels()).toContain(RUNNING.name))
  })

  it('says so when nothing matches', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), 'zzzznope')

    expect(await screen.findByText(/No matches for/)).toBeInTheDocument()
  })
})

describe('running a command', () => {
  it('navigates with the keyboard alone', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), 'volumes')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(useUiStore.getState().section).toBe('volumes'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('moves the selection with the arrow keys', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    // The navigation entries keep sidebar order, so the second one is Containers.
    await user.type(searchBox(), 'Go to')
    await waitFor(() =>
      expect(optionLabels().slice(0, 2)).toEqual(['Go to Overview', 'Go to Containers'])
    )
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(useUiStore.getState().section).toBe('containers'))
  })

  it('runs the first match on Enter without any arrow keys', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), 'Go to')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(useUiStore.getState().section).toBe('overview'))
  })

  it('opens a container straight into its logs', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), `Logs: ${RUNNING.name}`)
    await user.keyboard('{Enter}')

    await waitFor(() => {
      const state = useUiStore.getState()
      expect(state.section).toBe('containers')
      expect(state.selectedContainerId).toBe(RUNNING.id)
      expect(state.containerPanel).toBe('logs')
    })
  })

  it('starts a stopped container', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), `Start: ${STOPPED.name}`)
    await user.keyboard('{Enter}')

    await waitFor(() => expect(calls('containers.start')).toHaveLength(1))
    expect(calls('containers.start')[0]?.payload).toMatchObject({ id: STOPPED.id })
    expect(calls('containers.stop')).toHaveLength(0)
  })

  it('offers Stop, not Start, for a running container', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), RUNNING.name)

    await waitFor(() => expect(optionLabels()).toContain(`Stop: ${RUNNING.name}`))
    expect(optionLabels()).not.toContain(`Start: ${RUNNING.name}`)
  })

  it('toggles the theme through the settings command', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), 'theme')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(calls('settings.setTheme')).toHaveLength(1))
    expect(calls('settings.setTheme')[0]?.payload).toMatchObject({ theme: 'dark' })
  })

  it('switches back to light when the dark theme is active', async () => {
    setup('dark')
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), 'theme')
    await waitFor(() => expect(optionLabels()).toContain('Switch to light theme'))
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(calls('settings.setTheme')[0]?.payload).toMatchObject({ theme: 'light' })
    )
  })

  it('never offers a removal', async () => {
    const { user } = renderWithProviders(<CommandPalette />)
    await open(user)

    await user.type(searchBox(), 'remove')

    expect(await screen.findByText(/No matches for/)).toBeInTheDocument()
  })
})
