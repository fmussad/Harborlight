import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ContainerActions } from '@/components/containers/ContainerActions'
import {
  installFakeTransport,
  renderWithProviders,
  resetUiStore,
  TEST_SETTINGS,
  type FakeTransport
} from './testUtils'

const RUNNING = { id: 'aaa', name: 'fcs-api', state: 'running' as const }
const STOPPED = { id: 'bbb', name: 'adminer', state: 'exited' as const }

let transport: FakeTransport

function setup(confirmDestructive = true): void {
  transport = installFakeTransport({
    'settings.get': async () => ({ ...TEST_SETTINGS, confirmDestructive }),
    'containers.stop': async () => ({ ok: true, message: 'stopped' }),
    'containers.start': async () => ({ ok: true, message: 'started' }),
    'containers.restart': async () => ({ ok: true, message: 'restarted' }),
    'containers.kill': async () => ({ ok: true, message: 'killed' }),
    'containers.remove': async () => ({ ok: true, message: 'removed' }),
    'containers.rename': async () => ({ ok: true, message: 'renamed' })
  })
}

beforeEach(() => setup())
afterEach(() => resetUiStore())

function calls(command: string): { command: string; payload: unknown }[] {
  return transport.calls.filter((call) => call.command === command)
}

describe('ContainerActions toolbar', () => {
  it('enables Stop and Restart only for running containers', () => {
    renderWithProviders(<ContainerActions containers={[STOPPED]} layout="toolbar" />)
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Restart' })).toBeDisabled()
  })

  it('stops without a confirmation because stopping is reversible', async () => {
    const { user } = renderWithProviders(
      <ContainerActions containers={[RUNNING]} layout="toolbar" />
    )
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(calls('containers.stop')).toHaveLength(1))
    expect(calls('containers.stop')[0]?.payload).toEqual({ id: 'aaa' })
  })

  it('applies an action to every selected container', async () => {
    const { user } = renderWithProviders(
      <ContainerActions
        containers={[RUNNING, { id: 'ccc', name: 'fcs-ui', state: 'running' }]}
        layout="toolbar"
      />
    )
    await user.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(calls('containers.restart')).toHaveLength(2))
  })
})

describe('destructive confirmations', () => {
  it('asks before killing and names the container', async () => {
    const { user } = renderWithProviders(
      <ContainerActions containers={[RUNNING]} layout="toolbar" />
    )
    await user.click(screen.getByRole('button', { name: /more/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Kill/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Kill fcs-api?')
    expect(dialog).toHaveTextContent('fcs-api')
    expect(calls('containers.kill')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Send SIGKILL' }))
    await waitFor(() => expect(calls('containers.kill')).toHaveLength(1))
    expect(calls('containers.kill')[0]?.payload).toEqual({ id: 'aaa', signal: 'SIGKILL' })
  })

  it('cancels without touching Docker', async () => {
    const { user } = renderWithProviders(
      <ContainerActions containers={[RUNNING]} layout="toolbar" />
    )
    await user.click(screen.getByRole('button', { name: /more/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Kill/ }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls('containers.kill')).toHaveLength(0)
  })

  it('requires typing the name before force-removing a running container', async () => {
    const { user } = renderWithProviders(
      <ContainerActions containers={[RUNNING]} layout="toolbar" />
    )
    await user.click(screen.getByRole('button', { name: /more/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Remove/ }))

    const confirmButton = await screen.findByRole('button', { name: 'Force remove' })
    expect(confirmButton).toBeDisabled()

    await user.type(screen.getByRole('textbox'), 'fcs-api')
    expect(confirmButton).toBeEnabled()

    await user.click(confirmButton)
    await waitFor(() => expect(calls('containers.remove')).toHaveLength(1))
    expect(calls('containers.remove')[0]?.payload).toMatchObject({ id: 'aaa', force: true })
  })

  it('does not require typing for a stopped container', async () => {
    const { user } = renderWithProviders(
      <ContainerActions containers={[STOPPED]} layout="toolbar" />
    )
    await user.click(screen.getByRole('button', { name: /more/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Remove/ }))

    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls('containers.remove')).toHaveLength(1))
    expect(calls('containers.remove')[0]?.payload).toMatchObject({ force: false })
  })

  it('skips the dialog when the user turned confirmations off', async () => {
    setup(false)
    const { user } = renderWithProviders(
      <ContainerActions containers={[RUNNING]} layout="toolbar" />
    )
    await screen.findByRole('button', { name: /more/i })
    await user.click(screen.getByRole('button', { name: /more/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Kill/ }))

    await waitFor(() => expect(calls('containers.kill')).toHaveLength(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('rename', () => {
  it('sends the new name and refuses an unchanged one', async () => {
    const { user } = renderWithProviders(
      <ContainerActions containers={[RUNNING]} layout="toolbar" />
    )
    await user.click(screen.getByRole('button', { name: /more/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }))

    const input = await screen.findByLabelText('New container name')
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'fcs-api-2')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => expect(calls('containers.rename')).toHaveLength(1))
    expect(calls('containers.rename')[0]?.payload).toEqual({ id: 'aaa', name: 'fcs-api-2' })
  })
})
