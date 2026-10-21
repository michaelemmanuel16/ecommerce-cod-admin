import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination } from '../../../components/ui-v2';

describe('ui-v2 Pagination', () => {
  it('shows "Showing 25 of 1,445 orders" with thousands separators', () => {
    render(<Pagination page={1} pageSize={25} total={1445} noun="orders" onPageChange={() => {}} />);
    expect(screen.getByText('Showing 25 of 1,445 orders')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });
  it('counts only the rows on a short last page', () => {
    render(<Pagination page={3} pageSize={25} total={61} noun="orders" onPageChange={() => {}} />);
    expect(screen.getByText('Showing 11 of 61 orders')).toBeInTheDocument();
  });
  it('disables Previous on page 1 and Next on the last page', () => {
    const { rerender } = render(<Pagination page={1} pageSize={10} total={25} noun="customers" onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    rerender(<Pagination page={3} pageSize={10} total={25} noun="customers" onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
  });
  it('calls onPageChange with the next and previous page, by mouse and keyboard', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={2} pageSize={10} total={50} noun="orders" onPageChange={onPageChange} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    screen.getByRole('button', { name: 'Previous page' }).focus();
    await user.keyboard('{Enter}');
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });
  it('shows 0 of 0 and one page for an empty list', () => {
    render(<Pagination page={1} pageSize={10} total={0} noun="orders" onPageChange={() => {}} />);
    expect(screen.getByText('Showing 0 of 0 orders')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });
});
