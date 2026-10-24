import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StockModal } from '../../pages/inventory/MoveModals';
import type { ModalKind } from '../../pages/inventory/model';
import { ESI, KOFI, LOGISWIFT, OVERVIEW, PRODUCTS } from '../fixtures/inventory';

const createTransfer = vi.fn();
const adjust = vi.fn();
vi.mock('../../services/inventory.service', async (orig) => ({
  ...(await orig<typeof import('../../services/inventory.service')>()),
  inventoryService: { createTransfer: (...a: unknown[]) => createTransfer(...a), adjust: (...a: unknown[]) => adjust(...a) },
}));

const onDone = vi.fn();
const open = (kind: ModalKind, initial?: { locationId?: number; productId?: number }) =>
  render(<StockModal kind={kind} overview={OVERVIEW} products={PRODUCTS} initial={initial} onClose={vi.fn()} onDone={onDone} />);
const submit = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  [createTransfer, adjust, onDone].forEach((m) => m.mockReset());
  createTransfer.mockResolvedValue({ id: 1 });
  adjust.mockResolvedValue({ previousQuantity: 36, newQuantity: 30 });
});

describe('Allocate modal (F-655)', () => {
  it('allocates 10 to Kofi from the warehouse and says it is in transit', async () => {
    open('allocate');
    expect(screen.getByText('200 on hand · 34 reserved')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('To'), String(KOFI));
    await userEvent.type(screen.getByLabelText('Quantity'), '10');
    await userEvent.click(submit(/Allocate to an agent/));
    await waitFor(() => expect(createTransfer).toHaveBeenCalledWith({ type: 'allocation', productId: 1, quantity: 10, fromLocationId: LOGISWIFT, toLocationId: KOFI, note: undefined }));
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('In transit until they confirm'));
  });

  it('will not send more than the source has on hand', async () => {
    open('allocate', { productId: 1 });
    await userEvent.type(screen.getByLabelText('Quantity'), '201');
    expect(screen.getByText('Only 200 on hand')).toBeInTheDocument();
    expect(submit(/Allocate to an agent/)).toBeDisabled();
  });

  it('the limit follows the product', async () => {
    open('allocate');
    await userEvent.selectOptions(screen.getByLabelText('Product'), '2');
    expect(screen.getByText('62 on hand · 11 reserved')).toBeInTheDocument();
  });

  it('shows the API refusal in the form', async () => {
    createTransfer.mockRejectedValue({ isAxiosError: true, response: { data: { error: 'Only 5 available' } } });
    open('allocate');
    await userEvent.type(screen.getByLabelText('Quantity'), '5');
    await userEvent.click(submit(/Allocate to an agent/));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only 5 available|could not be moved/);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('Reserved units (owner decision 2026-10-24)', () => {
  it('the hint has no "reserved" part when nothing is reserved', () => {
    const none = { ...OVERVIEW, stockByLocation: OVERVIEW.stockByLocation.map((r) => ({ ...r, reserved: 0 })) };
    render(<StockModal kind="transfer" overview={none} products={PRODUCTS} initial={{ locationId: KOFI, productId: 1 }} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.getByText('36 on hand')).toBeInTheDocument();
  });

  it('up to the free units (on hand minus reserved) there is no warning; one more shows it, and saving stays allowed', async () => {
    open('allocate', { productId: 1 }); // 200 on hand, 34 reserved: 166 free
    const q = screen.getByLabelText('Quantity');
    await userEvent.type(q, '166');
    expect(screen.queryByText(/reserved for open orders/)).not.toBeInTheDocument();
    await userEvent.clear(q);
    await userEvent.type(q, '167');
    expect(screen.getByText('This takes 1 unit reserved for open orders at Logiswift. Move those orders too, or Logiswift will run short.')).toBeInTheDocument();
    expect(submit(/Allocate to an agent/)).toBeEnabled();
    await userEvent.clear(q);
    await userEvent.type(q, '200');
    expect(screen.getByText(/This takes 34 units reserved/)).toBeInTheDocument();
    expect(submit(/Allocate to an agent/)).toBeEnabled();
  });

  it('every kind warns, and above on hand is still an error with no warning', async () => {
    open('transfer', { locationId: KOFI, productId: 1 }); // 36 on hand, 11 reserved
    const q = screen.getByLabelText('Quantity');
    await userEvent.type(q, '26');
    expect(screen.getByText(/This takes 1 unit reserved for open orders at Kofi Appiah/)).toBeInTheDocument();
    await userEvent.clear(q);
    await userEvent.type(q, '37');
    expect(screen.getByText('Only 36 on hand')).toBeInTheDocument();
    expect(screen.queryByText(/reserved for open orders/)).not.toBeInTheDocument();
  });
});

describe('Transfer modal', () => {
  it('moves stock agent to agent, from the holder that was clicked', async () => {
    open('transfer', { locationId: KOFI, productId: 1 });
    expect(screen.getByText('36 on hand · 11 reserved')).toBeInTheDocument();
    expect(screen.getByLabelText('To agent')).toHaveValue(String(ESI));
    await userEvent.type(screen.getByLabelText('Quantity'), '5');
    await userEvent.click(submit(/Transfer to another agent/));
    await waitFor(() => expect(createTransfer).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent_transfer', fromLocationId: KOFI, toLocationId: ESI, quantity: 5 })));
  });
  it('offers agents only, and not the sender as receiver', () => {
    open('transfer', { locationId: KOFI });
    const to = screen.getByLabelText('To agent');
    expect(Array.from(to.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Esi Badu']);
  });
});

describe('Return modal', () => {
  it('returns with a reason', async () => {
    open('return', { locationId: KOFI, productId: 1 });
    await userEvent.type(screen.getByLabelText('Quantity'), '9');
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'customer_refused');
    await userEvent.click(submit(/Return to warehouse/));
    await waitFor(() => expect(createTransfer).toHaveBeenCalledWith(expect.objectContaining({ type: 'return_to_warehouse', reason: 'customer_refused', fromLocationId: KOFI, toLocationId: LOGISWIFT, quantity: 9 })));
  });
});

describe('Adjust modal', () => {
  it('starts at the current quantity: no change, nothing to save', () => {
    open('adjust', { locationId: KOFI, productId: 1 });
    expect(screen.getByLabelText('New quantity')).toHaveValue(36);
    expect(screen.getByText('Now 36. No change.')).toBeInTheDocument();
    expect(submit(/Adjust quantity/)).toBeDisabled();
  });
  it('shows the change and saves it with a reason', async () => {
    open('adjust', { locationId: KOFI, productId: 1 });
    const q = screen.getByLabelText('New quantity');
    await userEvent.clear(q);
    await userEvent.type(q, '30');
    expect(screen.getByText('Now 36. Change of −6.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'damaged');
    await userEvent.click(submit(/Adjust quantity/));
    await waitFor(() => expect(adjust).toHaveBeenCalledWith({ locationId: KOFI, productId: 1, newQuantity: 30, reason: 'damaged', note: undefined }));
  });
  it('Other needs a note', async () => {
    open('adjust', { locationId: KOFI, productId: 1 });
    const q = screen.getByLabelText('New quantity');
    await userEvent.clear(q);
    await userEvent.type(q, '40');
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'other');
    expect(submit(/Adjust quantity/)).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Note/), 'Found a box');
    expect(submit(/Adjust quantity/)).toBeEnabled();
  });
});
