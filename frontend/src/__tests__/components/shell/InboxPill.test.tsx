import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../../components/shell/Sidebar';
import { useAuthStore } from '../../../stores/authStore';
import { useConfigStore } from '../../../stores/configStore';
import { useShellStore } from '../../../stores/shellStore';
import { useInboxStore } from '../../../stores/inboxStore';
import { inboxService } from '../../../services/inbox.service';
import { getSocket } from '../../../services/socket';
import { COUNTS, fakeSocket } from '../../fixtures/inboxItems';

vi.mock('../../../services/inbox.service', async (orig) => ({
  ...(await orig<typeof import('../../../services/inbox.service')>()),
  inboxService: { counts: vi.fn(), list: vi.fn(), patch: vi.fn(), markAll: vi.fn() },
}));
vi.mock('../../../services/socket', () => ({ getSocket: vi.fn() }));

describe('Sidebar Inbox pill (M9-T38)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInboxStore.getState().stop();
    useAuthStore.setState({
      user: { id: 1, email: 'm@example.com', firstName: 'Manny', lastName: 'Owner', role: 'super_admin', createdAt: '', updatedAt: '' } as never,
      menu: ['dashboard', 'inbox', 'orders'], roles: [{ id: 1, name: 'Owner' }] as never,
    });
    useConfigStore.setState({ businessName: 'Store', currency: 'GHS', loaded: true });
    useShellStore.setState({ counts: { inbox: 2, ordersPending: 0, financeOpen: 0 } });
    vi.mocked(inboxService.counts).mockResolvedValue({ ...COUNTS, all: 4 });
  });

  const renderSidebar = () => render(
    <MemoryRouter><Sidebar collapsed={false} onToggleCollapsed={() => {}} mobileOpen={false} onNavigate={() => {}} /></MemoryRouter>,
  );

  it('links to /inbox, shows the first answer from the nav counts, then the live count', async () => {
    const socket = fakeSocket();
    vi.mocked(getSocket).mockReturnValue(socket as never);
    renderSidebar();
    const link = screen.getByRole('link', { name: /Inbox/ });
    expect(link).toHaveAttribute('href', '/inbox');
    expect(within(link).getByText('2')).toBeInTheDocument(); // nav counts, before the store has answered

    await act(async () => { useInboxStore.getState().start(); });
    expect(within(screen.getByRole('link', { name: /Inbox/ })).getByText('4')).toBeInTheDocument();

    act(() => socket.fire('inbox:counts', { ...COUNTS, all: 5 }));
    expect(within(screen.getByRole('link', { name: /Inbox/ })).getByText('5')).toBeInTheDocument();
    act(() => socket.fire('inbox:counts', { ...COUNTS, all: 0 }));
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument(); // no pill at zero
  });
});
