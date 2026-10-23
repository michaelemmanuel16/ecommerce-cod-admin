import type { KeyboardEvent, ReactNode } from 'react';
import clsx from 'clsx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-aligned column (.r), for amounts. */
  right?: boolean;
  width?: string | number;
  /** The cell of the total row (<tfoot>). The row shows when any column sets one. */
  total?: ReactNode;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Makes rows clickable: mouse, Enter and Space. */
  onRowClick?: (row: T) => void;
  /** Accessible name for the table. */
  label: string;
  className?: string;
}

/** .tablewrap > table: the scroll wrapper under 760px, header row, hover rows. */
export function Table<T>({ columns, rows, rowKey, onRowClick, label, className }: TableProps<T>) {
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick?.(row);
    }
  };
  return (
    <div className="tablewrap">
      <table aria-label={label} className={className}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={clsx(c.right && 'r')} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={clsx(onRowClick && 'orow')}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={clsx(c.right && 'r')}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {columns.some((c) => c.total !== undefined) && (
          <tfoot>
            <tr className="tot">
              {columns.map((c) => (
                <td key={c.key} className={clsx(c.right && 'r')}>
                  {c.total}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
