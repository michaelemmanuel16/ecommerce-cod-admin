import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Reports } from '../../pages/Reports';
import { visibleTabs } from '../../pages/reports/tabs';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { reportsFixture, withoutCompare } from '../fixtures/reports';

const get = vi.fn();
vi.mock('../../services/reports.service', () => ({ reportsService: { get: (...a: unknown[]) => get(...a) } }));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPage(url = '/reports') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/reports" element={<Reports />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The text of every body row: the cells of each row that has any (the header row has none). */
const bodyRows = (table: HTMLElement) =>
  [...table.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.querySelector('.who b')?.textContent ?? c.textContent));

/** The API answers per tab; compare off unless the request asks for it. */
function answer(overrides: Partial<Record<'overview' | 'sales' | 'delivery', (body: any) => any>> = {}) {
  get.mockImplementation((tab: 'overview' | 'sales' | 'delivery', params: { compare: boolean }) => {
    const body = reportsFixture[tab]();
    const shaped = params.compare ? body : withoutCompare(body);
    return Promise.resolve(overrides[tab] ? overrides[tab]!(shaped) : shaped);
  });
}

const asRole = (role: string, permissions: Record<string, string[]>) =>
  useAuthStore.setState({
    user: { id: 1, role, firstName: 'Manny', lastName: 'A', isPlatformAdmin: false } as never,
    permissions,
    menu: ['dashboard', 'reports', 'deliveries'],
    homeRoute: '/',
  });

beforeEach(() => {
  get.mockReset();
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  asRole('admin', { analytics: ['view', 'export'], financial: ['view'] });
  answer();
});

describe('Reports shell (F-1050)', () => {
  it('shows the range label from the answer and the previous period when compare is on', async () => {
    renderPage();
    await screen.findByText('Delivered revenue');
    expect(document.querySelector('.rangetext b')).toHaveTextContent('1–17 Oct 2026');
    expect(screen.queryByText(/Previous period:/)).toBeNull();
    await userEvent.click(screen.getByLabelText('Compare to previous period'));
    expect(await screen.findByText('Previous period: 1–17 Sep 2026')).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith('overview', expect.objectContaining({ compare: true }), false));
  });

  it('has the five presets and shows date fields for Custom', async () => {
    renderPage();
    const presets = within(await screen.findByRole('group', { name: 'Date range' }));
    expect(presets.getAllByRole('button').map((b) => b.textContent)).toEqual(['Today', 'Last 7 days', 'This month', 'Last month', 'Custom']);
    expect(screen.queryByLabelText('From date')).toBeNull();
    await userEvent.click(presets.getByRole('button', { name: 'Custom' }));
    expect(screen.getByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
  });

  it('a preset asks for its own days', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Today' }));
    await waitFor(() => {
      const last = get.mock.calls.filter((c) => c[0] === 'overview').pop()!;
      expect(last[1].from).toBe(last[1].to);
    });
  });

  it('the tab bar follows the permission: Team for owner roles only; Products and Marketing never', async () => {
    renderPage();
    const bar = within(await screen.findByRole('tablist', { name: 'Reports' }));
    expect(bar.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Team performance']);
  });

  it('a finance clerk has no Team tab', async () => {
    asRole('accountant', { analytics: ['view'], financial: ['view'] });
    renderPage();
    const bar = within(await screen.findByRole('tablist', { name: 'Reports' }));
    expect(bar.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview']);
  });

  it('visibleTabs: marketing:view and financial:view do not show the unbuilt tabs', () => {
    const everything = () => true;
    expect(visibleTabs('super_admin', everything).map((t) => t.key)).toEqual(['overview', 'team']);
    expect(visibleTabs('manager', () => false)).toEqual([]);
    expect(visibleTabs(undefined, everything)).toEqual([]);
  });

  it('the Team tab is a slot and the Export button does nothing yet', async () => {
    renderPage('/reports?tab=team');
    expect(await screen.findByText('Team performance is not on this page yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('a range the server refuses shows its sentence', async () => {
    get.mockRejectedValue({ response: { data: { message: 'The range is over 366 days. Narrow it.' } } });
    renderPage();
    expect(await screen.findByText('The range is over 366 days. Narrow it.')).toBeInTheDocument();
  });
});

describe('Overview tab (F-1051)', () => {
  it('tiles: 1,445 / 1,026 / 376 / GH₵92,000 and no tile called Delivery rate', async () => {
    renderPage();
    const tiles = (await screen.findByText('Delivered revenue')).closest('.kpis') as HTMLElement;
    expect(within(tiles).getByText('1,445')).toBeInTheDocument();
    expect(within(tiles).getByText('1,026')).toBeInTheDocument();
    expect(within(tiles).getByText('376')).toBeInTheDocument();
    expect(within(tiles).getByText('GH₵92,000')).toBeInTheDocument();
    expect(within(tiles).getByText('Confirmation rate 71%, target 70%')).toBeInTheDocument();
    expect(within(tiles).getByText('Delivery success 48%, target 60%')).toBeInTheDocument();
    expect(screen.queryByText(/^Delivery rate$/i)).toBeNull();
  });

  it('compare shows the change chips against the previous period', async () => {
    renderPage();
    await screen.findByText('Delivered revenue');
    expect(screen.queryByText('vs 1,380')).toBeNull();
    await userEvent.click(screen.getByLabelText('Compare to previous period'));
    expect(await screen.findByText('vs 1,380')).toBeInTheDocument();
    expect(screen.getByText('vs 387')).toBeInTheDocument();
    expect(screen.getByText('vs GH₵96,000')).toBeInTheDocument();
    expect(screen.getAllByText('▲ 5%').length).toBeGreaterThan(0);
    expect(screen.getByText('▼ 3%')).toBeInTheDocument();
    expect(screen.getByText('▼ 4%')).toBeInTheDocument();
  });

  it('a previous period with nothing in it says no data', async () => {
    answer({ overview: (b) => { b.tiles.orders = { value: 1445, previous: 0, deltaPercent: null }; return b; } });
    renderPage();
    await screen.findByText('Delivered revenue');
    await userEvent.click(screen.getByLabelText('Compare to previous period'));
    expect(await screen.findByText('No data')).toBeInTheDocument();
  });

  it('"Where 1,445 orders ended up": seven rows that sum to the total, and the 48% / 34% note', async () => {
    renderPage();
    const card = (await screen.findByText('Where 1,445 orders ended up')).closest('.card') as HTMLElement;
    expect(card.querySelectorAll('.bar-row')).toHaveLength(7);
    const values = [...card.querySelectorAll('.bar-row .val')].map((v) => Number((v.textContent ?? '').replace(/,/g, '')));
    expect(values).toEqual([376, 354, 48, 148, 100, 64, 355]);
    expect(values.reduce((a, b) => a + b, 0)).toBe(1445);
    expect(within(card).getByText('48% success, 34% yield.')).toBeInTheDocument();
  });

  it('Daily breakdown has one row per day and a total', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Daily breakdown' });
    const rows = bodyRows(table);
    expect(rows).toHaveLength(17 + 1);
    expect(rows[17]).toEqual(['Total', '1,445', '1,026', '376', 'GH₵92,000']);
    expect(rows[0][0]).toBe('1 Oct');
  });

  it('the old pipeline funnel and area chart are gone', async () => {
    renderPage();
    await screen.findByText('Daily breakdown');
    expect(screen.queryByText(/order pipeline|delivery funnel|area distribution/i)).toBeNull();
  });

  it('one failed block shows its own Retry and the others stay', async () => {
    answer({ overview: (b) => { b.endedUp = { error: { code: 'block_failed', errorId: 'e2e-ended-up' } }; return b; } });
    renderPage();
    expect(await screen.findByText('Where orders ended up did not load')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    const tiles = screen.getByText('Delivered revenue').closest('.kpis') as HTMLElement;
    expect(within(tiles).getByText('1,026')).toBeInTheDocument();
  });
});
