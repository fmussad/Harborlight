import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineStatus } from '@shared/schemas/domain'
import { mockContainers } from '@shared/mock/fixtures'
import { ContainersPage } from '@/pages/ContainersPage'
import {
  installFakeTransport,
  renderWithProviders,
  resetUiStore,
  TEST_ENGINE_STATUS,
  TEST_SETTINGS
} from './testUtils'

const CONTAINERS = mockContainers()

function setup(options: { containers?: typeof CONTAINERS; status?: EngineStatus } = {}): void {
  installFakeTransport({
    'settings.get': async () => TEST_SETTINGS,
    'engine.getStatus': async () => options.status ?? TEST_ENGINE_STATUS,
    'containers.list': async () => options.containers ?? CONTAINERS,
    'containers.inspect': async () => {
      throw new Error('not needed')
    }
  })
}

function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table')
  return within(table)
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('cell').length > 1)
}

function rowNames(): string[] {
  return bodyRows().map(
    (row) => within(row).getAllByRole('cell')[1]?.querySelector('span')?.textContent?.trim() ?? ''
  )
}

beforeEach(() => {
  resetUiStore()
  setup()
})

afterEach(() => resetUiStore())

describe('ContainersPage', () => {
  it('lists every container returned by the engine', async () => {
    renderWithProviders(<ContainersPage />)
    expect(await screen.findByText('fcs-api')).toBeInTheDocument()
    expect(rowNames()).toHaveLength(CONTAINERS.length)
  })

  it('summarises the running count in the header', async () => {
    renderWithProviders(<ContainersPage />)
    const running = CONTAINERS.filter((container) => container.state === 'running').length
    expect(
      await screen.findByText(`${CONTAINERS.length} containers · ${running} running`)
    ).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`${CONTAINERS.length} ${CONTAINERS.length}`))).toBeNull()
  })

  it('groups containers by their Compose stack', async () => {
    renderWithProviders(<ContainersPage />)
    await screen.findByText('fcs-api')

    const table = within(screen.getByRole('table'))
    expect(table.getByText('fcs')).toBeInTheDocument()
    expect(table.getByText('observability')).toBeInTheDocument()
    expect(table.getByText('tools')).toBeInTheDocument()
  })

  it('filters by the search box across name and image', async () => {
    const { user } = renderWithProviders(<ContainersPage />)
    await screen.findByText('fcs-api')

    await user.type(screen.getByLabelText('Search containers'), 'redis')
    expect(rowNames()).toEqual(['redis'])

    await user.clear(screen.getByLabelText('Search containers'))
    await user.type(screen.getByLabelText('Search containers'), 'mariadb:11.3')
    expect(rowNames()).toEqual(['mariadb'])
  })

  it('filters by status', async () => {
    const { user } = renderWithProviders(<ContainersPage />)
    await screen.findByText('fcs-api')

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'exited')
    expect(rowNames()).toEqual(['adminer'])

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'all')
    expect(rowNames()).toHaveLength(CONTAINERS.length)
  })

  it('filters by stack', async () => {
    const { user } = renderWithProviders(<ContainersPage />)
    await screen.findByText('fcs-api')

    await user.selectOptions(screen.getByLabelText('Filter by stack'), 'tools')
    expect(rowNames().sort()).toEqual(['adminer', 'mailhog'])
  })

  it('explains an empty list differently when Docker is unreachable', async () => {
    setup({
      containers: [],
      status: {
        ...TEST_ENGINE_STATUS,
        connected: false,
        error: 'Cannot connect to the Docker daemon.',
        errorHint: 'Start it with: sudo systemctl start docker'
      }
    })
    renderWithProviders(<ContainersPage />)

    expect(await screen.findByText('Not connected to Docker')).toBeInTheDocument()
    expect(screen.getByText('Start it with: sudo systemctl start docker')).toBeInTheDocument()
  })

  it('offers to run a container when the engine is connected but empty', async () => {
    setup({ containers: [] })
    renderWithProviders(<ContainersPage />)

    expect(await screen.findByText('No containers yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run a container' })).toBeInTheDocument()
  })

  it('says the filters are too narrow when the engine has containers', async () => {
    const { user } = renderWithProviders(<ContainersPage />)
    await screen.findByText('fcs-api')

    await user.type(screen.getByLabelText('Search containers'), 'nothing-matches-this')
    expect(screen.getByText('No containers match the filters')).toBeInTheDocument()
  })

  it('switches to the card view', async () => {
    const { user } = renderWithProviders(<ContainersPage />)
    await screen.findByText('fcs-api')

    await user.click(screen.getByTitle('Card view'))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('fcs-api')).toBeInTheDocument()
  })

  it('shows the selection count when rows are ticked', async () => {
    const { user } = renderWithProviders(<ContainersPage />)
    await screen.findByText('fcs-api')

    const checkbox = within(bodyRows()[0]!).getByRole('checkbox')
    await user.click(checkbox)
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })
})
