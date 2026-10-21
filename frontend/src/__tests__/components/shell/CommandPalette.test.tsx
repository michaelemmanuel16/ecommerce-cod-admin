import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CommandPalette } from '../../../components/shell/CommandPalette';
import { ACTIONS, visibleActions, type PaletteAction } from '../../../components/shell/commandPaletteModel';
import { ToastProvider } from '../../../components/ui-v2';
import { useAuthStore } from '../../../stores/authStore';
import { useShellStore } from '../../../stores/shellStore';
import { searchService, type SearchResults } from '../../../services/search.service';

vi.mock('../../../services/search.service', () => ({ searchService: { search: vi.fn() } }));

const MENU = ['dashboard', 'orders', 'customers', 'finance', 'targets'];
const owner = { id: 1, email: 'm@example.com', firstName: 'Manny', lastName: 'Owner', role: 'super_admin' as const, createdAt: '', updatedAt: '' };

const where = () => <p data-testid="where">{useLocation().pathname}</p>;

function renderPalette(opts: { menu?: string[]; actions?: PaletteAction[] } = {}) {
  useAuthStore.setState({ user: owner, menu: opts.menu ?? MENU, isAuthenticated: true });
  return render(
    <MemoryRouter initialEntries={['/customers']}>
      <ToastProvider>
        <button type="button" onClick={() => useShellStore.getState().setPaletteOpen(true)}>Search box</button>
        <CommandPalette actions={opts.actions} />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}
function Where() { return where(); }

const results = (over: Partial<SearchResults> = {}): SearchResults => ({
  orders: [{ id: 24114, status: 'delivered', totalAmount: '350.00', createdAt: '', customer: { id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: '0240000000' } }],
  customers: [{ id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: '0240000000', area: 'Accra', state: 'Greater Accra', totalOrders: 3 }],
  ...over,
});

describe('CommandPalette (M3-T35)', () => {
  beforeEach(() => {
    vi.mocked(searchService.search).mockReset();
    useShellStore.setState({ paletteOpen: false, drawerOpen: false });
  });
  afterEach(() => vi.useRealTimers());

  it('cmd+K opens it and ctrl+K too; the input has focus', async () => {
    renderPalette();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('dialog', { name: 'Command menu' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a command or ask a question…')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('Escape closes it and focus returns to the search box that opened it', async () => {
    renderPalette();
    const box = screen.getByRole('button', { name: 'Search box' });
    await userEvent.click(box);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(box).toHaveFocus();
    expect(useShellStore.getState().paletteOpen).toBe(false);
  });

  it('shows Ask the agent, Go to (only allowed pages with a page) and no Actions yet', async () => {
    renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByText('Ask the agent a question')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Orders/ })).toHaveTextContent('G O');
    expect(screen.getByRole('option', { name: /Customers/ })).toBeInTheDocument();
    // targets is in the menu but has no page: no row; leaderboard is not in the menu
    expect(screen.queryByRole('option', { name: /Targets/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Leaderboard/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Settings/ })).not.toBeInTheDocument(); // not in this menu
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    expect(screen.queryByText(/3PL payout/)).not.toBeInTheDocument();
    expect(screen.queryByText(/stock count/)).not.toBeInTheDocument();
  });

  it('Ask the agent opens the drawer mount point and says the agent is not available yet', async () => {
    renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.click(await screen.findByRole('option', { name: /Ask the agent a question/ }));
    expect(useShellStore.getState().drawerOpen).toBe(true);
    expect(await screen.findByText('The agent is not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('actions show only when their screen exists and the role has the menu key', () => {
    const payout: PaletteAction = { ...ACTIONS[0], to: '/finance/payout' };
    // today: no screen, hidden for everyone
    expect(visibleActions(['finance', 'inventory'])).toEqual([]);
    // screen exists, role without the key: hidden; with the key: shown
    expect(visibleActions(['orders'], [payout])).toEqual([]);
    expect(visibleActions(null, [payout])).toEqual([]);
    expect(visibleActions(['finance'], [payout])).toEqual([payout]);
  });

  it('renders an action row only for a role that has permission', async () => {
    const payout: PaletteAction = { ...ACTIONS[0], to: '/finance/payout' };
    const view = renderPalette({ menu: ['orders'], actions: [payout] });
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog');
    expect(screen.queryByRole('option', { name: /3PL payout/ })).not.toBeInTheDocument();
    view.unmount();

    useShellStore.setState({ paletteOpen: false });
    renderPalette({ menu: ['orders', 'finance'], actions: [payout] });
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.click(await screen.findByRole('option', { name: /3PL payout/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/finance/payout');
  });

  it('does not search below 3 characters; 3 characters trigger one search', async () => {
    vi.mocked(searchService.search).mockResolvedValue(results());
    renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog');
    await userEvent.keyboard('am');
    await new Promise((r) => setTimeout(r, 400));
    expect(searchService.search).not.toHaveBeenCalled();
    await userEvent.keyboard('a');
    await waitFor(() => expect(searchService.search).toHaveBeenCalledTimes(1));
    expect(searchService.search).toHaveBeenCalledWith('ama');
    expect(await screen.findByRole('option', { name: /#24114/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ama Mensah.*0240000000/ })).toBeInTheDocument();
  });

  it('debounces: fast typing sends one request for the final text', async () => {
    vi.mocked(searchService.search).mockResolvedValue(results());
    renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog');
    await userEvent.keyboard('amaka');
    await waitFor(() => expect(searchService.search).toHaveBeenCalled());
    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(searchService.search).toHaveBeenCalledWith('amaka');
  });

  it('ignores an out-of-order response: the older answer never replaces the newer one', async () => {
    let resolveOld!: (r: SearchResults) => void;
    vi.mocked(searchService.search).mockImplementation((q: string) =>
      q === 'ama' ? new Promise<SearchResults>((res) => { resolveOld = res; })
        : Promise.resolve(results({ orders: [], customers: [{ id: 9, firstName: 'Amaka', lastName: 'Obi', phoneNumber: '0550000000', area: null, state: null, totalOrders: 1 }] })),
    );
    renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog');
    await userEvent.keyboard('ama');
    await waitFor(() => expect(searchService.search).toHaveBeenCalledWith('ama'));
    await userEvent.keyboard('ka');
    expect(await screen.findByRole('option', { name: /Amaka Obi/ })).toBeInTheDocument();
    // the first request answers last
    await act(async () => resolveOld(results()));
    expect(screen.getByRole('option', { name: /Amaka Obi/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /#24114/ })).not.toBeInTheDocument();
  });

  it('selecting an order opens it; selecting a customer opens the customer', async () => {
    vi.mocked(searchService.search).mockResolvedValue(results());
    renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.keyboard('ama');
    await userEvent.click(await screen.findByRole('option', { name: /#24114/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/orders/24114');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.keyboard('ama');
    await userEvent.click(await screen.findByRole('option', { name: /Ama Mensah.*0240000000/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/customers/7');
  });

  it('arrow keys move the selection and Enter opens the first match', async () => {
    vi.mocked(searchService.search).mockResolvedValue(results());
    renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.keyboard('ama');
    const order = await screen.findByRole('option', { name: /#24114/ });
    expect(order).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Ama Mensah.*0240000000/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(screen.getByTestId('where')).toHaveTextContent('/orders/24114');
  });

  it('says so when the search fails, and when nothing matches', async () => {
    vi.mocked(searchService.search).mockRejectedValueOnce(new Error('down'));
    renderPalette();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.keyboard('zzz');
    expect(await screen.findByText('Search is not available right now.')).toBeInTheDocument();
    vi.mocked(searchService.search).mockResolvedValue({ orders: [], customers: [] });
    await userEvent.keyboard('z');
    expect(await screen.findByText(/No orders or customers match/)).toBeInTheDocument();
  });

  describe('G shortcuts', () => {
    it('G O opens Orders when no input is focused', async () => {
      renderPalette();
      await userEvent.keyboard('go');
      expect(screen.getByTestId('where')).toHaveTextContent('/orders');
    });

    it('does nothing while an input is focused', async () => {
      renderPalette();
      render(<input aria-label="field" />);
      await userEvent.click(screen.getByLabelText('field'));
      await userEvent.keyboard('go');
      expect(screen.getByTestId('where')).toHaveTextContent('/customers');
    });

    it('G L and G T do nothing yet: Leaderboard and Targets have no page', async () => {
      renderPalette({ menu: [...MENU, 'leaderboard'] });
      await userEvent.keyboard('gl');
      await userEvent.keyboard('gt');
      expect(screen.getByTestId('where')).toHaveTextContent('/customers');
    });

    it('G O does nothing for a role without the orders menu key', async () => {
      renderPalette({ menu: ['dashboard', 'customers'] });
      await userEvent.keyboard('go');
      expect(screen.getByTestId('where')).toHaveTextContent('/customers');
    });
  });
});
