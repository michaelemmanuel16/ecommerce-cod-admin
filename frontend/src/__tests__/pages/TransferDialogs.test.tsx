import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiveDialog, ResolveDialog } from '../../pages/inventory/TransferDialogs';
import { KOFI, LOGISWIFT, transfer } from '../fixtures/inventory';

const receive = vi.fn();
const resolve = vi.fn();
vi.mock('../../services/inventory.service', async (orig) => ({
  ...(await orig<typeof import('../../services/inventory.service')>()),
  inventoryService: { receive: (...a: unknown[]) => receive(...a), resolve: (...a: unknown[]) => resolve(...a) },
}));

const onDone = vi.fn();
const toStore = transfer({ id: 9, quantity: 10, toLocation: { id: LOGISWIFT, name: 'Logiswift', type: 'partner_3pl' }, fromLocation: { id: 1, name: 'Own store', type: 'own_store' } });

beforeEach(() => {
  [receive, resolve, onDone].forEach((m) => m.mockReset().mockResolvedValue({}));
});

describe('Confirm received', () => {
  it('confirms everything that was sent with no reason', async () => {
    render(<ReceiveDialog transfer={toStore} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.getByLabelText('Counted on arrival')).toHaveValue(10);
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm received' }));
    await waitFor(() => expect(receive).toHaveBeenCalledWith(9, { quantity: 10 }));
  });
  it('receive 8 of 10 asks for a reason, then reports 2 short', async () => {
    render(<ReceiveDialog transfer={toStore} onClose={vi.fn()} onDone={onDone} />);
    const q = screen.getByLabelText('Counted on arrival');
    await userEvent.clear(q);
    await userEvent.type(q, '8');
    const button = screen.getByRole('button', { name: 'Confirm received' });
    expect(button).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'short_in_package');
    await userEvent.click(button);
    await waitFor(() => expect(receive).toHaveBeenCalledWith(9, { quantity: 8, reason: 'short_in_package' }));
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('2 short'));
  });
  it('refuses more than was sent', async () => {
    render(<ReceiveDialog transfer={toStore} onClose={vi.fn()} onDone={onDone} />);
    const q = screen.getByLabelText('Counted on arrival');
    await userEvent.clear(q);
    await userEvent.type(q, '11');
    expect(screen.getByText('Only 10 were sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm received' })).toBeDisabled();
  });
});

describe('Resolve the shortage', () => {
  const disputed = transfer({ id: 5, quantity: 10, status: 'disputed', receivedQuantity: 8, shortQuantity: 2, reason: 'short_in_package' });
  it('returns the short units to the source by default', async () => {
    render(<ResolveDialog transfer={disputed} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.getByLabelText(/Return to source/)).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(5, { action: 'return_to_source' }));
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('went back to Logiswift'));
  });
  it('can write off with a note', async () => {
    render(<ResolveDialog transfer={disputed} onClose={vi.fn()} onDone={onDone} />);
    await userEvent.click(screen.getByLabelText(/Write off/));
    await userEvent.type(screen.getByLabelText(/Note/), 'lost in van');
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(5, { action: 'write_off', note: 'lost in van' }));
  });
  it('a 3PL return that never arrived offers only the write-off', () => {
    const t = transfer({ id: 6, transferType: 'return_to_warehouse', status: 'disputed', quantity: 5, receivedQuantity: 0, shortQuantity: 5, fromLocation: { id: LOGISWIFT, name: 'Logiswift', type: 'partner_3pl' }, toLocation: { id: KOFI, name: 'Shop', type: 'own_store' } });
    render(<ResolveDialog transfer={t} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.getByLabelText(/Return to source/)).toBeDisabled();
    expect(screen.getByLabelText(/Write off/)).toBeChecked();
  });
});
