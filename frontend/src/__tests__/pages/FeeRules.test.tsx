import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { FeeRules } from '../../pages/deliveries/FeeRules';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import type { FeeOutcome, FeeRulesResponse } from '../../services/delivery-partners.service';

const feeRules = vi.fn();
const addFeeRule = vi.fn();
vi.mock('../../services/delivery-partners.service', async (orig) => ({
  ...(await orig<typeof import('../../services/delivery-partners.service')>()),
  deliveryPartnersService: { feeRules: (...a: unknown[]) => feeRules(...a), addFeeRule: (...a: unknown[]) => addFeeRule(...a) },
}));

const rule = (id: number, outcome: FeeOutcome, amount: string, validFrom = '2026-01-01', basis: 'flat' | 'percent' = 'flat') =>
  ({ id, outcome, basis, amount, validFrom, createdAt: `${validFrom}T00:00:00Z` });

const EMPTY: FeeRulesResponse = { rules: [], current: { delivered: null, failed: null, returned: null }, weightedFee: null, deliveredOrders: 0 };

const onChanged = vi.fn();
const open = (canEdit = true) =>
  render(<ToastProvider><FeeRules partnerId={2} canEdit={canEdit} onChanged={onChanged} /></ToastProvider>);

/** A 409 as the COD-48 fee rule API sends it. */
const conflict = (message: string) => Object.assign(new axios.AxiosError('conflict'), { response: { status: 409, data: { error: message } } });

beforeEach(() => {
  [feeRules, addFeeRule, onChanged].forEach((m) => m.mockReset());
  useConfigStore.setState({ currency: 'GHS' });
  feeRules.mockResolvedValue(EMPTY);
});

describe('FeeRules (M5-T32, F-703)', () => {
  it('the owner sets Kofi to 25 delivered and 5 failed, and both are sent and shown as saved', async () => {
    const saved: FeeRulesResponse = {
      rules: [rule(2, 'failed', '5.00', '2026-10-26'), rule(1, 'delivered', '25.00', '2026-10-26')],
      current: { delivered: rule(1, 'delivered', '25.00', '2026-10-26'), failed: rule(2, 'failed', '5.00', '2026-10-26'), returned: null },
      weightedFee: null, deliveredOrders: 0,
    };
    feeRules.mockResolvedValueOnce(EMPTY).mockResolvedValue(saved);
    addFeeRule.mockResolvedValue({});
    open();
    await userEvent.type(await screen.findByLabelText('Delivered delivery fee'), '25');
    await userEvent.type(screen.getByLabelText('Failed delivery fee'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery fees' }));

    await waitFor(() => expect(addFeeRule).toHaveBeenCalledTimes(2));
    expect(addFeeRule).toHaveBeenCalledWith(2, expect.objectContaining({ outcome: 'delivered', basis: 'flat', amount: '25' }));
    expect(addFeeRule).toHaveBeenCalledWith(2, expect.objectContaining({ outcome: 'failed', basis: 'flat', amount: '5' }));
    expect(onChanged).toHaveBeenCalled();
    // Both show as saved: the rule in force under each field, and in the history with the "In force" tag
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
    addFeeRule.mockResolvedValue({});
    open();
    expect(await screen.findByLabelText('Delivered delivery fee')).toHaveValue(25);
    expect(screen.getByLabelText('Failed delivery fee')).toHaveValue(5);
    expect(screen.getByLabelText('Returned delivery fee')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Save delivery fees' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Returned delivery fee'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery fees' }));
    await waitFor(() => expect(addFeeRule).toHaveBeenCalledTimes(1));
    expect(addFeeRule).toHaveBeenCalledWith(2, expect.objectContaining({ outcome: 'returned', amount: '3' }));
  });

  it('shows the history of rules, newest first, with the one in force tagged', async () => {
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
      ['2026-02-01', 'Failed', '10%'],
      ['2026-01-01', 'Delivered', 'GH₵25'],
    ]);
    expect(within(history).getAllByText('In force')).toHaveLength(2);
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

  it('a second rule with the same date shows the server message under that outcome', async () => {
    feeRules.mockResolvedValue({
      rules: [rule(1, 'delivered', '25.00', '2026-10-26')],
      current: { delivered: rule(1, 'delivered', '25.00', '2026-10-26'), failed: null, returned: null },
      weightedFee: null, deliveredOrders: 0,
    });
    addFeeRule.mockRejectedValue(conflict('This partner already has a delivered fee rule from 2026-10-26'));
    open();
    const field = await screen.findByLabelText('Delivered delivery fee');
    await userEvent.clear(field);
    await userEvent.type(field, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery fees' }));
    expect(await screen.findByText('This partner already has a delivered fee rule from 2026-10-26')).toBeInTheDocument();
    expect(field).toHaveValue(30); // what was typed stays, so the owner can pick another date
    expect(onChanged).not.toHaveBeenCalled();
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
    expect(screen.getByText('Only the owner and admins change delivery fees')).toBeInTheDocument();
  });

  it('refuses a negative amount before sending', async () => {
    open();
    await userEvent.type(await screen.findByLabelText('Delivered delivery fee'), '-4');
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery fees' }));
    expect(await screen.findByText('The delivery fee must be a number of 0 or more')).toBeInTheDocument();
    expect(addFeeRule).not.toHaveBeenCalled();
  });
});
