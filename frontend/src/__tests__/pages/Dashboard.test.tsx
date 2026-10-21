import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fixture from '../fixtures/ownerDashboard.json';
import { Dashboard } from '../../pages/Dashboard';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { REFETCH_EVENTS, SOCKET_REFETCH_MS } from '../../pages/dashboard/useOwnerDashboard';

const getOwner = vi.fn();
vi.mock('../../services/dashboard.service', () => ({ dashboardService: { getOwner: (...a: unknown[]) => getOwner(...a) } }));
const handlers = new Map<string, () => void>();
const socket = { on: vi.fn((e: string, h: () => void) => handlers.set(e, h)), off: vi.fn() };
vi.mock('../../services/socket', () => ({ getSocket: () => socket }));

const data = () => JSON.parse(JSON.stringify(fixture));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/orders/:id" element={<div>ORDER PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getOwner.mockReset();
  handlers.clear();
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({
    user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A', isPlatformAdmin: false } as never,
    menu: ['dashboard', 'orders', 'finance', 'reports', 'deliveries'],
    homeRoute: '/',
  });
});

describe('Dashboard data state (M3-T39, M3-T40)', () => {
  it('header: greeting, sub-line, update time, no Download report', async () => {
    getOwner.mockResolvedValue(data());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Good evening, Manny' })).toBeInTheDocument();
    expect(screen.getByText(/Saturday 17 October\. You need GH₵2,100 more delivered revenue today to stay on pace\./)).toBeInTheDocument();
    expect(screen.getByText('Updated 06:42')).toBeInTheDocument();
    expect(screen.queryByText(/download report/i)).toBeNull();
  });

  it('range menu has the 7 choices and a change refetches with that range', async () => {
    getOwner.mockResolvedValue(data());
    renderPage();
    const select = await screen.findByLabelText('Period');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Today', 'This week', 'This month', 'Last 7 days', 'Last 30 days', 'This quarter', 'This year',
    ]);
    await userEvent.selectOptions(select, 'last_7_days');
    await waitFor(() => expect(getOwner).toHaveBeenLastCalledWith('last_7_days', false));
  });

  it('refresh asks the server for fresh data', async () => {
    getOwner.mockResolvedValue(data());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(getOwner).toHaveBeenLastCalledWith('month', true));
  });

  it('ladder: 3 pts behind, tags, days left, today target', async () => {
    getOwner.mockResolvedValue(data());
    renderPage();
    expect(await screen.findByText("3 pts behind the year's pace")).toBeInTheDocument();
    expect(screen.getByText('GH₵1.38M')).toBeInTheDocument();
    expect(screen.getByText('of GH₵1,800,000 this year')).toBeInTheDocument();
    expect(screen.getByText('Behind')).toBeInTheDocument();
    expect(screen.getByText('Off track')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('of GH₵540,000 · 75 days left')).toBeInTheDocument();
    expect(screen.getByText(/of GH₵6,300 · 17 delivered so far/)).toBeInTheDocument();
    expect(screen.getByText('Q4 target')).toBeInTheDocument();
    expect(screen.getByText('October target')).toBeInTheDocument();
  });

  it('quests: Hit and progress, on-target days, no XP / level / streak', async () => {
    getOwner.mockResolvedValue(data());
    const { container } = renderPage();
    expect(await screen.findByText('Hit')).toBeInTheDocument();
    expect(screen.getByText('64 of 56 orders')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('On target 14 of 17 days this month')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bXP\b|\blevel\b|streak/i);
  });

  it('tiles: 71% / 48% / GH₵23.4k', async () => {
    getOwner.mockResolvedValue(data());
    renderPage();
    expect(await screen.findByText('71%')).toBeInTheDocument();
    expect(screen.getByText('48%')).toBeInTheDocument();
    expect(screen.getByText('GH₵23.4k')).toBeInTheDocument();
    expect(screen.getByText('Target 60% · yield 34%')).toBeInTheDocument();
    expect(screen.getByText('▼ 12 pts')).toBeInTheDocument();
    expect(screen.getByText('▲ 18% vs last Sat')).toBeInTheDocument();
  });

  it('chart has a screen-reader summary; driver cards show the API figures', async () => {
    getOwner.mockResolvedValue(data());
    renderPage();
    const chart = await screen.findByRole('img', { name: /Delivered revenue for October/ });
    expect(chart.getAttribute('aria-label')).toMatch(/GH₵92k delivered so far of GH₵180,000/);
    expect(chart.getAttribute('aria-label')).toMatch(/behind the target pace/);
    expect(screen.getByText('Projected October')).toBeInTheDocument();
    expect(screen.getByText('GH₵164k')).toBeInTheDocument();
    expect(screen.getByText("91% of target at today's rate")).toBeInTheDocument();
    expect(screen.getByText('GH₵6.3k')).toBeInTheDocument();
    expect(screen.getByText('for the last 14 days')).toBeInTheDocument();
    expect(screen.getByText('Delivery success')).toBeInTheDocument();
    expect(screen.getByText('+5 pts = +GH₵22k this month')).toBeInTheDocument();
  });

  it('recent orders: a row opens the order page', async () => {
    getOwner.mockResolvedValue(data());
    renderPage();
    const row = (await screen.findByText('#24117')).closest('tr')!;
    expect(within(row).getByText('Delivered')).toBeInTheDocument();
    await userEvent.click(row);
    expect(await screen.findByText('ORDER PAGE')).toBeInTheDocument();
  });

  it('every figure has an info tooltip with name, formula and date basis', async () => {
    getOwner.mockResolvedValue(data());
    renderPage();
    const button = await screen.findByRole('button', { name: /About Confirmation rate/ });
    await userEvent.hover(button);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Confirmation rate');
    expect(tip).toHaveTextContent('Formula');
    expect(tip).toHaveTextContent('Date basis');
  });

  it('permission-trimmed response: no cash tile, no recent orders block', async () => {
    const d = data();
    delete d.tiles.cash;
    delete d.recentOrders;
    getOwner.mockResolvedValue(d);
    renderPage();
    expect(await screen.findByText('Confirmation rate')).toBeInTheDocument();
    expect(screen.queryByText('Cash still with agents')).toBeNull();
    expect(screen.queryByText('Recent orders')).toBeNull();
  });
});

describe('Dashboard loading and error states (M3-T40)', () => {
  it('shows a skeleton per block while loading', () => {
    getOwner.mockReturnValue(new Promise(() => {}));
    renderPage();
    for (const name of ['Target ladder', "Today's targets", 'Driver tiles', 'Chart', 'Driver cards', 'Recent orders']) {
      expect(screen.getByLabelText(`Loading ${name}`)).toHaveAttribute('aria-busy', 'true');
    }
  });

  it('one failed block shows its own error with Retry; the others stay', async () => {
    const d = data();
    d.tiles = { error: { code: 'block_failed', errorId: 'abcdef12-0000' } };
    getOwner.mockResolvedValueOnce(d);
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Driver tiles did not load');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('GH₵1.38M')).toBeInTheDocument();
    expect(screen.getByText('#24117')).toBeInTheDocument();
    getOwner.mockResolvedValueOnce(data());
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('71%')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed request with no data shows an error with Retry in every block', async () => {
    getOwner.mockRejectedValueOnce(new Error('network'));
    renderPage();
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(3));
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(3);
  });
});

describe('socket refetch (F-201)', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('refetches at most once every 5 seconds', async () => {
    getOwner.mockResolvedValue(data());
    renderPage();
    await vi.advanceTimersByTimeAsync(10);
    expect(getOwner).toHaveBeenCalledTimes(1);
    expect([...REFETCH_EVENTS]).toEqual(expect.arrayContaining(['order:status_changed', 'delivery:completed', 'payment:received', 'bulk_import_completed']));
    const fire = handlers.get('order:status_changed')!;
    // inside the window: collapses into one trailing fetch
    act(() => { fire(); fire(); fire(); });
    await vi.advanceTimersByTimeAsync(100);
    expect(getOwner).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SOCKET_REFETCH_MS);
    expect(getOwner).toHaveBeenCalledTimes(2);
    // after the window: goes out at once
    await vi.advanceTimersByTimeAsync(SOCKET_REFETCH_MS + 100);
    act(() => { fire(); });
    await vi.advanceTimersByTimeAsync(10);
    expect(getOwner).toHaveBeenCalledTimes(3);
  });
});
