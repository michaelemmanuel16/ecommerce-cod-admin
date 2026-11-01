import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PayCard } from '../../pages/staff/PayCard';
import { RepCommissions } from '../../pages/financial/RepCommissions';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { useConfigStore } from '../../stores/configStore';
import type { OwedPreview, PayoutRow, RepOwedRow } from '../../services/payouts.service';
import type { PartnerList } from '../../services/delivery-partners.service';
import { COMPANY, KOFI, ROBO, STAFF } from '../fixtures/staff';

const pay = vi.hoisted(() => ({ repsOwed: vi.fn(), owed: vi.fn(), history: vi.fn(), recentRepPayouts: vi.fn(), record: vi.fn() }));
vi.mock('../../services/payouts.service', () => ({ payoutsService: pay }));
const partners = vi.hoisted(() => vi.fn());
vi.mock('../../services/delivery-partners.service', () => ({ deliveryPartnersService: { list: partners } }));
const aging = vi.hoisted(() => vi.fn());
vi.mock('../../services/collections.service', () => ({ collectionsService: { aging } }));
const staffList = vi.hoisted(() => vi.fn());
vi.mock('../../services/staff.service', () => ({ staffService: { list: staffList } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true, user: { role: 'super_admin' } }) }));

const rep = (over: Partial<RepOwedRow>): RepOwedRow => ({
  id: 1, firstName: 'Adwoa', lastName: 'Darko', delivered: 253, commission: '2024.00', upsellReward: '610.00', targetReward: '0.00',
  earned: '2634.00', paid: '600.00', paidInMonth: '600.00', owed: '2034.00', lastPayout: '2026-10-09T00:00:00Z', ...over,
});
const REPS = { month: '2026-10', reps: [rep({}), rep({ id: 2, firstName: 'Nana', lastName: 'Kyei', delivered: 13, commission: '104.00', upsellReward: '30.00', earned: '134.00', paid: '0.00', paidInMonth: '0.00', owed: '134.00', lastPayout: null })], totals: { owed: '2168.00', paid: '600.00', paidInMonth: '600.00', repsOwed: 2 } };
const ENTRIES: OwedPreview = {
  payee: { id: 1, firstName: 'Adwoa', lastName: 'Darko', kind: 'rep' }, commission: '2024.00', upsellReward: '610.00', targetReward: '0.00', earned: '2634.00', paid: '600.00', owed: '2034.00',
  entries: [
    { id: 1, orderId: 101, kind: 'base', amount: '1424.00', earnedAt: '2026-10-02T10:00:00Z' },
    { id: 2, orderId: 102, kind: 'upsell', amount: '610.00', earnedAt: '2026-10-03T10:00:00Z' },
  ],
};
const PAST: PayoutRow = {
  id: 9, payeeId: 1, kind: 'rep', amount: '600.00', method: 'MoMo', reference: null, payoutDate: '2026-10-09T00:00:00Z', notes: 'October commission',
  payee: { id: 1, firstName: 'Adwoa', lastName: 'Darko' }, recordedBy: { id: 5, firstName: 'Manny', lastName: 'Owner' }, _count: { commissionEntries: 3 },
};
const row = (over: object) => ({ isActive: true, isAvailable: true, isTrial: false, type: 'agent', assigned: 0, returned: 0, outNow: 0, notYetDispatched: 0, confirmedToDispatchedDays: null, dispatchedToDeliveredDays: null, dataSource: 'app', daysToPay: 3, cashHeld: null, oldestUnpaidDays: null, deliverySuccessRate: { value: null }, ...over });
const PARTNERS = {
  rows: [row({ partnerId: 12, name: 'Kofi Appiah', baseTown: 'Kumasi', delivered: 82, failed: 60, failedOrReturned: 70, feeRule: { delivered: '25.00', failed: '5.00', returned: '0.00' }, feesKept: '2400.00' })],
} as unknown as PartnerList;

const renderCard = () => render(<MemoryRouter><PayCard company={COMPANY} /></MemoryRouter>);

beforeEach(() => {
  clearBlockCache();
  [pay.repsOwed, pay.owed, pay.history, pay.recentRepPayouts, pay.record, partners, aging, staffList].forEach((m) => m.mockReset());
  useConfigStore.setState({ currency: 'GHS' });
  pay.repsOwed.mockResolvedValue(REPS);
  pay.owed.mockResolvedValue(ENTRIES);
  pay.history.mockResolvedValue([PAST]);
  pay.recentRepPayouts.mockResolvedValue([PAST]);
  partners.mockResolvedValue(PARTNERS);
  aging.mockResolvedValue({ partners: [{ agentId: 12, cashHeld: 2900 }] });
  staffList.mockResolvedValue({ ...STAFF, staff: [KOFI, ROBO] });
});

describe('Staff Pay card (M6-T22, F-1164)', () => {
  it('lists the call reps with the mockup figures and "No payout" for the AI agent', async () => {
    renderCard();
    const table = await screen.findByRole('table', { name: 'Call reps pay' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Call rep', 'Delivered orders', 'Commission', 'Upsell reward', 'Earned', 'Paid', 'Owed', 'Action']);
    const cells = within(within(table).getByText('Adwoa Darko').closest('tr')!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(1, 7)).toEqual(['253', 'GH₵2,024', 'GH₵610', 'GH₵2,634', 'GH₵600', 'GH₵2,034']);
    expect(within(within(table).getByText('Nana Kyei').closest('tr')!).getAllByRole('cell')[6]).toHaveTextContent('GH₵134');
    expect(within(within(table).getByText('Confirm agent').closest('tr')!).getByText('No payout')).toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: /Record payout for/ })).toHaveLength(2); // none for the AI agent
    expect(screen.getByText(/Commission is GH₵8 for each confirmed order/)).toHaveTextContent('10% of the extra value');
  });

  it('Record payout opens the one payout form with the rep id, and its owed entries are the pick-delivered-orders list', async () => {
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Record payout for Adwoa Darko' }));
    expect(await screen.findByText('Record payout for Adwoa Darko')).toBeInTheDocument();
    expect(pay.owed).toHaveBeenCalledWith(1);
    expect(pay.history).toHaveBeenCalledWith(1);
    const list = await screen.findByRole('region', { name: 'Owed entries' });
    const amount = screen.getByLabelText(/^Amount/) as HTMLInputElement;
    expect(amount.value).toBe('2034.00');
    await userEvent.click(within(list).getByRole('checkbox', { name: 'Pay Upsell reward of order 102' }));
    expect(amount.value).toBe('1424.00'); // the amount follows the ticked orders
    const toggle = screen.getByRole('button', { name: /Pick delivered orders to pay/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(screen.getByRole('region', { name: 'Owed entries' })).queryByRole('table')).toBeNull();
  });

  it('the Delivery agents tab is read only: delivered, failed, fees kept and cash held, no Owed and no payout', async () => {
    renderCard();
    await userEvent.click(await screen.findByRole('tab', { name: 'Delivery agents' }));
    const table = await screen.findByRole('table', { name: 'Delivery agents pay' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Delivery agent', 'Vehicle', 'Location', 'Fee rule', 'Delivered', 'Failed', 'Fees kept', 'Cash held']);
    const cells = within(within(table).getByText('Kofi Appiah').closest('tr')!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(1)).toEqual(['MotorbikeGR 1-23', 'Kumasi', 'GH₵25 delivered · GH₵5 failed', '82', '70', 'GH₵2,400', 'GH₵2,900']);
    expect(within(table).queryByRole('button')).toBeNull();
    expect(screen.queryByText('Owed')).toBeNull();
  });

  it('a role that may not read cash shows a dash for cash held', async () => {
    aging.mockRejectedValue(new Error('403'));
    renderCard();
    await userEvent.click(await screen.findByRole('tab', { name: 'Delivery agents' }));
    const table = await screen.findByRole('table', { name: 'Delivery agents pay' });
    const cells = within(within(table).getByText('Kofi Appiah').closest('tr')!).getAllByRole('cell');
    expect(cells[7]).toHaveTextContent('—');
  });

  it('the history tab shows the same rows as Finance', async () => {
    const { unmount } = renderCard();
    await userEvent.click(await screen.findByRole('tab', { name: /^Payout history/ }));
    const card = within(await screen.findByRole('table', { name: 'Payout history' }));
    const rowsOnCard = card.getAllByRole('row').map((r) => r.textContent);
    expect(rowsOnCard[1]).toBe('9 OctAdwoa DarkoGH₵600MoMoOctober commissionManny Owner');
    unmount();
    clearBlockCache();
    render(<RepCommissions />);
    const finance = within(await screen.findByRole('table', { name: 'Payout history' }));
    expect(finance.getAllByRole('row').map((r) => r.textContent)).toEqual(rowsOnCard);
  });
});
