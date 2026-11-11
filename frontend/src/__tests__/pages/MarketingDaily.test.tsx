import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Marketing } from '../../pages/Marketing';
import { DailyCard, DailyTip } from '../../pages/marketing/DailyCard';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { useConfigStore } from '../../stores/configStore';
import type { Daily, DailyRow } from '../../services/marketing.service';
import { campaignRow, funnel, mv, productRow, summary, totals } from '../fixtures/marketing';

// jsdom has no layout, so the responsive container gets a fixed size and the chart draws
vi.mock('recharts', async (orig) => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) => <div>{cloneElement(children, { width: 800, height: 260 } as object)}</div>,
}));

const svc = vi.hoisted(() => ({ summary: vi.fn(), funnel: vi.fn(), products: vi.fn(), campaigns: vi.fn(), unmapped: vi.fn(), daily: vi.fn() }));
const meta = vi.hoisted(() => ({ getAccounts: vi.fn() }));
vi.mock('../../services/marketing.service', () => ({ marketingService: svc }));
vi.mock('../../services/metaAds.service', () => ({ metaAdsService: meta }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => false }) }));

const row = (date: string, ngn: number, orders: number): DailyRow => ({
  date, spend: mv(ngn), waitingForRate: false, ordersPlaced: orders, costPerOrder: orders > 0 ? mv(ngn / orders) : null,
});
const daily = (over: Partial<Daily> = {}): Daily => ({
  from: '2026-10-15', to: '2026-10-17',
  days: [row('2026-10-15', 480000, 80), row('2026-10-16', 490000, 90), row('2026-10-17', 520000, 91)],
  best: { date: '2026-10-16', costPerOrder: mv(5450) },
  worst: { date: '2026-10-15', costPerOrder: mv(6000) },
  average: { spend: mv(496670), ordersPerDay: 87 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearBlockCache();
  useConfigStore.setState({ currency: 'GHS', loaded: true });
});

describe('DailyCard', () => {
  it('draws a bar for each day and the orders line, with the legend and the three boxes', () => {
    const { container } = render(<DailyCard daily={daily()} today="2026-10-17" />);
    expect(screen.getByText('Daily spend vs orders')).toBeInTheDocument();
    expect(screen.getByText('Spend (₦)')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(3);
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(1);
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(3);
    // The latest day is the dark bar, the others are muted
    const fills = [...container.querySelectorAll('.recharts-bar-rectangle path')].map((p) => p.getAttribute('fill-opacity'));
    expect(fills).toEqual(['0.32', '0.32', '1']);
    expect(screen.getByText('Best day').parentElement).toHaveTextContent('16 Oct');
    expect(screen.getByText('Best day').parentElement).toHaveTextContent('₦5,450 per order');
    expect(screen.getByText('Worst day').parentElement).toHaveTextContent('15 Oct₦6,000 per order');
    expect(screen.getByText('Average a day').parentElement).toHaveTextContent('₦496,670');
    expect(screen.getByText('Average a day').parentElement).toHaveTextContent('87 orders');
  });

  it('shows a small orders-a-day average with one decimal, not 0', () => {
    render(<DailyCard daily={daily({ average: { ...daily().average, ordersPerDay: 0.27 } })} today="2026-10-17" />);
    expect(screen.getByText('Average a day').parentElement).toHaveTextContent('0.3 orders');
  });

  it('hides the best and worst boxes when there is no day with spend and orders', () => {
    render(<DailyCard daily={daily({ best: null, worst: null })} today="2026-10-17" />);
    expect(screen.queryByText('Best day')).not.toBeInTheDocument();
    expect(screen.queryByText('Worst day')).not.toBeInTheDocument();
    expect(screen.getByText('Average a day')).toBeInTheDocument();
  });
});

describe('DailyTip', () => {
  const tip = (r: DailyRow, today = '2026-10-17') => render(
    <DailyTip active today={today} payload={[{ payload: { date: r.date, spend: 1, orders: r.ordersPlaced, text: r.spend.account === null ? null : '₦520,000', waiting: r.waitingForRate } }]} />,
  );

  it('says "Today, 17 Oct · ₦520,000 · 91 orders" for today and "16 Oct" for another day', () => {
    const { container, unmount } = tip(row('2026-10-17', 520000, 91));
    expect(container).toHaveTextContent('Today, 17 Oct');
    expect(container).toHaveTextContent('₦520,000 · 91 orders');
    unmount();
    const other = tip(row('2026-10-16', 520000, 1));
    expect(other.container).toHaveTextContent('16 Oct');
    expect(other.container).not.toHaveTextContent('Today');
    expect(other.container).toHaveTextContent('1 order');
  });

  it('says "Waiting for FX rate" for a day with no rate', () => {
    const waiting: DailyRow = { ...row('2026-10-17', 0, 2), spend: { store: null, account: null, accountCurrency: null, rate: null, rateDate: null }, waitingForRate: true, costPerOrder: null };
    const { container } = tip(waiting);
    expect(container).toHaveTextContent('Waiting for FX rate');
  });
});

describe('Marketing page daily block', () => {
  const account = { id: 1, accountId: '1', name: 'Main', currency: 'NGN', timezone: 'UTC', enabled: true, status: 'connected', lastPulledAt: null };
  const renderPage = () => render(<ToastProvider><MemoryRouter><Marketing /></MemoryRouter></ToastProvider>);
  const stub = () => {
    svc.summary.mockResolvedValue(summary());
    svc.funnel.mockResolvedValue(funnel());
    svc.products.mockResolvedValue([productRow()]);
    svc.campaigns.mockResolvedValue({ campaigns: [campaignRow('MG_win', 'Winning')], totals: totals() });
    svc.unmapped.mockResolvedValue({ campaigns: [], spendByCurrency: {} });
    svc.daily.mockResolvedValue(daily());
  };

  it('shows the card under the campaigns table and asks again when the period changes', async () => {
    meta.getAccounts.mockResolvedValue([account]);
    stub();
    renderPage();
    const card = (await screen.findByText('Daily spend vs orders')).closest('.card') as HTMLElement;
    const campaigns = screen.getByText('Campaigns').closest('.card') as HTMLElement;
    expect(campaigns.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(svc.daily).toHaveBeenCalledTimes(1);
    const { userEvent } = { userEvent: (await import('@testing-library/user-event')).default };
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'lastMonth');
    await waitFor(() => expect(svc.daily).toHaveBeenCalledTimes(2));
  });

  it('is not shown, and not asked for, when no Meta account is connected', async () => {
    meta.getAccounts.mockResolvedValue([]);
    stub();
    renderPage();
    expect(await screen.findByText('Meta Ads is not connected')).toBeInTheDocument();
    expect(screen.queryByText('Daily spend vs orders')).not.toBeInTheDocument();
    expect(svc.daily).not.toHaveBeenCalled();
  });
});
