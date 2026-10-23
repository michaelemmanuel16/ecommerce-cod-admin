import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Table, type Column } from '../../../components/ui-v2';

interface Row { id: number; name: string; amount: string }
const rows: Row[] = [{ id: 1, name: 'Abena Owusu', amount: 'GH₵249.00' }, { id: 2, name: 'Kofi Mensah', amount: 'GH₵449.00' }];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Customer', render: (r) => r.name },
  { key: 'amount', header: 'Amount', right: true, render: (r) => r.amount },
];

describe('ui-v2 Table', () => {
  it('renders headers, rows and the scroll wrapper', () => {
    const { container } = render(<Table label="Orders" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(container.firstChild).toHaveClass('tablewrap');
    expect(screen.getByRole('table', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveClass('r');
    expect(screen.getByText('Abena Owusu')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
  it('rows are not focusable without onRowClick', () => {
    render(<Table label="Orders" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getAllByRole('row')[1]).not.toHaveAttribute('tabindex');
  });
  it('opens a row with click, Enter and Space', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<Table label="Orders" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    const row = screen.getAllByRole('row')[1];
    await user.click(row);
    row.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onRowClick).toHaveBeenCalledTimes(3);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
