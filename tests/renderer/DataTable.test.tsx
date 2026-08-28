import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DataTable, type Column } from '@/components/ui/table'

interface Row {
  id: string
  name: string
  size: number
  group: string
}

const rows: Row[] = [
  { id: '1', name: 'redis', size: 30, group: 'fcs' },
  { id: '2', name: 'api', size: 200, group: 'fcs' },
  { id: '3', name: 'mailhog', size: 100, group: 'tools' }
]

const columns: Column<Row>[] = [
  { id: 'name', header: 'Name', sortValue: (row) => row.name, cell: (row) => row.name },
  {
    id: 'size',
    header: 'Size',
    align: 'right',
    sortValue: (row) => row.size,
    cell: (row) => String(row.size)
  },
  { id: 'group', header: 'Group', cell: (row) => row.group }
]

function names(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '')
    .filter((value) => value !== '')
}

function SelectableTable(): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  return (
    <>
      <span data-testid="count">{selected.size}</span>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        selection={{ selected, onChange: setSelected }}
      />
    </>
  )
}

describe('DataTable', () => {
  it('renders every row in source order until a sort is applied', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} />)
    expect(names()).toEqual(['redis', 'api', 'mailhog'])
  })

  it('sorts ascending on the first click and descending on the second', async () => {
    const user = userEvent.setup()
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} />)

    await user.click(screen.getByRole('button', { name: /name/i }))
    expect(names()).toEqual(['api', 'mailhog', 'redis'])

    await user.click(screen.getByRole('button', { name: /name/i }))
    expect(names()).toEqual(['redis', 'mailhog', 'api'])
  })

  it('sorts numeric columns numerically', async () => {
    const user = userEvent.setup()
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} />)
    await user.click(screen.getByRole('button', { name: /size/i }))
    expect(names()).toEqual(['redis', 'mailhog', 'api'])
  })

  it('does not make columns without a sortValue clickable', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} />)
    expect(screen.queryByRole('button', { name: /group/i })).toBeNull()
  })

  it('honours the default sort', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ columnId: 'name', direction: 'asc' }}
      />
    )
    expect(names()).toEqual(['api', 'mailhog', 'redis'])
  })

  it('groups rows under their group header', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        groupBy={{
          key: (row) => row.group,
          label: (key, groupRows) => `${key} (${groupRows.length})`
        }}
      />
    )
    expect(screen.getByText('fcs (2)')).toBeInTheDocument()
    expect(screen.getByText('tools (1)')).toBeInTheDocument()
  })

  it('selects a single row and then all rows', async () => {
    const user = userEvent.setup()
    render(<SelectableTable />)
    const checkboxes = screen.getAllByRole('checkbox')

    await user.click(checkboxes[1]!)
    expect(screen.getByTestId('count')).toHaveTextContent('1')

    await user.click(screen.getAllByRole('checkbox')[0]!)
    expect(screen.getByTestId('count')).toHaveTextContent('3')

    await user.click(screen.getAllByRole('checkbox')[0]!)
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('reports row clicks but not clicks on the selection checkbox', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={onRowClick}
        selection={{ selected: new Set(), onChange: () => undefined }}
      />
    )

    await user.click(screen.getByText('redis'))
    expect(onRowClick).toHaveBeenCalledWith(rows[0])

    await user.click(screen.getAllByRole('checkbox')[1]!)
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })

  it('shows the empty state only when there is nothing to render', () => {
    render(
      <DataTable
        rows={[]}
        columns={columns}
        rowKey={(row) => row.id}
        empty={<span>Nothing here</span>}
      />
    )
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('shows skeletons while loading an empty table', () => {
    const { container } = render(
      <DataTable
        rows={[]}
        columns={columns}
        rowKey={(row) => row.id}
        loading
        empty={<span>Nothing</span>}
      />
    )
    expect(screen.queryByText('Nothing')).toBeNull()
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
  })
})
