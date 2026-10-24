import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HistoryModal } from '../../pages/inventory/HistoryModal';
import { OVERVIEW, PRODUCTS, TRANSFERS } from '../fixtures/inventory';

const transfers = vi.fn();
const trail = vi.fn();
const exportCsv = vi.fn();
vi.mock('../../services/inventory.service', async (orig) => ({
  ...(await orig<typeof import('../../services/inventory.service')>()),
  inventoryService: { transfers: (...a: unknown[]) => transfers(...a), trail: (...a: unknown[]) => trail(...a), exportCsv: (...a: unknown[]) => exportCsv(...a) },
}));

const resolve = vi.fn();
const receive = vi.fn();
const open = (props: Partial<React.ComponentProps<typeof HistoryModal>> = {}) =>
  render(
    <MemoryRouter>
      <HistoryModal overview={OVERVIEW} products={PRODUCTS} canMove canExport refreshKey={0} onClose={vi.fn()} onReceive={receive} onResolve={resolve} onCancel={vi.fn()} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  [transfers, trail, resolve, receive, exportCsv].forEach((m) => m.mockReset());
  transfers.mockResolvedValue({ transfers: TRANSFERS, typeCounts: { allocation: 2, return_to_warehouse: 1, adjustment: 1 }, pagination: { page: 1, limit: 15, total: 4, pages: 1 } });
  trail.mockResolvedValue([
    { id: 1, action: 'create', at: '2026-10-17T11:20:00.000Z', by: { id: 1, firstName: 'Manny', lastName: 'Owner' }, details: null },
    { id: 2, action: 'receive', at: '2026-10-18T09:00:00.000Z', by: { id: 4, firstName: 'Esi', lastName: 'Badu' }, details: null },
  ]);
});

describe('Transfer history (F-659)', () => {
  it('tabs carry counts from the API and a tab filters by type', async () => {
    open();
    expect(await screen.findByRole('tab', { name: /^All\s*4/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Allocation\s*2/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /^Return\s*1/ }));
    await waitFor(() => expect(transfers).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'return_to_warehouse', page: 1 }), true));
  });

  it('holder, product and status filters go to the API', async () => {
    open();
    await screen.findByRole('table', { name: 'Transfer history' });
    await userEvent.selectOptions(screen.getByLabelText('Filter by holder'), '11');
    await userEvent.selectOptions(screen.getByLabelText('Filter by product'), '2');
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'disputed');
    await waitFor(() => expect(transfers).toHaveBeenLastCalledWith(expect.objectContaining({ locationId: 11, productId: 2, status: 'disputed' }), true));
  });

  it('a row opens the side detail with the audit trail and the actions of its status', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Transfer history' });
    const row = Array.from(table.querySelectorAll('tbody tr')).find((r) => r.textContent?.includes('Received 2 short'))!;
    await userEvent.click(row);
    const detail = await screen.findByRole('complementary', { name: 'Transfer 2' });
    expect(await screen.findByText('Counted on arrival')).toBeInTheDocument();
    expect(detail).toHaveTextContent('Esi Badu');
    await userEvent.click(screen.getByRole('button', { name: /Resolve/ }));
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('opens on the transfer that was clicked in Recent transfers', async () => {
    open({ initialId: 1 });
    expect(await screen.findByRole('complementary', { name: 'Transfer 1' })).toBeInTheDocument();
  });

  it('asks for the counts on page 1 only; page 2 keeps the tab counts', async () => {
    transfers.mockResolvedValue({ transfers: TRANSFERS, typeCounts: { allocation: 20 }, pagination: { page: 1, limit: 15, total: 20, pages: 2 } });
    open();
    await screen.findByRole('tab', { name: /^Allocation\s*20/ });
    expect(transfers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, includeCounts: true }), true);
    transfers.mockResolvedValue({ transfers: TRANSFERS, pagination: { page: 2, limit: 15 } });
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(transfers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, includeCounts: false }), true));
    expect(screen.getByRole('tab', { name: /^Allocation\s*20/ })).toBeInTheDocument();
  });

  it('Export CSV downloads what the server builds, with the same filters', async () => {
    exportCsv.mockResolvedValue(new Blob(['Date\r\n']));
    const create = vi.fn(() => 'blob:x');
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    open();
    await screen.findByRole('table', { name: 'Transfer history' });
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'disputed');
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith(expect.objectContaining({ status: 'disputed' })));
    expect(exportCsv.mock.calls[0][0]).not.toHaveProperty('page');
    expect(create).toHaveBeenCalled();
  });

  it('Export CSV shows for owner, admin and finance clerk only', async () => {
    const view = open({ canExport: true });
    expect(await screen.findByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
    view.unmount();
    open({ canExport: false });
    await screen.findByRole('table', { name: 'Transfer history' });
    expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument();
  });
});
