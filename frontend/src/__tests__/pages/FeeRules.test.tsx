import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { FeeRules } from '../../pages/deliveries/FeeRules';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import type { FeeOutcome, FeeRulesResponse } from '../../services/delivery-partners.service';

const feeRules = vi.fn();
const addFeeRules = vi.fn();
vi.mock('../../services/delivery-partners.service', async (orig) => ({
  ...(await orig<typeof import('../../services/delivery-partners.service')>()),
  deliveryPartnersService: { feeRules: (...a: unknown[]) => feeRules(...a), addFeeRules: (...a: unknown[]) => addFeeRules(...a) },
}));

const rule = (id: number, outcome: FeeOutcome, amount: string, validFrom = '2026-01-01', basis: 'flat' | 'percent' = 'flat') =>
  ({ id, outcome, basis, amount, validFrom });

const EMPTY: FeeRulesResponse = { rules: [], current: { delivered: null, failed: null, returned: null }, weightedFee: null, deliveredOrders: 0 };

const onSaved = vi.fn();
const open = (canEdit = true) =>
  render(<ToastProvider><FeeRules partnerId={2} canEdit={canEdit} onSaved={onSaved} /></ToastProvider>);

/** A 409 as the fee rule API sends it: the first sentence and the sentences per outcome. */
const conflict = (errors: Partial<Record<FeeOutcome, string>>) =>
  Object.assign(new axios.AxiosError('conflict'), { response: { status: 409, data: { error: Object.values(errors)[0], errors } } });

beforeEach(() => {
  [feeRules, addFeeRules, onSaved].forEach((m) => m.mockReset());
  useConfigStore.setState({ currency: 'GHS' });
  feeRules.mockResolvedValue(EMPTY);
});

describe('FeeRules (M5-T32, F-703)', () => {
  it('renders saved rules whose amounts arrive as numbers (the API client turns money strings into numbers) and runs a save', async () => {
    // What GET /fee-rules gives the page after normalizeMoney: amount is a number, not "25.00"
    const asNumbers = (amount: number, id: number, outcome: FeeOutcome) => ({ ...rule(id, outcome, ''), amount: amount as unknown as string });
    feeRules.mockResolvedValue({
      rules: [asNumbers(25, 1, 'delivered'), asNumbers(5, 2, 'failed')],
      current: { delivered: asNumbers(25, 1, 'delivered'), failed: asNumbers(5, 2, 'failed'), returned: null },
      weightedFee: 25 as unknown as string, deliveredOrders: 3,
    });
    addFeeRules.mockResolvedValue({
      rules: [asNumbers(3, 5, 'returned'), asNumbers(25, 1, 'delivered'), asNumbers(5, 2, 'failed')],
      current: { delivered: asNumbers(25, 1, 'delivered'), failed: asNumbers(5, 2, 'failed'), returned: asNumbers(3, 5, 'returned') },
      weightedFee: 25 as unknown as string, deliveredOrders: 3,
    });
    open();
    expect(await screen.findByLabelText('Delivered delivery fee')).toHaveValue(25);
    expect(screen.getByLabelText('Failed delivery fee')).toHaveValue(5);
    await userEvent.type(screen.getByLabelText('Returned delivery fee'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery fees' }));
    await waitFor(() => expect(addFeeRules).toHaveBeenCalledWith(2, [expect.objectContaining({ outcome: 'returned', amount: '3' })]));
    // After the save the rows are built from the answer (numbers again) and the screen still renders and can be edited
    expect(await screen.findByText(/Now GH₵3 since/)).toBeInTheDocument();
    expect(screen.getByLabelText('Returned delivery fee')).toHaveValue(3);
    await userEvent.type(screen.getByLabelText('Failed delivery fee'), '0');
    expect(screen.getByLabelText('Failed delivery fee')).toHaveValue(50);
  });

  it('the owner sets Kofi to 25 delivered and 5 failed: one request with both, and both show as saved', async () => {
    const saved: FeeRulesResponse = {
      rules: [rule(1, 'delivered', '25.00', '2026-10-26'), rule(2, 'failed', '5.00', '2026-10-26')],
      current: { delivered: rule(1, 'delivered', '25.00', '2026-10-26'), failed: rule(2, 'failed', '5.00', '2026-10-26'), returned: null },
      weightedFee: null, deliveredOrders: 0,
    };
    addFeeRules.mockResolvedValue(saved);
    open();
    await userEvent.type(await screen.findByLabelText('Delivered delivery fee'), '25');
    await userEvent.type(screen.getByLabelText('Failed delivery fee'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery fees' }));

    await waitFor(() => expect(addFeeRules).toHaveBeenCalledTimes(1));
    expect(addFeeRules).toHaveBeenCalledWith(2, [
      expect.objectContaining({ outcome: 'delivered', basis: 'flat', amount: '25' }),
      expect.objectContaining({ outcome: 'failed', basis: 'flat', amount: '5' }),
    ]);
    expect(onSaved).toHaveBeenCalledWith(saved); // the page takes the rules in force from the response: no reload of the list
    expect(feeRules).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Now GH₵25 since 2026-10-26/)).toBeInTheDocument();
    expect(screen.getByText(/Now GH₵5 since 2026-10-26/)).toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'History of delivery fee rules' });
    expect(within(history).getAllByText('In force')).toHaveLength(2);
  });

  it('has a rule per delivered, failed and returned, and sends only the outcomes that changed', async () => {
    feeRules.mockResolvedValue({
      rules: [rule(1, 'delivered', '25.00'), rule(2, 'failed', '5.00')],
      current: { delivered: rule(1, 'delivered', '25.00'), failed: rule(2, 'failed', '5.00'), returned: null },
      weightedFee: null, deliveredOrders: 0,
    });
    addFeeRules.mockResolvedValue(EMPTY);
    open();
    expect(await screen.findByLabelText('Delivered delivery fee')).toHaveValue(25);
    expect(screen.getByLabelText('Failed delivery fee')).toHaveValue(5);
    expect(screen.getByLabelText('Returned delivery fee')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Save delivery fees' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Returned delivery fee'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery fees' }));
    await waitFor(() => expect(addFeeRules).toHaveBeenCalledTimes(1));
    expect(addFeeRules).toHaveBeenCalledWith(2, [expect.objectContaining({ outcome: 'returned', amount: '3' })]);
  });

  it('shows the history in the order the server sends it, with the rule in force tagged', async () => {
    feeRules.mockResolvedValue({
      rules: [rule(3, 'delivered', '30.00', '2026-06-01'), rule(1, 'delivered', '25.00', '2026-01-01'), rule(2, 'failed', '10', '2026-02-01', 'percent')],
      current: { delivered: rule(3, 'delivered', '30.00', '2026-06-01'), failed: rule(2, 'failed', '10', '2026-02-01', 'percent'), returned: null },
      weightedFee: null, deliveredOrders: 0,
    });
    open();
    const history = await screen.findByRole('region', { name: 'History of delivery fee rules' });
    const rows = within(history).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').slice(0, 3).map((c) => c.textContent))).toEqual([
      ['2026-06-01', 'Delivered', 'GH₵30'],
      ['2026-01-01', 'Delivered', 'GH₵25'],
      ['2026-02-01', 'Failed', '10%'],
    ]);
    expect(within(rows[0]).getByText('In force')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('In force')).not.toBeInTheDocument();
    expect(within(rows[2]).getByText('In force')).toBeInTheDocument();
  });

  it('shows the weighted delivery fee over the delivered orders', async () => {
    feeRules.mockResolvedValue({ ...EMPTY, weightedFee: '25.00', deliveredOrders: 48 });
    open();
    expect(await screen.findByText('GH₵25')).toBeInTheDocument();
    expect(screen.getByText(/per delivered order, over 48 delivered orders/)).toBeInTheDocument();
  });

  it('says so when there is no delivered order with a delivery fee yet', async () => {
    open();
    expect(await screen.findByText('No delivered order with a delivery fee yet.')).toBeInTheDocument();
  });

  it('a second rule with the same date shows the server message under that outcome, and nothing is saved', async () => {
    feeRules.mockResolvedValue({
      rules: [rule(1, 'delivered', '25.00', '2026-10-26')],
      current: { delivered: rule(1, 'delivered', '25.00', '2026-10-26'), failed: null, returned: null },
      weightedFee: null, deliveredOrders: 0,
    });
    addFeeRules.mockRejectedValue(conflict({ delivered: 'This partner already has a delivered fee rule from 2026-10-26' }));
    open();
    const field = await screen.findByLabelText('Delivered delivery fee');
    await userEvent.clear(field);
    await userEvent.type(field, '30');
    await userEvent.type(screen.getByLabelText('Failed delivery fee'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery fees' }));
    expect(await screen.findByText('This partner already has a delivered fee rule from 2026-10-26')).toBeInTheDocument();
    expect(field).toHaveValue(30); // what was typed stays, so the owner can pick another date
    expect(screen.getByLabelText('Failed delivery fee')).toHaveValue(4);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('says "delivery fee" and never "fee rule", "agent fee" or "agent pay" on screen', async () => {
    const { container } = open();
    await screen.findByLabelText('Delivered delivery fee');
    const text = container.textContent ?? '';
    expect(text).toMatch(/Delivery fee is what the partner keeps from the cash it collects\. Expected cash = cash collected minus fees\./);
    expect(text).not.toMatch(/agent fee|agent pay|pay-per-delivery/i);
    expect(text).not.toMatch(/\bfee rule\b/i);
  });

  it('a role that cannot edit sees the rules but the fields and Save are disabled with a tooltip', async () => {
    feeRules.mockResolvedValue({ ...EMPTY, current: { delivered: rule(1, 'delivered', '25.00'), failed: null, returned: null }, rules: [rule(1, 'delivered', '25.00')] });
    open(false);
    expect(await screen.findByLabelText('Delivered delivery fee')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save delivery fees' })).toBeDisabled();
    expect(screen.getByText('You do not have permission to change delivery fees.')).toBeInTheDocument();
  });

  it('refuses a negative amount before sending', async () => {
    open();
    await userEvent.type(await screen.findByLabelText('Delivered delivery fee'), '-4');
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery fees' }));
    expect(await screen.findByText('The delivery fee must be a number of 0 or more')).toBeInTheDocument();
    expect(addFeeRules).not.toHaveBeenCalled();
  });
});
