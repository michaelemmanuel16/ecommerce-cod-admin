import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Orders } from '../../pages/Orders';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { COUNTS, ROWS } from '../fixtures/ordersList';
import { ORDER_EVENTS, SOCKET_REFRESH_MS } from '../../pages/orders/useOrderList';
import { SEARCH_DEBOUNCE_MS } from '../../utils/urlState';

const listOrders = vi.fn();
const getCounts = vi.fn();
vi.mock('../../services/orders.service', () => ({
  ordersService: {
    listOrders: (...a: unknown[]) => listOrders(...a),
    getCounts: (...a: unknown[]) => getCounts(...a),
    exportOrders: vi.fn(),
  },
}));
const handlers = new Map<string, Array<() => void>>();
const socket = {
  on: vi.fn((e: string, h: () => void) => handlers.set(e, [...(handlers.get(e) ?? []), h])),
  off: vi.fn((e: string, h: () => void) => handlers.set(e, (handlers.get(e) ?? []).filter((x) => x !== h))),
};
vi.mock('../../services/locations.service', () => ({ locationsService: { getTowns: () => Promise.resolve(['Adum']) } }));
vi.mock('../../services/socket', () => ({ getSocket: () => socket }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: () => Promise.resolve([{ id: 1, name: 'Copybook set', isActive: true }, { id: 2, name: 'Refill pens', isActive: true }]) } }));
vi.mock('../../services/delivery-agents.service', () => ({ deliveryAgentsService: { getDeliveryAgents: () => Promise.resolve([{ id: '5', name: 'Kofi Appiah', isActive: true, isAvailable: true }]) } }));
vi.mock('../../services/customer-reps.service', () => ({ customerRepsService: { getCustomerReps: () => Promise.resolve([{ id: '2', name: 'Adwoa Darko', isActive: true, isAvailable: true }]) } }));
vi.mock('../../services/customers.service', () => ({
  customersService: {
    findByPhone: () => Promise.resolve(null),
    getForOrder: () => Promise.resolve({ name: 'Abena Owusu', phone: '+233245550182', alternatePhone: '', email: '', address: '14 Adum Road', region: 'Ashanti', town: 'Adum' }),
  },
}));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPage(url = '/orders', onOpen?: (id: number) => void) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Where />
        <Routes>
          <Route path="/orders" element={<Orders onOpen={onOpen} />} />
          <Route path="/orders/:id" element={<div>ORDER PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const answer = (rows = ROWS, total = 1000) => {
  listOrders.mockImplementation((p: { page?: number; limit?: number }) =>
    Promise.resolve({ rows, pagination: { page: p.page ?? 1, limit: p.limit ?? 25, total, pages: Math.ceil(total / (p.limit ?? 25)) } }));
  getCounts.mockResolvedValue(COUNTS);
};

beforeEach(() => {
  listOrders.mockReset();
  getCounts.mockReset();
  handlers.clear();
  localStorage.clear();
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A' } as never, permissions: null });
  answer();
});

describe('Orders: Unpaid by agent tab (M5-T35, F-309)', () => {
  it('shows the tab with the same count as the unpaid-by-age card', async () => {
    getCounts.mockResolvedValue({ ...COUNTS, unpaidByAgent: 38 });
    renderPage();
    expect(await screen.findByRole('tab', { name: /Unpaid by agent/ })).toHaveTextContent('38');
  });

  it('is not drawn for a role that cannot see finance (no count)', async () => {
    getCounts.mockResolvedValue({ ...COUNTS, unpaidByAgent: null });
    renderPage();
    await screen.findByRole('tab', { name: /Pending confirmation/ });
    expect(screen.queryByRole('tab', { name: /Unpaid by agent/ })).toBeNull();
  });

  it('asks the list for tab=unpaid_by_agent with no status, writes ?status= and hides Export', async () => {
    getCounts.mockResolvedValue({ ...COUNTS, unpaidByAgent: 2 });
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Unpaid by agent/ }));
    await waitFor(() => expect(listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'unpaid_by_agent' }), expect.anything()));
    expect(listOrders.mock.calls.at(-1)![0].status).toBeUndefined();
    expect(screen.getByTestId('where')).toHaveTextContent('status=unpaid_by_agent');
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });

  it('opens on the tab from a link, with an empty state when nothing matches', async () => {
    getCounts.mockResolvedValue({ ...COUNTS, unpaidByAgent: 0 });
    answer([], 0);
    getCounts.mockResolvedValue({ ...COUNTS, unpaidByAgent: 0 });
    renderPage('/orders?status=unpaid_by_agent');
    expect(await screen.findByText('No orders match.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Unpaid by agent/ })).toHaveAttribute('aria-selected', 'true');
  });
});
