import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { NotificationSettings } from '../../pages/inbox/NotificationSettings';
import { Inbox } from '../../pages/Inbox';
import { useAuthStore } from '../../stores/authStore';
import type { PreferenceRow } from '../../services/notificationSettings.service';

const svc = vi.hoisted(() => ({ mine: vi.fn(), saveMine: vi.fn(), roleDefaults: vi.fn(), saveRoleDefaults: vi.fn() }));
vi.mock('../../services/notificationSettings.service', async (orig) => ({ ...(await orig<typeof import('../../services/notificationSettings.service')>()), notificationSettingsService: svc }));
// The Inbox page also reads the feed; this file only opens its settings view
vi.mock('../../services/inbox.service', async (orig) => ({ ...(await orig<typeof import('../../services/inbox.service')>()), inboxService: { list: vi.fn(), counts: vi.fn() } }));

const HINT = 'Connect WhatsApp in Connections to turn this on.';
const row = (event: string, label: string, over: Partial<Record<'inApp' | 'whatsapp' | 'email' | 'sms', boolean>> = {}, locked = false): PreferenceRow => ({
  event, label, kind: 'alert', source: 'default',
  channels: {
    inApp: { enabled: over.inApp ?? true, available: true, ...(locked ? { locked: true } : {}) },
    whatsapp: { enabled: over.whatsapp ?? false, available: false, hint: HINT },
    email: { enabled: over.email ?? false, available: true },
    sms: { enabled: false, available: false, hint: 'Connect SMS in Connections to turn this on.' },
  },
});
const ROWS = [row('mention', 'Someone mentioned you'), row('system_problem', 'A connection or job problem', {}, true)];

const user = (role: string) => ({ id: 1, role });
const renderIt = (role = 'sales_rep') => render(<MemoryRouter><ToastProvider><NotificationSettings user={user(role)} /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  svc.mine.mockResolvedValue(ROWS);
  svc.roleDefaults.mockResolvedValue(ROWS);
});

describe('NotificationSettings (T39)', () => {
  it('lists every event with the person\'s own channels, and has no role view for a rep', async () => {
    renderIt('sales_rep');
    const sw = await screen.findByRole('switch', { name: 'Someone mentioned you: In-app' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Someone mentioned you: Email' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: 'Role defaults' })).not.toBeInTheDocument();
    expect(svc.roleDefaults).not.toHaveBeenCalled();
  });

  it('a switch saves through the API with only that event and channel', async () => {
    svc.saveMine.mockResolvedValue([row('mention', 'Someone mentioned you', { email: true }), ROWS[1]]);
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'Someone mentioned you: Email' }));
    await waitFor(() => expect(svc.saveMine).toHaveBeenCalledWith([{ event: 'mention', email: true }]));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Someone mentioned you: Email' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('a channel that is not connected is disabled and shows its hint', async () => {
    renderIt('admin');
    const wa = await screen.findByRole('switch', { name: 'Someone mentioned you: WhatsApp' });
    expect(wa).toBeDisabled();
    expect(wa).toHaveAttribute('title', HINT);
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Connections' })).toHaveAttribute('href', '/connections');
    await userEvent.click(wa);
    expect(svc.saveMine).not.toHaveBeenCalled();
  });

  it('the in-app copy the owner must keep is locked', async () => {
    renderIt('admin');
    expect(await screen.findByRole('switch', { name: 'A connection or job problem: In-app' })).toBeDisabled();
  });

  it('owner and admin switch to role defaults and save for the chosen role', async () => {
    svc.saveRoleDefaults.mockResolvedValue(ROWS);
    renderIt('admin');
    await screen.findByRole('switch', { name: 'Someone mentioned you: In-app' });
    await userEvent.click(screen.getByRole('button', { name: 'Role defaults' }));
    await waitFor(() => expect(svc.roleDefaults).toHaveBeenCalledWith('manager'));
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'sales_rep');
    await waitFor(() => expect(svc.roleDefaults).toHaveBeenLastCalledWith('sales_rep'));
    await userEvent.click(await screen.findByRole('switch', { name: 'Someone mentioned you: Email' }));
    await waitFor(() => expect(svc.saveRoleDefaults).toHaveBeenCalledWith('sales_rep', [{ event: 'mention', email: true }]));
    expect(svc.saveMine).not.toHaveBeenCalled();
  });

  it('a failed save keeps the old value and says why', async () => {
    svc.saveMine.mockRejectedValue(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 400, data: { error: 'Nope' } } }));
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'Someone mentioned you: Email' }));
    expect(await screen.findByText(/Nope|not saved/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Someone mentioned you: Email' })).toHaveAttribute('aria-checked', 'false');
  });

  it('the Inbox page opens it from ?view=settings', async () => {
    useAuthStore.setState({ user: { id: 1, role: 'admin', email: 'a@b.c', firstName: 'A', lastName: 'B' } as never });
    render(<MemoryRouter initialEntries={['/inbox?view=settings']}><ToastProvider><Inbox /></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Notification settings', level: 1 })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Someone mentioned you')).toBeInTheDocument();
  });
});
