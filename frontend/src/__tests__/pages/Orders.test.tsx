import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Orders } from '../../pages/Orders';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { COUNTS, ROWS } from '../fixtures/ordersList';
import { ORDER_EVENTS, SOCKET_REFRESH_MS } from '../../pages/orders/useOrdersList';

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
vi.mock('../../services/socket', () => ({ getSocket: () => socket }));
vi.mock('../../components/orders/BulkImportModal', () => ({ BulkImportModal: () => null }));
vi.mock('../../components/forms/OrderForm', () => ({ OrderForm: () => null }));

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
  listOrders.mockResolvedValue({ rows, pagination: { page: 1, limit: 25, total, pages: Math.ceil(total / 25) } });
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

describe('Orders list: tabs (M3-T42, F-308)', () => {
  it('shows a tab per status with the server count, and no Kanban', async () => {
    renderPage();
    const pending = await screen.findByRole('tab', { name: /Pending confirmation/ });
    expect(pending).toHaveTextContent('64');
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveTextContent('1,000');
    expect(screen.getByRole('tab', { name: /Failed delivery/ })).toHaveTextContent('354');
    expect(screen.queryByText(/kanban/i)).toBeNull();
  });

  it('shows Digital only when its count is above 0, and Payment issues as two statuses together', async () => {
    renderPage();
    await screen.findByRole('tab', { name: /Pending confirmation/ });
    expect(screen.queryByRole('tab', { name: /Digital/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Payment issues/ })).toHaveTextContent('2');
  });

  it('shows Digital when there are digital orders, and hides Payment issues at 0', async () => {
    getCounts.mockResolvedValue({ ...COUNTS, byStatus: { ...COUNTS.byStatus, digital_delivered: 3, payment_pending: 0, payment_failed: 0 } });
    renderPage();
    expect(await screen.findByRole('tab', { name: /Digital/ })).toHaveTextContent('3');
    expect(screen.queryByRole('tab', { name: /Payment issues/ })).toBeNull();
  });

  it('a click puts ?status= in the URL and asks the API for that status; page 1', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Confirmed/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/orders?status=confirmed');
    await waitFor(() => expect(listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ status: ['confirmed'], page: 1 }), expect.anything()));
    expect(screen.getByRole('tab', { name: /Confirmed/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens on the tab named in the URL, and Payment issues sends both statuses', async () => {
    renderPage('/orders?status=payment_issues');
    await waitFor(() => expect(listOrders).toHaveBeenCalledWith(expect.objectContaining({ status: ['payment_pending', 'payment_failed'] }), expect.anything()));
    expect(await screen.findByRole('tab', { name: /Payment issues/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores a status it does not know', async () => {
    renderPage('/orders?status=nonsense');
    expect(await screen.findByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Orders list: rows (M3-T42, F-307)', () => {
  it('writes the order number as #id and the footer as "Showing n of N orders"', async () => {
    answer(ROWS, 1445);
    renderPage();
    expect(await screen.findByText('#24117')).toBeInTheDocument();
    expect(screen.getByText('Showing 25 of 1,445 orders')).toBeInTheDocument();
  });

  it('shows product summary, call rep, delivery agent, flag line and chips', async () => {
    renderPage();
    await screen.findByText('#24117');
    expect(screen.getByText('Copybook set × 2 + 1 more')).toBeInTheDocument();
    expect(screen.getByText('Kofi Appiah')).toBeInTheDocument();
    expect(screen.getByText(/No call rep \+1/)).toBeInTheDocument();
    expect(screen.getByText('4 replies')).toBeInTheDocument();
    expect(screen.getByText(/^Reminder /)).toBeInTheDocument();
    // not confirmed yet: a dash for the agent; confirmed with nobody: grey "Unassigned"
    const unconfirmed = screen.getByText('#24113').closest('tr') as HTMLElement;
    expect(within(unconfirmed).getByText('—')).toBeInTheDocument();
    const confirmed = screen.getByText('#24112').closest('tr') as HTMLElement;
    expect(within(confirmed).getByText('Unassigned')).toBeInTheDocument();
  });

  it('says "No orders match." for an empty list', async () => {
    answer([], 0);
    renderPage();
    expect(await screen.findByText('No orders match.')).toBeInTheDocument();
  });

  it('a row click opens the order; a checkbox click selects and does not open', async () => {
    const onOpen = vi.fn();
    renderPage('/orders', onOpen);
    const box = await screen.findByLabelText('Select order #24117');
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('#24113'));
    expect(onOpen).toHaveBeenCalledWith(24113);
  });

  it('without onOpen a row click goes to /orders/:id', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('#24112'));
    expect(await screen.findByText('ORDER PAGE')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/orders/24112');
  });

  it('select all picks every row on the page', async () => {
    renderPage();
    await userEvent.click(await screen.findByLabelText('Select all orders on this page'));
    ROWS.forEach((r) => expect(screen.getByLabelText(`Select order #${r.id}`)).toBeChecked());
  });
});

describe('Orders list: columns (M3-T42, F-307)', () => {
  it('hides the alternate phone until the column menu turns it on, and remembers it', async () => {
    renderPage();
    await screen.findByText('#24117');
    expect(screen.queryByRole('columnheader', { name: /Alternate phone/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /Alternate phone/ }));
    expect(screen.getByRole('columnheader', { name: /Alternate phone/ })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('codadmin.orders.columns.1') as string).hidden).not.toContain('altPhone');
  });

  it('a key press on a resize handle widens the column and saves it for this user', async () => {
    renderPage();
    await screen.findByText('#24117');
    const handle = screen.getByRole('separator', { name: 'Resize Customer' });
    const before = Number(handle.getAttribute('aria-valuenow'));
    handle.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(Number(screen.getByRole('separator', { name: 'Resize Customer' }).getAttribute('aria-valuenow'))).toBe(before + 10);
    expect(JSON.parse(localStorage.getItem('codadmin.orders.columns.1') as string).widths.customer).toBe(before + 10);
  });

  it('works when storage throws', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    renderPage();
    expect(await screen.findByText('#24117')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /Alternate phone/ }));
    expect(screen.getByRole('columnheader', { name: /Alternate phone/ })).toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('Orders list: socket refresh (M3-T42)', () => {
  it('listens on the real event names and re-reads once for a burst', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByText('#24117');
    ORDER_EVENTS.forEach((e) => expect(handlers.get(e)?.length).toBe(1));
    expect(handlers.has('orders:created')).toBe(false);
    const calls = listOrders.mock.calls.length;
    act(() => {
      handlers.get('order:created')?.forEach((h) => h());
      handlers.get('order:status_changed')?.forEach((h) => h());
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(SOCKET_REFRESH_MS + 50); });
    expect(listOrders.mock.calls.length).toBe(calls + 1);
    vi.useRealTimers();
  });
});
