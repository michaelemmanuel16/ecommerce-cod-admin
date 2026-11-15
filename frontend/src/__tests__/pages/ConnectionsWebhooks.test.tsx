import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Connections } from '../../pages/Connections';

const cs = vi.hoisted(() => ({ getCards: vi.fn(), getActivity: vi.fn(), getPaymentConnections: vi.fn(), getSmsReportUrl: vi.fn() }));
vi.mock('../../services/connections.service', () => ({ connectionsService: cs }));
const wh = vi.hoisted(() => ({
  getWebhooks: vi.fn(), createWebhook: vi.fn(), updateWebhook: vi.fn(), deleteWebhook: vi.fn(), getWebhookLogs: vi.fn(), retryWebhook: vi.fn(),
}));
vi.mock('../../services/webhooks.service', () => ({ webhooksService: wh }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: vi.fn().mockResolvedValue([{ id: 5, name: 'Copybook set' }]) } }));
vi.mock('../../services/admin.service', () => ({ adminService: { getSystemConfig: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../components/settings/integrations/MetaAdsIntegration', () => ({ MetaAdsIntegration: () => <div /> }));
vi.mock('../../components/settings/integrations/McpIntegration', () => ({ McpIntegration: () => <div /> }));

let role: 'super_admin' | 'manager' = 'super_admin';
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, isSuperAdmin: role === 'super_admin', isAdmin: role === 'super_admin' }),
}));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 1, email: 'o@shop.com' } }) }));

const HOOK = { id: 9, name: 'Landing page B', uniqueUrl: 'abc-123', apiKey: 'key-0123456789abcdef', isActive: true, productId: 5, product: { name: 'Copybook set' }, fieldMapping: { customerPhone: 'phone' }, headers: {} };
const log = (over = {}) => ({ id: 1, endpoint: '/x', method: 'POST', headers: {}, body: { name: 'A' }, response: {}, statusCode: 200, success: false, errorMessage: 'Customer phone number is required', processedAt: '2026-11-14T10:00:00.000Z', ...over });

const renderTab = (url = '/connections?tab=webhooks') => render(
  <ToastProvider><MemoryRouter initialEntries={[url]}><Routes><Route path="/connections" element={<Connections />} /></Routes></MemoryRouter></ToastProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'super_admin';
  cs.getCards.mockResolvedValue({});
  cs.getActivity.mockResolvedValue({ counts: { all: 9, error: 2, warning: 3 }, items: [], nextCursor: null });
  wh.getWebhooks.mockResolvedValue({ webhooks: [HOOK] });
  wh.getWebhookLogs.mockResolvedValue({ logs: [log()], pagination: { page: 1, limit: 20, total: 1, pages: 1 } });
  wh.retryWebhook.mockResolvedValue({});
  wh.deleteWebhook.mockResolvedValue(undefined);
  wh.createWebhook.mockResolvedValue({ ...HOOK, id: 10, name: 'New one' });
});

describe('Webhooks tab (M9-T45)', () => {
  it('lists webhooks with the import URL and key', async () => {
    renderTab();
    const row = (await screen.findByText('Landing page B')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Copybook set')).toBeInTheDocument();
    expect(within(row).getByText(/\/api\/webhooks\/import\/abc-123$/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy key' })).toBeInTheDocument();
  });

  it('shows an empty state with a New webhook button', async () => {
    wh.getWebhooks.mockResolvedValue({ webhooks: [] });
    renderTab();
    expect(await screen.findByText('No webhooks yet')).toBeInTheDocument();
  });

  it('creates a webhook with a mapping that has the phone', async () => {
    renderTab();
    await screen.findByText('Landing page B');
    await userEvent.click(screen.getByRole('button', { name: /New webhook/ }));
    await userEvent.type(await screen.findByLabelText('Name'), 'New one');
    await userEvent.selectOptions(screen.getByLabelText('Product'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Create webhook' }));
    await waitFor(() => expect(wh.createWebhook).toHaveBeenCalled());
    const sent = wh.createWebhook.mock.calls[0][0];
    expect(sent).toMatchObject({ name: 'New one', productId: 5 });
    expect(sent.fieldMapping.customerPhone).toBe('phone_number');
    expect(sent.secret.length).toBeGreaterThanOrEqual(16);
  });

  it('refuses a mapping with no phone', async () => {
    renderTab();
    await screen.findByText('Landing page B');
    await userEvent.click(screen.getByRole('button', { name: /New webhook/ }));
    await userEvent.type(await screen.findByLabelText('Name'), 'X');
    await userEvent.selectOptions(screen.getByLabelText('Product'), '5');
    await userEvent.selectOptions(screen.getByLabelText('Goes to in CodAdmin, row 2'), 'notes');
    await userEvent.click(screen.getByRole('button', { name: 'Create webhook' }));
    expect(await screen.findByText(/Map the customer phone/)).toBeInTheDocument();
    expect(wh.createWebhook).not.toHaveBeenCalled();
  });

  it('edits a webhook', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Landing page B' }));
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(wh.updateWebhook).toHaveBeenCalledWith(9, expect.objectContaining({ name: 'Renamed', productId: 5, isActive: true })));
  });

  it('asks before deleting, then deletes', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Landing page B' }));
    expect(wh.deleteWebhook).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(wh.deleteWebhook).toHaveBeenCalledWith(9));
  });

  it('shows logs of one webhook and retries a failed delivery on the right route', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Logs for Landing page B' }));
    expect(await screen.findByText('Customer phone number is required')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry delivery/ }));
    await waitFor(() => expect(wh.retryWebhook).toHaveBeenCalledWith(9, 1));
  });

  it('does not offer a retry for a request refused for its signature (401)', async () => {
    wh.getWebhookLogs.mockResolvedValue({ logs: [log({ statusCode: 401 })], pagination: { page: 1, limit: 20, total: 1, pages: 1 } });
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Logs for Landing page B' }));
    await screen.findByText('Customer phone number is required');
    expect(screen.queryByRole('button', { name: /Retry delivery/ })).not.toBeInTheDocument();
  });

  it('a person who is not owner or admin gets the cards only: no tabs', async () => {
    role = 'manager';
    renderTab();
    await screen.findByRole('heading', { name: 'Connections' });
    expect(screen.queryByRole('tab', { name: 'Webhooks' })).not.toBeInTheDocument();
    expect(wh.getWebhooks).not.toHaveBeenCalled();
  });
});

describe('Activity tab (M9-T45)', () => {
  it('shows the tab counts from the API and asks for the failed rows when that tab is picked', async () => {
    cs.getActivity.mockImplementation(async (level: string) => ({
      counts: { all: 9, error: 2, warning: 3 },
      items: level === 'error'
        ? [{ id: 2, connection: 'webhook', level: 'error', message: 'Rejected: the phone field was missing.', at: '2026-11-14T10:00:00.000Z' }]
        : [{ id: 1, connection: 'whatsapp', level: 'warning', message: 'Token ends soon', at: '2026-11-14T09:00:00.000Z' }],
      nextCursor: null,
    }));
    renderTab('/connections?tab=activity');
    expect(await screen.findByText('Token ends soon')).toBeInTheDocument();
    const failedTab = screen.getByRole('tab', { name: /Failed/ });
    expect(failedTab).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Warnings/ })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('9');
    await userEvent.click(failedTab);
    expect(await screen.findByText('Rejected: the phone field was missing.')).toBeInTheDocument();
    expect(cs.getActivity).toHaveBeenLastCalledWith('error');
  });

  it('shows an empty state', async () => {
    renderTab('/connections?tab=activity');
    expect(await screen.findByText('Nothing yet')).toBeInTheDocument();
  });
});
