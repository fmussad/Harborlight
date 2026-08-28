import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CleanupPlan } from '@shared/schemas/domain'
import { CleanupCard } from '@/components/images/CleanupCard'
import { installFakeTransport, renderWithProviders, type FakeTransport } from './testUtils'

const GB = 1024 ** 3

const PLAN: CleanupPlan = {
  generatedAt: '2026-05-16T18:32:00.000Z',
  totalReclaimable: Math.round(2.2 * GB),
  categories: [
    {
      category: 'danglingImages',
      title: 'Dangling images',
      description: 'Untagged layers left behind by rebuilds.',
      dangerous: false,
      defaultSelected: true,
      reclaimable: Math.round(1.2 * GB),
      items: [
        { id: 'sha256:aaa', label: '<none>:<none>', detail: 'aaa', size: Math.round(1.2 * GB) }
      ]
    },
    {
      category: 'stoppedContainers',
      title: 'Stopped containers',
      description: 'Containers that are not running.',
      dangerous: false,
      defaultSelected: true,
      reclaimable: GB,
      items: [{ id: 'c1', label: 'adminer', detail: 'adminer:4.8.1', size: GB }]
    },
    {
      category: 'unusedVolumes',
      title: 'Unused volumes',
      description: 'Volume data is deleted permanently.',
      dangerous: true,
      defaultSelected: false,
      reclaimable: 5 * GB,
      items: [{ id: 'orphan_data', label: 'orphan_data', detail: 'local', size: 5 * GB }]
    },
    {
      category: 'unusedNetworks',
      title: 'Unused networks',
      description: 'User-defined networks with nothing attached.',
      dangerous: false,
      defaultSelected: true,
      reclaimable: 0,
      items: []
    }
  ]
}

let transport: FakeTransport

beforeEach(() => {
  transport = installFakeTransport({
    'cleanup.analyze': async () => PLAN,
    'cleanup.run': async (payload) => {
      const { categories, dryRun } = payload as { categories: string[]; dryRun: boolean }
      return {
        dryRun,
        startedAt: '2026-05-16T18:33:00.000Z',
        finishedAt: '2026-05-16T18:33:02.000Z',
        reclaimed: dryRun ? 0 : Math.round(2.2 * GB),
        entries: categories.map((category) => ({
          category: category as never,
          status: dryRun ? ('skipped' as const) : ('succeeded' as const),
          message: dryRun ? 'Dry run.' : 'Removed.',
          reclaimed: 0,
          removed: []
        }))
      }
    }
  })
})

function runCalls(): { categories: string[]; dryRun: boolean }[] {
  return transport.calls
    .filter((call) => call.command === 'cleanup.run')
    .map((call) => call.payload as { categories: string[]; dryRun: boolean })
}

describe('CleanupCard', () => {
  it('preselects safe waste and leaves data-destroying categories untouched', async () => {
    renderWithProviders(<CleanupCard />)
    await screen.findByText('Dangling images')

    expect(screen.getByRole('checkbox', { name: /Dangling images/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Stopped containers/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Unused volumes/ })).not.toBeChecked()
  })

  it('marks the volumes category as data loss', async () => {
    renderWithProviders(<CleanupCard />)
    await screen.findByText('Unused volumes')
    expect(screen.getByText('data loss')).toBeInTheDocument()
  })

  it('does not preselect a category with nothing to reclaim', async () => {
    renderWithProviders(<CleanupCard />)
    await screen.findByText('Unused networks')
    expect(screen.getByRole('checkbox', { name: /Unused networks/ })).toBeDisabled()
  })

  it('totals only the selected categories', async () => {
    const { user } = renderWithProviders(<CleanupCard />)
    await screen.findByText('Dangling images')

    expect(screen.getByRole('button', { name: /Clean up 2\.2 GB/ })).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Stopped containers/ }))
    expect(screen.getByRole('button', { name: /Clean up 1\.2 GB/ })).toBeInTheDocument()
  })

  it('runs a dry run without asking for confirmation', async () => {
    const { user } = renderWithProviders(<CleanupCard />)
    await screen.findByText('Dangling images')

    await user.click(screen.getByRole('button', { name: 'Dry run' }))
    await waitFor(() => expect(runCalls()).toHaveLength(1))
    expect(runCalls()[0]).toMatchObject({ dryRun: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('confirms a real cleanup and lists what will be removed', async () => {
    const { user } = renderWithProviders(<CleanupCard />)
    await screen.findByText('Dangling images')

    await user.click(screen.getByRole('button', { name: /Clean up 2\.2 GB/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Dangling images: <none>:<none>')
    expect(dialog).toHaveTextContent('Stopped containers: adminer')
    expect(runCalls()).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: /Clean up 2\.2 GB/ }))
    await waitFor(() => expect(runCalls()).toHaveLength(1))
    expect(runCalls()[0]).toEqual({
      categories: ['danglingImages', 'stoppedContainers'],
      dryRun: false
    })
  })

  it('requires typing "delete volumes" before deleting volume data', async () => {
    const { user } = renderWithProviders(<CleanupCard />)
    await screen.findByText('Unused volumes')

    await user.click(screen.getByRole('checkbox', { name: /Unused volumes/ }))
    await user.click(screen.getByRole('button', { name: /Clean up 7\.2 GB/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('cannot be recovered')
    const confirmButton = within(dialog).getByRole('button', { name: /Clean up 7\.2 GB/ })
    expect(confirmButton).toBeDisabled()

    await user.type(within(dialog).getByRole('textbox'), 'delete volumes')
    expect(confirmButton).toBeEnabled()
  })
})
