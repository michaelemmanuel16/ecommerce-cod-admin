import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepCommissions } from '../../pages/financial/RepCommissions';
import { useConfigStore } from '../../stores/configStore';
import type { RepOwedRow } from '../../services/payouts.service';

const repsOwed = vi.fn();
const owed = vi.fn();
const history = vi.fn();
vi.mock('../../services/payouts.service', () => ({
  payoutsService: { repsOwed: (...a: unknown[]) => repsOwed(...a), owed: (...a: unknown[]) => owed(...a), history: (...a: unknown[]) => history(...a), record: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
let canCreate = true;
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: (r: string, a: string) => (r === 'payouts' && a === 'create' ? canCreate : true) }) }));

const rep = (over: Partial<RepOwedRow>): RepOwedRow => ({
  id: 1, firstName: 'Adwoa', lastName: 'Mensah', role: 'sales_rep', isActive: true, delivered: 253,
  commission: '2024.00', upsellReward: '610.00', targetReward: '0.00', earned: '2634.00', paid: '600.00', owed: '2034.00', lastPayout: '2026-10-09T00:00:00Z', ...over,
});
const ROWS = [rep({}), rep({ id: 2, firstName: 'Nana', lastName: 'Boateng', delivered: 13, commission: '104.00', upsellReward: '30.00', earned: '134.00', paid: '0.00', owed: '134.00', lastPayout: null })];

beforeEach(() => {
  [repsOwed, owed, history].forEach((m) => m.mockReset());
  canCreate = true;
  useConfigStore.setState({ currency: 'GHS' });
  repsOwed.mockResolvedValue(ROWS);
  history.mockResolvedValue([]);
  owed.mockResolvedValue({ payee: { id: 1, firstName: 'Adwoa', lastName: 'Mensah', role: 'sales_rep', kind: 'rep' }, commission: '2024.00', upsellReward: '610.00', targetReward: '0.00', earned: '2634.00', paid: '600.00', owed: '2034.00', entries: [] });
});

describe('Rep commissions tab (M5-T38, F-914)', () => {
  it('lists each rep with what is owed and adds the owed tile (2,034 + 134 = 2,168)', async () => {
    render(<RepCommissions />);
    const table = await screen.findByRole('table', { name: 'Rep commissions' });
    const adwoa = within(table).getByText('Adwoa Mensah').closest('tr')!;
    expect(within(adwoa).getByText('GH₵2,034')).toBeInTheDocument();
    expect(within(adwoa).getByText('253')).toBeInTheDocument();
    const nana = within(table).getByText('Nana Boateng').closest('tr')!;
    expect(within(nana).getAllByRole('cell')[7]).toHaveTextContent('GH₵134'); // the Owed column
    expect(within(nana).getByText('—')).toBeInTheDocument(); // no payout yet
    expect(screen.getByTestId('tile-owed')).toHaveTextContent('GH₵2,168');
  });

  it('Record payout opens the payout form for that rep', async () => {
    render(<RepCommissions />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record payout for Adwoa Mensah' }));
    expect(await screen.findByText('Record payout: Adwoa Mensah')).toBeInTheDocument();
    expect(owed).toHaveBeenCalledWith(1);
  });

  it('without the payouts permission the buttons are disabled with a tooltip', async () => {
    canCreate = false;
    render(<RepCommissions />);
    const button = await screen.findByRole('button', { name: 'Record payout for Adwoa Mensah' });
    expect(button).toBeDisabled();
    await userEvent.hover(button.parentElement!);
    expect(await screen.findAllByText('You need the payouts permission to record a payout')).not.toHaveLength(0);
  });

  it('shows why the list did not load', async () => {
    repsOwed.mockRejectedValue(new Error('x'));
    render(<RepCommissions />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The rep commissions could not load.');
  });
});
