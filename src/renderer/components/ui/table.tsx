import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Checkbox, Skeleton } from './primitives'

export interface Column<T> {
  id: string
  header: ReactNode
  /** Tailwind width class, e.g. `w-40`. Omit for a flexible column. */
  width?: string
  align?: 'left' | 'right'
  cell(row: T): ReactNode
  /** Provide to make the column sortable. */
  sortValue?(row: T): string | number
  className?: string
}

interface TableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey(row: T): string
  loading?: boolean
  empty?: ReactNode
  onRowClick?(row: T): void
  isRowActive?(row: T): boolean
  selection?: {
    selected: Set<string>
    onChange(next: Set<string>): void
  }
  /** Groups rows under sticky headers, used for Compose stacks. */
  groupBy?: {
    key(row: T): string
    label(key: string, rows: T[]): ReactNode
  }
  defaultSort?: { columnId: string; direction: 'asc' | 'desc' }
  className?: string
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  isRowActive,
  selection,
  groupBy,
  defaultSort,
  className
}: TableProps<T>): ReactElement {
  const [sort, setSort] = useState<{ columnId: string; direction: 'asc' | 'desc' } | null>(
    defaultSort ?? null
  )

  const sorted = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((entry) => entry.id === sort.columnId)
    if (!column?.sortValue) return rows
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a)
      const right = column.sortValue!(b)
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * factor
    })
  }, [columns, rows, sort])

  const groups = useMemo(() => {
    if (!groupBy) return [{ key: '', rows: sorted }]
    const map = new Map<string, T[]>()
    for (const row of sorted) {
      const key = groupBy.key(row)
      const bucket = map.get(key) ?? []
      bucket.push(row)
      map.set(key, bucket)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, groupRows]) => ({ key, rows: groupRows }))
  }, [groupBy, sorted])

  const allKeys = useMemo(() => rows.map(rowKey), [rowKey, rows])
  const allSelected =
    Boolean(selection) && allKeys.length > 0 && allKeys.every((key) => selection!.selected.has(key))

  const toggleAll = (checked: boolean): void => {
    if (!selection) return
    selection.onChange(checked ? new Set(allKeys) : new Set())
  }

  const toggleRow = (key: string, checked: boolean): void => {
    if (!selection) return
    const next = new Set(selection.selected)
    if (checked) next.add(key)
    else next.delete(key)
    selection.onChange(next)
  }

  const columnCount = columns.length + (selection ? 1 : 0)

  return (
    <div className={cn('w-full', className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {selection ? (
              <th className="w-9 px-3 py-2">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              </th>
            ) : null}
            {columns.map((column) => {
              const sortable = Boolean(column.sortValue)
              const active = sort?.columnId === column.id
              return (
                <th
                  key={column.id}
                  scope="col"
                  className={cn(
                    'px-3 py-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase',
                    column.align === 'right' ? 'text-right' : 'text-left',
                    column.width
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort((current) =>
                          current?.columnId === column.id
                            ? {
                                columnId: column.id,
                                direction: current.direction === 'asc' ? 'desc' : 'asc'
                              }
                            : { columnId: column.id, direction: 'asc' }
                        )
                      }
                      className={cn(
                        'inline-flex items-center gap-1 hover:text-ink-secondary',
                        column.align === 'right' && 'flex-row-reverse',
                        active && 'text-ink-secondary'
                      )}
                    >
                      {column.header}
                      {active ? (
                        sort?.direction === 'asc' ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {loading && rows.length === 0
            ? Array.from({ length: 6 }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="border-b border-line">
                  {Array.from({ length: columnCount }).map((__, cellIndex) => (
                    <td key={`cell-${cellIndex}`} className="px-3 py-2.5">
                      <Skeleton className="h-3.5 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))
            : groups.map((group) => (
                <FragmentGroup
                  key={group.key || 'all'}
                  label={groupBy ? groupBy.label(group.key, group.rows) : null}
                  columnCount={columnCount}
                >
                  {group.rows.map((row) => {
                    const key = rowKey(row)
                    const active = isRowActive?.(row) ?? false
                    return (
                      <tr
                        key={key}
                        onClick={() => onRowClick?.(row)}
                        className={cn(
                          'border-b border-line transition-colors',
                          onRowClick && 'hl-row-hover cursor-pointer',
                          active && 'bg-accent-soft/60'
                        )}
                      >
                        {selection ? (
                          <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                            <Checkbox
                              checked={selection.selected.has(key)}
                              onCheckedChange={(checked) => toggleRow(key, checked)}
                            />
                          </td>
                        ) : null}
                        {columns.map((column) => (
                          <td
                            key={column.id}
                            className={cn(
                              'px-3 py-2.5 text-ink-secondary',
                              column.align === 'right' && 'text-right',
                              column.className
                            )}
                          >
                            {column.cell(row)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </FragmentGroup>
              ))}
        </tbody>
      </table>

      {!loading && rows.length === 0 ? empty : null}
    </div>
  )
}

function FragmentGroup({
  label,
  columnCount,
  children
}: {
  label: ReactNode
  columnCount: number
  children: ReactNode
}): ReactElement {
  return (
    <>
      {label ? (
        <tr className="bg-surface-2">
          <td colSpan={columnCount} className="px-3 py-1.5 text-xs font-medium text-ink-secondary">
            {label}
          </td>
        </tr>
      ) : null}
      {children}
    </>
  )
}

/** Page-level chrome shared by every section. */
export function PageHeader({
  title,
  description,
  actions,
  children
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}): ReactElement {
  return (
    <div className="border-b border-line bg-surface px-5 pt-4 pb-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}
