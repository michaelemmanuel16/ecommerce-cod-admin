import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { RepCommissions } from '../../pages/financial/RepCommissions';
import { useConfigStore } from '../../stores/configStore';
import type { RepOwedRow } from '../../services/payouts.service';

const repsOwed = vi.fn();
const owed = vi.fn();
const history = vi.fn();
const recent = vi.fn();
vi.mock('../../services/payouts.service', () => ({
  payoutsService: { repsOwed: (...a: unknown[]) => repsOwed(...a), owed: (...a: unknown[]) => owed(...a), history: (...a: unknown[]) => history(...a), recentRepPayouts: (...a: unknown[]) => recent(...a), record: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
let canCreate = true;
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: (r: string, a: string) => (r === 'payouts' && a === 'create' ? canCreate : true) }) }));

const rep = (over: Partial<RepOwedRow>): RepOwedRow => ({
  id: 1, firstName: 'Adwoa', lastName: 'Mensah', delivered: 253,
  commission: '2024.00', upsellReward: '610.00', targetReward: '0.00', earned: '2634.00', paid: '600.00', paidInMonth: '600.00', owed: '2034.00', lastPayout: '2026-10-09T00:00:00Z', ...over,
});
const ROWS = [rep({}), rep({ id: 2, firstName: 'Nana', lastName: 'Boateng', delivered: 13, commission: '104.00', upsellReward: '30.00', earned: '134.00', paid: '0.00', paidInMonth: '0.00', owed: '134.00', lastPayout: null })];
// The server adds the rows up (Money): the browser only shows the totals
const DATA = { month: '2026-10', reps: ROWS, totals: { owed: '2168.00', paid: '600.00', paidInMonth: '600.00', repsOwed: 2 } };

beforeEach(() => {
  clearBlockCache();
  [repsOwed, owed, history, recent].forEach((m) => m.mockReset());
  canCreate = true;
  useConfigStore.setState({ currency: 'GHS' });
  repsOwed.mockResolvedValue(DATA);
  history.mockResolvedValue([]);
  recent.mockResolvedValue([{
    id: 9, payeeId: 1, kind: 'rep', amount: '600.00', method: 'MoMo', reference: 'October commission', payoutDate: '2026-10-09T00:00:00Z', notes: null,
    payee: { id: 1, firstName: 'Adwoa', lastName: 'Mensah' }, recordedBy: null, _count: { commissionEntries: 3 },
  }]);
  owed.mockResolvedValue({ payee: { id: 1, firstName: 'Adwoa', lastName: 'Mensah', kind: 'rep' }, commission: '2024.00', upsellReward: '610.00', targetReward: '0.00', earned: '2634.00', paid: '600.00', owed: '2034.00', entries: [] });
});

describe('Rep commissions tab (M5-T38, F-914)', () => {
  it('lists each rep with the mockup columns and shows the server totals (2,168)', async () => {
    render(<RepCommissions />);
    const table = await screen.findByRole('table', { name: 'Rep commissions' });
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Rep', 'Delivered', 'Commission', 'Upsell reward', 'Earned', expect.stringMatching(/^Paid in /), 'Owed', 'Target reward', 'Last payout', 'Action']);
    const adwoa = within(table).getByText('Adwoa Mensah').closest('tr')!;
    const cells = within(adwoa).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('253');
    expect(cells[2]).toHaveTextContent('GH₵2,024');
    expect(cells[3]).toHaveTextContent('GH₵610');
    expect(cells[4]).toHaveTextContent('GH₵2,634');
    expect(cells[5]).toHaveTextContent('GH₵600'); // paid in the month
    expect(cells[6]).toHaveTextContent('GH₵2,034');
    expect(cells[7]).toHaveTextContent('None yet'); // no target reward earned
    expect(cells[8]).toHaveTextContent('9 Oct');
    expect(within(adwoa).getByText('Human')).toBeInTheDocument();
    const nana = within(table).getByText('Nana Boateng').closest('tr')!;
    expect(within(nana).getAllByRole('cell')[6]).toHaveTextContent('GH₵134');
    expect(within(nana).getByText('No payout yet')).toBeInTheDocument();
    expect(screen.getByTestId('tile-owed')).toHaveTextContent('GH₵2,168');
    expect(screen.getByTestId('tile-paid-in-month')).toHaveTextContent('GH₵600');
    for (const label of ['Commission owed', 'Paid this month', 'Per delivered confirmed order', 'Target rewards earned']) {
      expect(screen.getByText(label, { selector: '.l' })).toBeInTheDocument();
    }
  });

  it('asks for this month with no month picker or inactive switch, and lists the payout history', async () => {
    render(<RepCommissions />);
    const history = await screen.findByRole('table', { name: 'Payout history' });
    expect(repsOwed).toHaveBeenCalledWith();
    expect(screen.queryByLabelText('Month')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Show inactive reps')).not.toBeInTheDocument();
    expect(within(history).getByText('October commission')).toBeInTheDocument();
    expect(within(history).getByText('MoMo')).toBeInTheDocument();
    expect(within(history).getByText('GH₵600')).toBeInTheDocument();
  });

  it('Record payout opens the payout form for that rep', async () => {
    render(<RepCommissions />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record payout for Adwoa Mensah' }));
    expect(await screen.findByText('Record payout for Adwoa Mensah')).toBeInTheDocument();
    expect(owed).toHaveBeenCalledWith(1);
  });

  it('without the payouts permission the buttons are disabled with a tooltip', async () => {
    canCreate = false;
    render(<RepCommissions />);
    const button = await screen.findByRole('button', { name: 'Record payout for Adwoa Mensah' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The reason shows as a tooltip on hover
    await userEvent.hover(button);
    expect((await screen.findAllByText('You do not have permission to record payouts.')).length).toBeGreaterThan(0);
  });

  it('shows why the list did not load', async () => {
    repsOwed.mockRejectedValue(new Error('x'));
    render(<RepCommissions />);
    expect(await screen.findByText('The rep commissions could not load.')).toBeInTheDocument();
  });
});
