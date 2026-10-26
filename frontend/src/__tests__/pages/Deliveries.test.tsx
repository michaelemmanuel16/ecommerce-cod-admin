import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Deliveries } from '../../pages/Deliveries';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { LIST, PARTNERS, REASONS, RETURNS, SUMMARY, WAITING } from '../fixtures/deliveriesList';

const list = vi.fn();
const summary = vi.fn();
const failureReasons = vi.fn();
const waiting = vi.fn();
const returnsSummary = vi.fn();
vi.mock('../../services/delivery-partners.service', async (orig) => ({
  ...(await orig<typeof import('../../services/delivery-partners.service')>()),
  deliveryPartnersService: {
    list: (...a: unknown[]) => list(...a),
    summary: (...a: unknown[]) => summary(...a),
    failureReasons: (...a: unknown[]) => failureReasons(...a),
    waiting: (...a: unknown[]) => waiting(...a),
    returnsSummary: (...a: unknown[]) => returnsSummary(...a),
  },
}));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPage(url = '/delivery-agents') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Where />
        <Routes>
          <Route path="/delivery-agents" element={<Deliveries />} />
          <Route path="/orders" element={<div>ORDERS PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  [list, summary, failureReasons, waiting, returnsSummary].forEach((m) => m.mockReset());
  list.mockImplementation((_range: unknown, type: string) =>
    Promise.resolve({ ...LIST, type, rows: type === 'all' ? PARTNERS : PARTNERS.filter((p) => p.type === type) }));
  summary.mockResolvedValue(SUMMARY);
  failureReasons.mockResolvedValue(REASONS);
  waiting.mockResolvedValue(WAITING);
  returnsSummary.mockResolvedValue(RETURNS);
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A' } as never, permissions: {} });
});

describe('Deliveries page (M4-T30)', () => {
  it('shows the five tiles from the summary', async () => {
    renderPage();
    const tile = async (label: string) => (await screen.findByText(label, { selector: '.kpi .l' })).closest('.kpi') as HTMLElement;
    expect(await tile('Out for delivery now')).toHaveTextContent('148');
    expect(await tile('Waiting to dispatch')).toHaveTextContent('100');
    expect(await tile('Delivered this month')).toHaveTextContent('376');
    expect(screen.getByText('12 pts under')).toBeInTheDocument();
    expect(screen.getByText('Cash still with agents and 3PLs')).toBeInTheDocument();
  });

  it('a tab click reloads only the table (F10)', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Delivery partners' });
    const before = [list, summary, failureReasons, waiting, returnsSummary].map((m) => m.mock.calls.length);
    await userEvent.click(screen.getByRole('tab', { name: /3PLs/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(before[0] + 1));
    expect([summary, failureReasons, waiting, returnsSummary].map((m) => m.mock.calls.length)).toEqual(before.slice(1));
  });

  it('draws the table with a total row and the tab counts', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Delivery partners' });
    expect(within(table).getByText('Logiswift')).toBeInTheDocument();
    expect(within(table).getByText('GH₵35 · GH₵0 · GH₵0')).toBeInTheDocument();
    expect(within(table).getAllByText('No fee rule')).toHaveLength(2);
    expect(within(table).getByText('No closed orders yet')).toBeInTheDocument();
    expect(within(table).getByText('Unavailable')).toBeInTheDocument();
    const total = within(table).getByText('All partners').closest('tr')!;
    ['926', '376', '402', '148', '48%'].forEach((v) => expect(within(total).getByText(v)).toBeInTheDocument());
    expect(within(screen.getByRole('tab', { name: /All partners/ })).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: /Agents/ })).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: /3PLs/ })).getByText('2')).toBeInTheDocument();
  });

  it('a tab asks the API for that type and keeps it in the URL', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Delivery partners' });
    await userEvent.click(screen.getByRole('tab', { name: /3PLs/ }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.anything(), '3pl', expect.anything()));
    expect(screen.getByTestId('where')).toHaveTextContent('tab=3pl');
    const table = await screen.findByRole('table', { name: 'Delivery partners' });
    await waitFor(() => expect(within(table).queryByText('Kofi Appiah')).not.toBeInTheDocument());
  });

  it('shows a retry when the table cannot load', async () => {
    list.mockRejectedValue(new Error('x'));
    renderPage();
    expect(await screen.findByText('The delivery partners could not load.')).toBeInTheDocument();
  });
});

describe('Deliveries cards (M4-T31)', () => {
  it('reasons card: failed and returned apart, a click opens Orders with the reason and the dates', async () => {
    renderPage('/delivery-agents?from=2026-10-01&to=2026-10-17');
    const card = (await screen.findByText('Failed and returned by reason')).closest('.card') as HTMLElement;
    await within(card).findByText('165');
    expect(within(card).getByText('354')).toBeInTheDocument();
    expect(within(card).getByText('48')).toBeInTheDocument();
    const counts = ['165', '96', '84', '57'].map((n) => Number(within(card).getByText(n).textContent));
    expect(counts.reduce((a, b) => a + b, 0) + 0).toBe(402);
    expect(within(card).getByText(/Not reachable is the biggest cause/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('link', { name: /Refused, 96 orders/ }));
    expect(await screen.findByText('ORDERS PAGE')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/orders?failure=refused&from=2026-10-01&to=2026-10-17');
  });

  it('waiting list marks old orders, and out-for-delivery groups by partner', async () => {
    renderPage();
    const waiting = (await screen.findByText('Waiting to dispatch', { selector: 'h3' })).closest('.card') as HTMLElement;
    expect(await within(waiting).findByText('#24086')).toBeInTheDocument();
    expect(within(waiting).getByText('No partner yet')).toBeInTheDocument();
    expect(within(waiting).getByText('Esi Badu')).toBeInTheDocument();
    expect(within(waiting).getByText('3 days')).toBeInTheDocument();
    const out = (await screen.findByText('Out for delivery now', { selector: 'h3' })).closest('.card') as HTMLElement;
    expect(within(out).getByText('142 orders across 4 partners')).toBeInTheDocument();
    expect(within(out).getByRole('link', { name: /Logiswift, 100 orders/ })).toHaveAttribute('href', '/orders?status=out_for_delivery&agent=1');
  });

  it('a role that may not see the waiting list (403) still gets the page', async () => {
    waiting.mockResolvedValue(null);
    renderPage();
    await screen.findByRole('table', { name: 'Delivery partners' });
    expect(screen.queryByText('Waiting to dispatch', { selector: 'h3' })).not.toBeInTheDocument();
  });

  it('shows "Returned units missing" with the sent and received figures and a link to the 3PL stock', async () => {
    renderPage();
    const card = (await screen.findByText('Failed and returned by reason')).closest('.card') as HTMLElement;
    const line = await within(card).findByText(/Returned units missing:/);
    expect(returnsSummary).toHaveBeenCalledTimes(1); // it follows the dates, not every refresh
    expect(line.closest('p')).toHaveTextContent('Returned units missing: 5. Logiswift sent back 41 units. We received 36.');
    expect(within(card).getByRole('link', { name: 'See it in Inventory' })).toHaveAttribute('href', '/inventory?location=7');
  });

  it('a role that may not read stock (403) gets the card without the missing-units line', async () => {
    returnsSummary.mockResolvedValue(null);
    renderPage();
    const card = (await screen.findByText('Failed and returned by reason')).closest('.card') as HTMLElement;
    await within(card).findByText('165');
    expect(screen.queryByText(/Returned units missing/)).not.toBeInTheDocument();
  });
});
