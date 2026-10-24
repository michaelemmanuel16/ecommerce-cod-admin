import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Inventory } from '../../pages/Inventory';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { ESI, KOFI, OVERVIEW, PRODUCTS, ROWS, TRANSFERS } from '../fixtures/inventory';

const handlers = new Map<string, () => void>();
vi.mock('../../services/socket', () => ({
  getSocket: () => ({ on: (e: string, h: () => void) => handlers.set(e, h), off: (e: string) => handlers.delete(e) }),
}));
const overview = vi.fn();
const transfers = vi.fn();
const products = vi.fn();
vi.mock('../../services/inventory.service', async (orig) => ({
  ...(await orig<typeof import('../../services/inventory.service')>()),
  inventoryService: {
    overview: (...a: unknown[]) => overview(...a),
    transfers: (...a: unknown[]) => transfers(...a),
    products: (...a: unknown[]) => products(...a),
    lowStock: () => Promise.resolve([{ id: 2, name: 'Magic Groove refill pens', sku: 'MG-PEN-REF', onHandTotal: 80, daysOfCover: 6, lowStockDaysEffective: 14 }]),
    trail: () => Promise.resolve([]),
  },
}));

const renderPage = (url = '/inventory') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Routes><Route path="/inventory" element={<Inventory />} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
const table = () => screen.getByRole('table', { name: 'Stock by location' });

beforeEach(() => {
  overview.mockReset().mockResolvedValue(OVERVIEW);
  products.mockReset().mockResolvedValue(PRODUCTS);
  handlers.clear();
  transfers.mockReset().mockResolvedValue({ transfers: TRANSFERS, typeCounts: {}, pagination: { page: 1, limit: 6, total: 4, pages: 1 } });
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, role: 'super_admin', firstName: 'M', lastName: 'O' } as never, permissions: {} });
});

describe('Inventory page', () => {
  it('shows a card per location with the numbers and the count tag', async () => {
    renderPage();
    const card = await screen.findByRole('article', { name: 'Logiswift' });
    expect(card).toHaveTextContent('342');
    expect(card).toHaveTextContent('59');
    expect(card).toHaveTextContent('12 units off');
    expect(screen.getByRole('article', { name: 'Esi Badu' })).toHaveTextContent('Count is old');
    expect(screen.getByRole('article', { name: 'Kofi Appiah' })).toHaveTextContent('Matches');
  });

  it('the table row shows the difference 12', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Stock by location' });
    const row = within(table()).getAllByRole('row').find((r) => r.textContent?.includes('MG-CB-SET') && r.textContent?.includes('Logiswift'))!;
    expect(row).toHaveTextContent('200 vs 188');
    expect(row).toHaveTextContent('−12 units');
  });

  it('?product= pre-filters the table', async () => {
    renderPage('/inventory?product=3');
    await screen.findByRole('table', { name: 'Stock by location' });
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
    expect(table()).toHaveTextContent('Pencil grip trainer');
  });

  it('?location= pre-filters the table (the Deliveries page links here)', async () => {
    renderPage(`/inventory?location=${KOFI}`);
    await screen.findByRole('table', { name: 'Stock by location' });
    const body = within(table()).getAllByRole('row').slice(1);
    expect(body).toHaveLength(ROWS.filter((r) => r.locationId === KOFI).length);
    body.forEach((r) => expect(r).toHaveTextContent('Kofi Appiah'));
    expect(table()).not.toHaveTextContent('Esi Badu');
  });

  it('?location= with an unknown id shows the empty state', async () => {
    renderPage(`/inventory?location=${ESI + 900}`);
    expect(await screen.findByText('No stock matches.')).toBeInTheDocument();
  });

  it('?action=allocate opens the allocate modal once and leaves the URL', async () => {
    renderPage('/inventory?action=allocate');
    expect(await screen.findByRole('dialog', { name: 'Allocate to an agent' })).toBeInTheDocument();
  });

  it('refreshes quietly, once, after an order event (stock moves when an order is delivered)', async () => {
    renderPage();
    await screen.findByRole('article', { name: 'Logiswift' });
    const before = overview.mock.calls.length;
    handlers.get('order:status_changed')?.();
    handlers.get('order:updated')?.();
    await waitFor(() => expect(overview.mock.calls.length).toBe(before + 1), { timeout: 3000 });
    expect(overview).toHaveBeenLastCalledWith(true);
  });

  it('loads the product list once, not on every refresh', async () => {
    renderPage();
    await screen.findByRole('article', { name: 'Logiswift' });
    handlers.get('order:updated')?.();
    await waitFor(() => expect(overview.mock.calls.length).toBeGreaterThan(1), { timeout: 3000 });
    expect(products).toHaveBeenCalledTimes(1);
  });

  it('offers to set up an own store when there is none, and lists the low-stock product', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Set up own store/ })).toBeInTheDocument();
    expect(screen.getByText('Running low')).toBeInTheDocument();
  });

  it('a role that cannot move stock sees no action buttons', async () => {
    useAuthStore.setState({ user: { id: 2, role: 'accountant' } as never, permissions: { products: ['view'] } as never });
    renderPage();
    await screen.findByRole('article', { name: 'Logiswift' });
    expect(screen.queryByRole('button', { name: 'Start stock count' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allocate stock' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Transfer history/ })).toBeInTheDocument());
  });

  it('recent transfers: Confirm received only for a 3PL destination, Overdue tag shown', async () => {
    renderPage();
    const t = await screen.findByRole('table', { name: 'Recent transfers' });
    expect(within(t).getAllByRole('button', { name: /Confirm received/ })).toHaveLength(1);
    expect(t).toHaveTextContent('Overdue');
    expect(t).toHaveTextContent('Received 2 short');
    expect(within(t).getByRole('button', { name: /Resolve/ })).toBeInTheDocument();
    await userEvent.click(within(t).getByRole('button', { name: /Resolve/ }));
    expect(await screen.findByRole('dialog', { name: 'Resolve the shortage' })).toBeInTheDocument();
  });
});
