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
        <Route path="/delivery-agents" element={<div>PARTNERS PAGE</div>} />
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
    expect(bar.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Sales & revenue', 'Delivery & operations', 'Team performance']);
  });

  it('a finance clerk has three tabs', async () => {
    asRole('accountant', { analytics: ['view'], financial: ['view'] });
    renderPage();
    const bar = within(await screen.findByRole('tablist', { name: 'Reports' }));
    expect(bar.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Sales & revenue', 'Delivery & operations']);
  });

  it('visibleTabs: marketing:view and financial:view do not show the unbuilt tabs', () => {
    const everything = () => true;
    expect(visibleTabs('super_admin', everything).map((t) => t.key)).toEqual(['overview', 'sales', 'delivery', 'team']);
    expect(visibleTabs('manager', () => false)).toEqual([]);
    expect(visibleTabs(undefined, everything)).toEqual([]);
  });

  it('the Team tab is a slot and the Export button does nothing yet', async () => {
    renderPage('/reports?tab=team');
    expect(await screen.findByText('Team performance is not on this page yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('the agent card is read-only: it names the partner below target and has no write button', async () => {
    renderPage();
    expect(await screen.findByText('Logiswift closes only 45% as delivered')).toBeInTheDocument();
    expect(screen.getByText(/Target 60%\. Logiswift takes 1\.4 days to dispatch and 3\.8 days to deliver\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Delivery report' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/reports?tab=delivery');
    expect(await screen.findByText('Delivery partners')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See partners' })).toHaveAttribute('href', '/delivery-agents');
  });

  it('a range the server refuses shows its sentence', async () => {
    get.mockImplementation((tab: string) => (tab === 'overview'
      ? Promise.reject({ response: { data: { message: 'The range is over 366 days. Narrow it.' } } })
      : Promise.resolve(reportsFixture.delivery())));
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

describe('Sales tab (F-1052, F-1064)', () => {
  const openSales = async () => {
    renderPage('/reports?tab=sales');
    await screen.findByText('Average order value');
  };

  it('tiles: delivered revenue, AOV, cash received, cash with partners', async () => {
    await openSales();
    const tiles = screen.getByText('Average order value').closest('.kpis') as HTMLElement;
    expect(within(tiles).getByText('GH₵92,000')).toBeInTheDocument();
    expect(within(tiles).getByText('GH₵245')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days GH₵248')).toBeInTheDocument();
    expect(screen.getByText('GH₵68.6k')).toBeInTheDocument();
    expect(screen.getByText('GH₵23.4k')).toBeInTheDocument();
    expect(screen.getByText('376 delivered orders')).toBeInTheDocument();
  });

  it('without financial:view the response has no cash tiles and the page shows two', async () => {
    answer({ sales: (b) => { delete b.tiles.cashReceived; delete b.tiles.cashWithPartners; return b; } });
    await openSales();
    expect(screen.queryByText('Cash received')).toBeNull();
    expect(screen.queryByText('Cash still with partners')).toBeNull();
  });

  it('the location table is City/Town, never Region, with Not set for an empty place and a total', async () => {
    answer({ sales: (b) => { b.byCity.rows[4].city = 'Unknown'; return b; } });
    await openSales();
    const table = await screen.findByRole('table', { name: 'Revenue by City/Town' });
    expect(within(table).getByRole('columnheader', { name: 'City/Town' })).toBeInTheDocument();
    const cells = bodyRows(table);
    expect(cells[0]).toEqual(['Accra', '176', 'GH₵43,100', 'GH₵245', '47%']);
    expect(cells[3]).toEqual(['Takoradi', '26', 'GH₵6,300', 'GH₵242', '7%']);
    expect(cells[4]).toEqual(['Not set', '0', 'GH₵0', 'n/a', '0%']);
    expect(cells[5]).toEqual(['Total', '376', 'GH₵92,000', 'GH₵245', '100%']);
    expect(document.body.textContent).not.toMatch(/region/i);
  });

  it('revenue by product: the donut lists the five products', async () => {
    await openSales();
    const card = (await screen.findByText('Revenue by product')).closest('.card') as HTMLElement;
    expect(within(card).getByText('Copybook set')).toBeInTheDocument();
    expect(within(card).getByText('GH₵76,100')).toBeInTheDocument();
    expect(within(card).getByText('Dictamni cream')).toBeInTheDocument();
  });
});

describe('Delivery tab (F-1053, F-1064)', () => {
  const openDelivery = async () => {
    renderPage('/reports?tab=delivery');
    await screen.findByText('Failed deliveries');
  };

  it('failed 354 and returned 48 are two numbers, not 402; success 48% of 778 closed', async () => {
    await openDelivery();
    const tiles = screen.getByText('Failed deliveries').closest('.kpis') as HTMLElement;
    expect(within(tiles).getByText('354')).toBeInTheDocument();
    expect(within(tiles).getByText('48 returned')).toBeInTheDocument();
    expect(within(tiles).getByText('376 of 778 closed, target 60%')).toBeInTheDocument();
    expect(within(tiles).getByText('48%')).toBeInTheDocument();
    expect(within(tiles).getByText('148')).toBeInTheDocument();
    expect(within(tiles).getByText('Logiswift pays in')).toBeInTheDocument();
    expect(within(tiles).getByText('9.2 days')).toBeInTheDocument();
    expect(within(tiles).queryByText('402')).toBeNull();
    expect(within(tiles).getByText(/41% of failed and returned not reachable/)).toBeInTheDocument();
  });

  it('reasons: 165, 96, 84, 57 with their shares', async () => {
    await openDelivery();
    const card = (await screen.findByText('Failed deliveries by reason')).closest('.card') as HTMLElement;
    const rows = [...card.querySelectorAll('.bar-row')].map((r) => r.textContent);
    expect(rows).toEqual(['Not reachable41% 165', 'Refused24% 96', 'Wrong address21% 84', 'Rescheduled14% 57']);
    expect(within(card).getByText('354 failed and 48 returned')).toBeInTheDocument();
  });

  it('partner table: Logiswift 45%, Kasapa has no closed orders yet, totals 926 / 376 / 402 / 148', async () => {
    await openDelivery();
    const table = await screen.findByRole('table', { name: 'Delivery partners' });
    const rows = bodyRows(table);
    expect(rows[0]).toEqual(['Logiswift', '590', '220', '270', '100', '45%', '1.4', '3.8', 'GH₵17,300', '9.2 days']);
    expect(rows[4]).toEqual(['Kasapa Express', '8', '0', '0', '8', 'No closed orders yet', '1', 'n/a', 'GH₵0', 'No payout yet']);
    expect(rows[5]).toEqual(['All partners', '926', '376', '402', '148', '48%', '', '', 'GH₵23,400', '']);
  });

  it('without financial:view the cash column is absent, not zero', async () => {
    answer({ delivery: (b) => { b.partners.rows.forEach((r: any) => delete r.cashHeld); delete b.partners.total.cashHeld; return b; } });
    await openDelivery();
    const table = await screen.findByRole('table', { name: 'Delivery partners' });
    expect(within(table).queryByRole('columnheader', { name: 'Cash held' })).toBeNull();
  });

  it('waiting and returns: 100 orders, oldest 3 days, 48 returned; city chart is City/Town', async () => {
    await openDelivery();
    expect(await screen.findByText('100 orders')).toBeInTheDocument();
    expect(screen.getByText('Oldest has waited 3 days')).toBeInTheDocument();
    expect(screen.getByText('Delivery success by City/Town')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Delivery success by city or town against the 60 percent target: Accra 48 percent/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/region/i);
  });

  it('a partner with no closed orders in the city chart is left out, not drawn as 0%', async () => {
    answer({ delivery: (b) => { b.successByCity.rows.push({ city: 'Cape Coast', placed: 8, delivered: 0, failed: 0, returned: 0, closed: 0, successRate: null }); return b; } });
    await openDelivery();
    expect(screen.getByRole('img', { name: /Takoradi 37 percent/ }).getAttribute('aria-label')).not.toMatch(/Cape Coast/);
  });
});
