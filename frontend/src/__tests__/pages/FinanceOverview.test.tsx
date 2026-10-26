import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FinanceOverview } from '../../pages/financial/overview/FinanceOverview';
import { useConfigStore } from '../../stores/configStore';
import { useFinancialStore } from '../../stores/financialStore';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { OVERVIEW } from '../fixtures/financeOverview';
import type { FinanceOverview as Overview, Tile } from '../../services/finance-overview.service';

const get = vi.fn();
vi.mock('../../services/finance-overview.service', async (orig) => ({
  ...(await orig<typeof import('../../services/finance-overview.service')>()),
  financeOverviewService: { get: (...a: unknown[]) => get(...a) },
}));

const renderPage = () => render(<FinanceOverview />);
const tile = async (label: string) => (await screen.findByText(label, { selector: '.kpi .l .lbl' })).closest('.kpi') as HTMLElement;
const withTiles = (fn: (t: Tile[]) => Tile[]): Overview => ({ ...OVERVIEW, tiles: fn(OVERVIEW.tiles) });
const setRevenueTarget = (target: null) => withTiles((tiles) => tiles.map((t) => (t.key === 'deliveredRevenue' && t.status === 'ok' ? { ...t, detail: { ...t.detail, target } } : t)));

beforeEach(() => {
  clearBlockCache();
  useFinancialStore.setState({ dateRange: { startDate: '2026-10-01', endDate: '2026-10-17' } });
  get.mockReset();
  get.mockResolvedValue(OVERVIEW);
  useConfigStore.setState({ currency: 'GHS', loaded: true });
});

describe('Finance Overview (M5-T34)', () => {
  it('shows the six tiles with the PRD numbers', async () => {
    renderPage();
    expect(await tile('Delivered revenue')).toHaveTextContent('GH₵92,000');
    expect(await tile('Delivered revenue')).toHaveTextContent('376 orders');
    expect(await tile('Cash received')).toHaveTextContent('GH₵13,016');
    expect(await tile('Cash outstanding')).toHaveTextContent('GH₵23,400');
    expect(await tile('Net margin')).toHaveTextContent('-16%');
    expect(await tile('Profit per delivered order')).toHaveTextContent('-GH₵37.95');
    expect(await tile('Cash runway, in days of ads')).toHaveTextContent('9 days');
    expect(await tile('Cash runway, in days of ads')).toHaveTextContent('GH₵41,900 cash ÷ GH₵4,500 ads a day');
  });

  it('shows the revenue target and its tag, and the by-product line of profit per order', async () => {
    renderPage();
    const rev = await tile('Delivered revenue');
    expect(rev).toHaveTextContent('Target GH₵180k');
    expect(rev).toHaveTextContent('Off track');
    expect(await tile('Profit per delivered order')).toHaveTextContent('Magic Groove copybook set GH₵180.32 before ads and rep commission');
  });

  it('with no target there is no target text or tag', async () => {
    get.mockResolvedValue(setRevenueTarget(null));
    renderPage();
    const rev = await tile('Delivered revenue');
    expect(rev).not.toHaveTextContent('Target');
    expect(rev).not.toHaveTextContent('Off track');
    expect(rev).toHaveTextContent('376 orders');
  });

  it('shows the digital line and the Paystack fee line', async () => {
    renderPage();
    expect(await tile('Delivered revenue')).toHaveTextContent('Of which digital GH₵59');
    expect(await tile('Net margin')).toHaveTextContent('of which Paystack fees GH₵1.50');
    expect(await tile('Net margin')).toHaveTextContent('Loss GH₵14,268');
  });

  it('never shows 26% or a delivery rate', async () => {
    renderPage();
    await tile('Net margin');
    expect(document.body.textContent).not.toMatch(/26%|delivery rate/i);
  });

  it('the tooltip carries the date basis', async () => {
    renderPage();
    const t = await tile('Delivered revenue');
    await userEvent.hover(within(t).getByRole('img', { name: 'About Delivered revenue' }));
    expect(within(t).getByRole('tooltip')).toHaveTextContent('By delivery date. Orders delivered 1 Oct to 17 Oct.');
  });

  it('shows n/a for a figure with no basis', async () => {
    get.mockResolvedValue(withTiles((tiles) => tiles.map((t) => (t.key === 'netMargin' && t.status === 'ok' ? { ...t, value: 'n/a', badge: null } : t))));
    renderPage();
    expect(await tile('Net margin')).toHaveTextContent('n/a');
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it('a failed tile shows its own error while the others load', async () => {
    get.mockResolvedValue(withTiles((tiles) => tiles.map((t) => (t.key === 'cashReceived' ? { key: t.key, label: t.label, status: 'error' as const, message: 'This could not be loaded. Try again.' } : t))));
    renderPage();
    expect(await tile('Delivered revenue')).toHaveTextContent('GH₵92,000');
    expect(await screen.findByRole('alert')).toHaveTextContent('This could not be loaded');
    expect(await tile('Cash runway, in days of ads')).toHaveTextContent('9 days');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('lists the payouts with Matched, Short and Over', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Payout reconciliation' });
    expect(within(table).getByText('Short GH₵840')).toBeInTheDocument();
    expect(within(table).getByText('Matched')).toBeInTheDocument();
    expect(within(table).getByText('Over GH₵100')).toBeInTheDocument();
    expect(within(table).getByText('3PL')).toBeInTheDocument();
    expect(within(table).getAllByText('Agent')).toHaveLength(2);
  });

  it('a Short row expands to its unpaid orders and collapses again', async () => {
    renderPage();
    const open = await screen.findByRole('button', { name: /Show unpaid orders/ });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/#24098 · Ama Nkrumah/)).toBeInTheDocument();
    expect(screen.getByText(/GH₵249 less GH₵35 fee/)).toBeInTheDocument();
    expect(screen.getByText('GH₵214')).toBeInTheDocument();
    expect(screen.getByText(/3 unpaid orders, GH₵840 in all/)).toBeInTheDocument();
    await userEvent.click(open);
    expect(screen.queryByText(/#24098/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /unpaid orders/ })).toHaveLength(1); // only the Short row has one
  });

  it('follows the Finance date control: the range goes to the API and a new range asks again', async () => {
    renderPage();
    await tile('Delivered revenue');
    expect(get).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-17' });
    act(() => useFinancialStore.getState().setDateRange('2026-10-05', '2026-10-12'));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenLastCalledWith({ from: '2026-10-05', to: '2026-10-12' });
  });

  it('turns the default end of day instant into a store day', async () => {
    useFinancialStore.setState({ dateRange: { startDate: '2026-10-01', endDate: new Date(2026, 9, 17, 23, 59, 59).toISOString() } });
    renderPage();
    await tile('Delivered revenue');
    expect(get).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-17' });
  });

  it('shows an empty state when no payout fell in the range', async () => {
    get.mockResolvedValue({ ...OVERVIEW, reconciliation: { ...OVERVIEW.reconciliation, rows: [], counts: { matched: 0, short: 0, over: 0, unmatched: 0 } } });
    renderPage();
    expect(await screen.findByText('No payouts in these dates')).toBeInTheDocument();
  });

  it('a failed reconciliation shows its own error and the tiles still load', async () => {
    get.mockResolvedValue({ ...OVERVIEW, reconciliation: { status: 'error', message: 'This could not be loaded. Try again.' } });
    renderPage();
    expect(await tile('Delivered revenue')).toHaveTextContent('GH₵92,000');
    expect(await screen.findByText('The payouts could not load')).toBeInTheDocument();
  });

  it('a failed call shows an error with Try again', async () => {
    get.mockRejectedValueOnce(new Error('network'));
    renderPage();
    expect(await screen.findByText('The Finance overview did not load')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await tile('Delivered revenue')).toHaveTextContent('GH₵92,000');
  });
});
