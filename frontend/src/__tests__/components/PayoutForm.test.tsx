import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { PayoutForm } from '../../components/payouts/PayoutForm';
import { useConfigStore } from '../../stores/configStore';
import type { OwedPreview, PayoutRow } from '../../services/payouts.service';

const owed = vi.fn();
const history = vi.fn();
const record = vi.fn();
vi.mock('../../services/payouts.service', () => ({
  payoutsService: { owed: (...a: unknown[]) => owed(...a), history: (...a: unknown[]) => history(...a), record: (...a: unknown[]) => record(...a) },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
let canCreate = true;
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: (r: string, a: string) => (r === 'payouts' && a === 'create' ? canCreate : true) }) }));

const ADWOA: OwedPreview = {
  payee: { id: 7, firstName: 'Adwoa', lastName: 'Mensah', kind: 'rep' },
  commission: '2024.00', upsellReward: '610.00', targetReward: '0.00', earned: '2634.00', paid: '600.00', owed: '2034.00',
  entries: [
    { id: 1, orderId: 101, kind: 'base', amount: '1424.00', earnedAt: '2026-10-02T10:00:00Z' },
    { id: 2, orderId: 102, kind: 'upsell', amount: '610.00', earnedAt: '2026-10-03T10:00:00Z' },
  ],
};
const NOTHING: OwedPreview = { ...ADWOA, owed: '0.00', entries: [] };
const PAST: PayoutRow = {
  id: 9, payeeId: 7, kind: 'rep', amount: '600.00', method: 'Bank Transfer', reference: 'B-1', payoutDate: '2026-10-01T00:00:00Z', notes: 'September',
  payee: { id: 7, firstName: 'Adwoa', lastName: 'Mensah' }, recordedBy: { id: 1, firstName: 'Ama', lastName: 'Owner' }, _count: { commissionEntries: 3 },
};

const refuse = (message: string, status = 400) => Object.assign(new axios.AxiosError('refused'), { response: { status, data: { error: message } } });
const onClose = vi.fn();
const open = () => render(<PayoutForm personId={7} onClose={onClose} onRecorded={onRecorded} />);
const onRecorded = vi.fn();
const save = () => screen.getByRole('button', { name: /Record payout/ });
const amountField = () => screen.getByLabelText('Amount') as HTMLInputElement;

beforeEach(() => {
  [owed, history, record, onRecorded, onClose].forEach((m) => m.mockReset());
  canCreate = true;
  useConfigStore.setState({ currency: 'GHS' });
  owed.mockResolvedValue(ADWOA);
  history.mockResolvedValue([PAST]);
  record.mockResolvedValue(PAST);
});

describe('PayoutForm (M5-T38, F-913)', () => {
  it('takes a person id and lists that person\'s owed entries from the preview', async () => {
    open();
    const list = await screen.findByRole('region', { name: 'Owed entries' });
    expect(owed).toHaveBeenCalledWith(7);
    expect(history).toHaveBeenCalledWith(7);
    expect(within(list).getAllByRole('row')).toHaveLength(3); // header + 2 entries
    expect(within(list).getByText('Commission')).toBeInTheDocument();
    expect(within(list).getByText('Upsell reward')).toBeInTheDocument();
    expect(within(list).getByText('GH₵1,424')).toBeInTheDocument();
    expect(screen.getByText('Owed now').nextSibling).toHaveTextContent('GH₵2,034');
    expect(amountField().value).toBe('2034.00');
    expect(screen.getByText(/Posts to 2020 Commissions payable/)).toBeInTheDocument();
  });

  it('has no delivery fee line anywhere', async () => {
    const { container } = open();
    await screen.findByRole('region', { name: 'Owed entries' });
    expect(container.ownerDocument.body.textContent).not.toMatch(/delivery fee|agent fee|agent pay|airtime/i);
  });

  it('the amount follows the ticked entries', async () => {
    open();
    await screen.findByRole('region', { name: 'Owed entries' });
    await userEvent.click(screen.getByRole('checkbox', { name: /Pay Upsell reward of order 102/ }));
    expect(amountField().value).toBe('1424.00');
    await userEvent.click(screen.getByRole('checkbox', { name: /Pay Upsell reward of order 102/ }));
    expect(amountField().value).toBe('2034.00');
  });

  it('blocks save when owed is 0', async () => {
    owed.mockResolvedValue(NOTHING);
    open();
    expect(await screen.findByText('Nothing is owed to this person')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('blocks save when the amount is above owed, with the "Owed is" sentence', async () => {
    open();
    await screen.findByRole('region', { name: 'Owed entries' });
    await userEvent.clear(amountField());
    await userEvent.type(amountField(), '2035');
    expect(screen.getByTestId('blocked-reason')).toHaveTextContent('Owed is GH₵2,034');
    expect(save()).toBeDisabled();
    expect(record).not.toHaveBeenCalled();
  });

  it('sends the ticked entries, amount, method, date and reference, then reloads and tells the caller', async () => {
    open();
    await screen.findByRole('region', { name: 'Owed entries' });
    await userEvent.clear(amountField());
    await userEvent.type(amountField(), '1000');
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'Mobile Money');
    await userEvent.type(screen.getByLabelText('Reference (optional)'), 'MOMO-1');
    await userEvent.click(save());
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ payeeId: 7, amount: '1000', method: 'Mobile Money', reference: 'MOMO-1', entryIds: [1, 2] }));
    expect(record.mock.calls[0][0]).not.toHaveProperty('deliveryFee');
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(owed).toHaveBeenCalledTimes(2); // reloaded after the save
  });

  it('shows the server message when the payout is refused ("Already paid")', async () => {
    record.mockRejectedValue(refuse('Already paid', 409));
    open();
    await screen.findByRole('region', { name: 'Owed entries' });
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Already paid');
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('shows the server "Owed is" message when the server disagrees with the form', async () => {
    record.mockRejectedValue(refuse('Owed is GH₵1,500'));
    open();
    await screen.findByRole('region', { name: 'Owed entries' });
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Owed is GH₵1,500');
  });

  it('shows the payout history with who recorded it', async () => {
    open();
    const region = await screen.findByRole('region', { name: 'Payout history' });
    const row = within(region).getAllByRole('row')[1];
    expect(within(row).getByText('GH₵600')).toBeInTheDocument();
    expect(within(row).getByText('Bank Transfer')).toBeInTheDocument();
    expect(within(row).getByText('B-1')).toBeInTheDocument();
    expect(within(row).getByText('September')).toBeInTheDocument();
    expect(within(row).getByText('Ama Owner')).toBeInTheDocument();
  });

  it('without the payouts permission, Save is disabled and a tooltip says why', async () => {
    canCreate = false;
    open();
    await screen.findByRole('region', { name: 'Owed entries' });
    expect(save()).toBeDisabled();
    expect(screen.getAllByText('You do not have permission to record payouts.').length).toBeGreaterThan(0);
    await userEvent.hover(save().closest('span[tabindex]')!);
    expect(await screen.findAllByText('You do not have permission to record payouts.')).toHaveLength(2);
  });

  it('the close X has a name, and Escape closes the form', async () => {
    open();
    await screen.findByRole('region', { name: 'Owed entries' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows why the details did not load', async () => {
    owed.mockRejectedValue(refuse('Person not found', 404));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Person not found');
  });
});
