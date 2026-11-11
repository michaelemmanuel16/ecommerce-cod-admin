import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Marketing } from '../../pages/Marketing';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { useConfigStore } from '../../stores/configStore';
import { campaignRow, funnel, productRow, summary, totals } from '../fixtures/marketing';

const svc = vi.hoisted(() => ({
  summary: vi.fn(), funnel: vi.fn(), products: vi.fn(), campaigns: vi.fn(), unmapped: vi.fn(), setPick: vi.fn(), addRule: vi.fn(),
}));
const meta = vi.hoisted(() => ({ getAccounts: vi.fn() }));
vi.mock('../../services/marketing.service', () => ({ marketingService: svc }));
vi.mock('../../services/metaAds.service', () => ({ metaAdsService: meta }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: vi.fn().mockResolvedValue([]) } }));

let canUpdate = false;
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (r: string, a: string) => r === 'marketing' && (a === 'view' || canUpdate) }),
}));

const account = { id: 1, accountId: '1', name: 'Main', currency: 'NGN', timezone: 'UTC', enabled: true, status: 'connected', lastPulledAt: new Date(Date.now() - 3 * 3600_000).toISOString() };

const renderPage = () => render(
  <ToastProvider>
    <MemoryRouter initialEntries={['/marketing']}>
      <Routes>
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/settings" element={<div>SETTINGS PAGE</div>} />
      </Routes>
    </MemoryRouter>
  </ToastProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  clearBlockCache();
  canUpdate = false;
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  meta.getAccounts.mockResolvedValue([account]);
  svc.summary.mockResolvedValue(summary());
  svc.funnel.mockResolvedValue(funnel());
  svc.products.mockResolvedValue([productRow()]);
  svc.campaigns.mockResolvedValue({
    campaigns: [
      campaignRow('MG_win', 'Winning'), campaignRow('MG_track', 'On track'), campaignRow('MG_over', 'Over max CPA'),
      campaignRow('XX_none', 'Not mapped'), campaignRow('MG_paused', 'Paused'),
      campaignRow('MG_nodata', null, { maxCpa: { available: false, yieldPct: null, profitBeforeAds: null, maxCpa: null, message: 'Not enough closed orders', closedOrders: 3 }, lowData: true }),
    ],
    totals: totals(),
  });
  svc.unmapped.mockResolvedValue({ campaigns: [], spendByCurrency: {} });
});

describe('Marketing page', () => {
  it('shows the Meta line and the tiles with the account figure first and the store figure under it', async () => {
    renderPage();
    expect(await screen.findByText(/Meta account: connected/)).toBeInTheDocument();
    expect(screen.getByText(/pulled about 3 hours ago/)).toBeInTheDocument();
    const spend = (await screen.findByText('Ad spend')).closest('.kpi') as HTMLElement;
    expect(within(spend).getByText('₦8,530,000')).toBeInTheDocument();
    expect(within(spend).getByText(/About GH₵76,160\.71 \(₦112 = GH₵1\)/)).toBeInTheDocument();
    const max = screen.getByText('Max CPA', { selector: '.kpi .l' }).closest('.kpi') as HTMLElement;
    expect(within(max).getByText('₦7,040')).toBeInTheDocument();
    expect(within(max).getByText('At 34% yield')).toBeInTheDocument();
    expect(screen.getByText('Projected cost per delivered order').closest('.kpi')).toHaveTextContent('₦17,360');
    expect(screen.getByText('Actual, delivered in range').closest('.kpi')).toHaveTextContent('₦22,686');
    expect(screen.getByText('Order-to-cash yield').closest('.kpi')).toHaveTextContent('34%');
  });

  it('shows the change against the previous period under each tile', async () => {
    renderPage();
    const spend = (await screen.findByText('Ad spend')).closest('.kpi') as HTMLElement;
    expect(within(spend).getByText(/▲ 22%/)).toBeInTheDocument(); // 8.53M vs 7M
    expect(within(spend).getByText(/vs ₦7,000,000/)).toBeInTheDocument();
    const projected = screen.getByText('Projected cost per delivered order').closest('.kpi') as HTMLElement;
    expect(within(projected).getByText(/▼ 13%/)).toBeInTheDocument();
    const yieldTile = screen.getByText('Order-to-cash yield').closest('.kpi') as HTMLElement;
    expect(within(yieldTile).getByText(/▲ 4 pts/)).toBeInTheDocument();
  });

  it('shows the API message where a value is null, and the FX wait note', async () => {
    svc.summary.mockResolvedValue(summary({
      spendDaysWaitingForRate: 2,
      projectedCostPerDelivered: { value: null, message: 'Not enough closed orders' },
      maxCpa: { available: true, yieldPct: 0, profitBeforeAds: null, maxCpa: null, message: 'No room for ads at this price', closedOrders: 50 },
    }));
    renderPage();
    expect(await screen.findByText('No room for ads at this price')).toBeInTheDocument();
    expect(screen.getByText('Projected cost per delivered order').closest('.kpi')).toHaveTextContent('Not enough closed orders');
    expect(screen.getByText('2 days wait for an FX rate')).toBeInTheDocument();
  });

  it('shows the funnel steps with the step-to-step percent, and re-asks for one product', async () => {
    renderPage();
    expect(await screen.findByText('Landing page views', { selector: '.fl' })).toBeInTheDocument();
    const steps = [...document.querySelectorAll('.fs')].map((s) => s.textContent);
    expect(steps[0]).toContain('100,000');
    expect(steps[1]).toContain('2%'); // 2,000 of 100,000
    expect(steps[6]).toContain('33%'); // 100 of 300
    await userEvent.selectOptions(screen.getByLabelText('Product'), 'Magic Groove');
    await waitFor(() => expect(svc.funnel).toHaveBeenLastCalledWith(expect.anything(), 7));
  });

  it('shows the per-product table', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Marketing by product' });
    expect(within(table).getByText('Magic Groove')).toBeInTheDocument();
    expect(within(table).getByText('₦500,000')).toBeInTheDocument();
    expect(within(table).getByText('₦5,000')).toBeInTheDocument();
  });

  it('shows a status chip per status, and the max CPA message when the status is null', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Campaigns' });
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement;
    expect(within(row('MG_win')).getByText('Winning')).toHaveClass('ok');
    expect(within(row('MG_track')).getByText('On track')).toBeInTheDocument();
    expect(within(row('MG_over')).getByText('Over max CPA')).toHaveClass('bad');
    expect(within(row('XX_none')).getAllByText('Not mapped')[0]).toBeInTheDocument();
    expect(within(row('MG_paused')).getByText('Paused')).toBeInTheDocument();
    expect(within(row('MG_nodata')).getByText('Not enough closed orders')).toBeInTheDocument();
    expect(within(row('MG_nodata')).getByText('Low data')).toBeInTheDocument();
    expect(within(table).getByText('Projected delivered')).toHaveAttribute('title', 'Meta purchases x product yield');
  });

  it('puts Status right after Product, before Spend', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Campaigns' });
    const heads = [...table.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(heads.slice(0, 4)).toEqual(['Campaign', 'Product', 'Status', 'Spend']);
  });

  it('shows naira as whole numbers and keeps the store currency decimals', async () => {
    svc.products.mockResolvedValue([productRow({ costPerPlaced: { account: '427063.62', accountCurrency: 'NGN', store: '3813.07' } })]);
    svc.campaigns.mockResolvedValue({
      campaigns: [campaignRow('MG_win', 'Winning', { cpa: { account: '8714.29', accountCurrency: 'NGN', store: '77.81' } })],
      totals: totals(),
    });
    renderPage();
    const products = await screen.findByRole('table', { name: 'Marketing by product' });
    expect(within(products).getByText('₦427,064')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Campaigns' });
    expect(within(table).getByText('₦8,714')).toBeInTheDocument();
    expect(table.textContent).not.toMatch(/₦[\d,]+\.\d\d/);
    expect(screen.getByText(/About GH₵76,160\.71/)).toBeInTheDocument();
  });

  it('shows the Meta line with no space before the comma', async () => {
    renderPage();
    const line = (await screen.findByText(/Meta account: connected/)).closest('.conn') as HTMLElement;
    expect(line.textContent).toMatch(/Meta account: connected, pulled about 3 hours ago/);
    expect(line.querySelector('small')!.previousSibling).toHaveProperty('nodeValue', 'connected');
  });

  it('shows the totals row and the note', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Campaigns' });
    const foot = table.querySelector('tfoot tr') as HTMLElement;
    expect(foot).toHaveTextContent('Total');
    expect(foot).toHaveTextContent('₦900,000');
    expect(foot).toHaveTextContent('9,000');
    expect(foot).toHaveTextContent('20.1');
    expect(screen.getByText(/Max CPA is profit per delivered order before ads times the product's yield/)).toBeInTheDocument();
  });

  it('shows one empty state with a Connect link and asks for nothing else when there is no Meta account', async () => {
    meta.getAccounts.mockResolvedValue([]);
    renderPage();
    const link = await screen.findByRole('link', { name: 'Connect Meta Ads' });
    expect(link).toHaveAttribute('href', '/settings?tab=integrations&section=meta-ads');
    expect(screen.queryByText('Ad spend')).not.toBeInTheDocument();
    expect(svc.summary).not.toHaveBeenCalled();
    expect(svc.campaigns).not.toHaveBeenCalled();
  });

  it('asks again for the new dates when the period changes', async () => {
    renderPage();
    await screen.findByText('Ad spend');
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'Today');
    await waitFor(() => expect(svc.summary).toHaveBeenCalledTimes(2));
    const [a, b] = svc.summary.mock.calls.map((c) => c[0]);
    expect(b.from).toBe(b.to);
    expect(a.from).not.toBe(b.from);
  });
});
