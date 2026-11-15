import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Connections } from '../../pages/Connections';
import { WebhooksRedirect } from '../../pages/connections/WebhooksRedirect';

const svc = vi.hoisted(() => ({
  getCards: vi.fn(), getPaymentConnections: vi.fn(), savePaymentConnection: vi.fn(), testPaymentConnection: vi.fn(),
  getSmsReportUrl: vi.fn(), testSmtp: vi.fn(), getCsvTemplate: vi.fn(), sendSmsTest: vi.fn(), sendEmailTest: vi.fn(),
  getActivity: vi.fn(),
}));
vi.mock('../../services/connections.service', () => ({ connectionsService: svc }));

const admin = vi.hoisted(() => ({
  getSystemConfig: vi.fn(), updateSystemConfig: vi.fn(), getWhatsAppStatus: vi.fn(), checkWhatsAppOAuthEnabled: vi.fn(),
  initiateWhatsAppOAuth: vi.fn(), getWhatsAppOAuthPhones: vi.fn(), selectWhatsAppOAuthPhone: vi.fn(), disconnectWhatsAppOAuth: vi.fn(),
}));
vi.mock('../../services/admin.service', () => ({ adminService: admin }));
vi.mock('../../services/webhooks.service', () => ({ webhooksService: { getWebhooks: vi.fn().mockResolvedValue({ webhooks: [] }) } }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: vi.fn().mockResolvedValue([]) } }));

vi.mock('../../components/settings/integrations/MetaAdsIntegration', () => ({ MetaAdsIntegration: () => <div>META ADS CARD</div> }));
vi.mock('../../components/settings/integrations/McpIntegration', () => ({ McpIntegration: () => <div>AI KEYS CARD</div> }));

let role: 'super_admin' | 'admin' | 'manager' = 'super_admin';
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (r: string) => role !== 'manager' || r === 'settings',
    isSuperAdmin: role === 'super_admin',
    isAdmin: role !== 'manager',
  }),
}));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 1, email: 'owner@shop.com' } }) }));

const card = (over = {}) => ({ status: 'connected', reason: null, lastEventAt: null, ...over });
const CARDS = {
  sms: card({ lastEventAt: new Date().toISOString() }),
  whatsapp: card({ status: 'not_connected', reason: 'Connect your WhatsApp Business number' }),
  email: card({ provider: 'smtp' }),
  paystack: card({ mode: 'test' }),
  meta: card({ accounts: 1 }),
  checkout: card({ forms: 2, lastOrderAt: null }),
  csv: card({ templateUrl: '/api/connections/csv/template' }),
};
const CONFIG = {
  smsProvider: { provider: 'arkesel', authToken: '••••••••', senderId: 'MagicGroove', isEnabled: true },
  whatsappProvider: {}, emailProvider: undefined, tenantSlug: 'acme',
};
const PAYSTACK = { id: 7, provider: 'paystack', mode: 'test', publicKey: 'pk_test_abc', secretKey: '••••••••', hasSecret: true, isEnabled: true, lastCheckedAt: null, legacy: false };

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const renderPage = (url = '/connections') => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/connections" element={<Connections />} />
        <Route path="/webhooks" element={<WebhooksRedirect />} />
        <Route path="*" element={<div>ELSEWHERE</div>} />
      </Routes>
    </MemoryRouter>
  </ToastProvider>,
);

const cardOf = (name: string) => screen.getByTestId(`card-${name}`);
/** Click a card and return its modal. */
const openCard = async (name: string) => {
  await userEvent.click(await screen.findByTestId(`card-${name}`));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  vi.clearAllMocks();
  role = 'super_admin';
  svc.getCards.mockResolvedValue(CARDS);
  svc.getPaymentConnections.mockResolvedValue([PAYSTACK]);
  svc.getSmsReportUrl.mockResolvedValue({ url: 'https://api.shop.com/api/sms/webhook?token=abc' });
  svc.savePaymentConnection.mockResolvedValue({ ...PAYSTACK });
  svc.testPaymentConnection.mockResolvedValue({ ok: true, message: 'ok' });
  admin.getSystemConfig.mockResolvedValue(CONFIG);
  admin.updateSystemConfig.mockResolvedValue({});
  admin.checkWhatsAppOAuthEnabled.mockResolvedValue({ enabled: true });
});

describe('Connections page (M9-T44)', () => {
  it('shows a card for each connection with its facts, and no partner key card', async () => {
    renderPage();
    const sms = await screen.findByTestId('card-Arkesel SMS');
    expect(within(sms).getByText('MagicGroove')).toBeInTheDocument();
    expect(within(sms).getByText('Connected')).toBeInTheDocument();
    expect(within(cardOf('Paystack')).getByText('Test mode')).toBeInTheDocument();
    expect(within(cardOf('Paystack')).getByText('pk_test_abc')).toBeInTheDocument();
    expect(within(cardOf('Your own email (SMTP)')).getByText('Connected')).toBeInTheDocument();
    expect(within(cardOf('Your own email (SMTP)')).getByText('SMTP')).toBeInTheDocument();
    expect(screen.queryByText('CodAdmin sender (Resend)')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-Checkout website')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-CSV upload')).not.toBeInTheDocument();
    expect(screen.getByText('META ADS CARD')).toBeInTheDocument();
    expect(screen.getByText('AI KEYS CARD')).toBeInTheDocument();
    expect(screen.queryByText(/partner key/i)).not.toBeInTheDocument();
  });

  it('shows the delivery-report URL in the SMS modal with a copy button', async () => {
    renderPage();
    const dlg = await openCard('Arkesel SMS');
    expect(await within(dlg).findByText('https://api.shop.com/api/sms/webhook?token=abc')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: /Copy report URL/ })).toBeInTheDocument();
  });

  it('a card that is not set up shows the API reason, and its modal has Connect', async () => {
    renderPage();
    const wa = await screen.findByTestId('card-WhatsApp Business');
    expect(within(wa).getByText('Not connected')).toBeInTheDocument();
    expect(within(wa).getByText('Connect your WhatsApp Business number')).toBeInTheDocument();
    expect(within(wa).queryByRole('button')).not.toBeInTheDocument();
    expect(within(await openCard('WhatsApp Business')).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('a card in error shows the reason from the API and a Retry that checks again', async () => {
    svc.getCards.mockResolvedValue({ ...CARDS, whatsapp: card({ status: 'error', reason: 'The WhatsApp connection expired. Reconnect WhatsApp.' }) });
    admin.getWhatsAppStatus.mockResolvedValue({ configured: true });
    renderPage();
    const wa = await openCard('WhatsApp Business');
    expect(within(wa).getByRole('alert')).toHaveTextContent('The WhatsApp connection expired. Reconnect WhatsApp.');
    const before = svc.getCards.mock.calls.length;
    await userEvent.click(within(wa).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(admin.getWhatsAppStatus).toHaveBeenCalled());
    await waitFor(() => expect(svc.getCards.mock.calls.length).toBeGreaterThan(before));
  });

  it('?error=start_again shows "The login expired. Start again." and clears the parameter', async () => {
    renderPage('/connections?error=start_again');
    expect(await screen.findByText('The login expired. Start again.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/connections$/);
  });

  it('the email card is Not connected until the store saves its own sender, and says where mail goes meanwhile', async () => {
    svc.getCards.mockResolvedValue({ ...CARDS, email: card({ status: 'not_connected', provider: null, reason: "Until you add one, emails go out from CodAdmin's sender." }) });
    renderPage();
    const email = await screen.findByTestId('card-Your own email (SMTP)');
    expect(within(email).getByText('Not connected')).toBeInTheDocument();
    expect(within(email).getByText("Until you add one, emails go out from CodAdmin's sender.")).toBeInTheDocument();
    expect(within(email).queryByText('CodAdmin sender (Resend)')).not.toBeInTheDocument();
    expect(within(await openCard('Your own email (SMTP)')).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('SMTP test shows the server error text', async () => {
    svc.testSmtp.mockRejectedValue({ isAxiosError: true, response: { data: { error: 'Invalid login: 535 Authentication failed' } } });
    renderPage();
    await userEvent.click(within(await openCard('Your own email (SMTP)')).getByRole('button', { name: 'Edit' }));
    await userEvent.selectOptions(await screen.findByLabelText('Sender'), 'smtp');
    await userEvent.type(screen.getByLabelText('Host'), 'smtp.mail.example');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.type(screen.getByLabelText('From email'), 'hello@shop.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText('Invalid login: 535 Authentication failed')).toBeInTheDocument();
    expect(svc.testSmtp).toHaveBeenCalledWith(expect.objectContaining({ smtpHost: 'smtp.mail.example', password: 'secret', fromEmail: 'hello@shop.com' }));
  });

  it('Paystack save goes to /api/payment-connections and shows the wrong-prefix message from the API', async () => {
    svc.savePaymentConnection.mockRejectedValue({ isAxiosError: true, response: { data: { error: 'A live key must start with sk_live_' } } });
    renderPage();
    await userEvent.click(within(await openCard('Paystack')).getByRole('button', { name: 'Edit keys' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Live' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A live key must start with sk_live_')).toBeInTheDocument();
    expect(svc.savePaymentConnection).toHaveBeenCalledWith(expect.objectContaining({ provider: 'paystack', mode: 'live', publicKey: 'pk_test_abc' }));
  });

  it('SMS save writes the Arkesel settings', async () => {
    renderPage();
    await userEvent.click(within(await openCard('Arkesel SMS')).getByRole('button', { name: 'Edit' }));
    const sender = await screen.findByLabelText('Sender ID');
    await userEvent.clear(sender);
    await userEvent.type(sender, 'NewName');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(admin.updateSystemConfig).toHaveBeenCalledWith({ smsProvider: expect.objectContaining({ provider: 'arkesel', senderId: 'NewName' }) }));
  });

  it('an admin edits SMS, WhatsApp, Email and Paystack like the owner, but has no AI keys card', async () => {
    role = 'admin';
    renderPage();
    await screen.findByTestId('card-Paystack');
    expect(within(await openCard('Paystack')).getByRole('button', { name: 'Edit keys' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(within(await openCard('Arkesel SMS')).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(within(await openCard('WhatsApp Business')).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(within(await openCard('Your own email (SMTP)')).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByText('AI KEYS CARD')).not.toBeInTheDocument();
    expect(admin.getSystemConfig).toHaveBeenCalled();
  });

  it('a person who may only view opens every modal, reads the details and sees one line instead of buttons', async () => {
    role = 'manager';
    renderPage();
    for (const name of ['Arkesel SMS', 'WhatsApp Business', 'Your own email (SMTP)', 'Paystack']) {
      const dlg = await openCard(name);
      expect(within(dlg).getByText('Only the owner or an admin can change this.')).toBeInTheDocument();
      expect(within(dlg).queryByRole('button', { name: /Edit|Connect|Add keys/ })).not.toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    expect(svc.getPaymentConnections).not.toHaveBeenCalled();
    expect(admin.getSystemConfig).not.toHaveBeenCalled();
  });

  it('the whole card opens its modal with Enter or Space, and Escape gives the focus back to the card', async () => {
    renderPage();
    const sms = await screen.findByTestId('card-Arkesel SMS');
    expect(sms).toHaveAttribute('role', 'button');
    sms.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sms).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a card shows a summary of two facts at most and a Manage hint, and no action buttons', async () => {
    renderPage();
    const pay = await screen.findByTestId('card-Paystack');
    expect(within(pay).getByText('Manage')).toBeInTheDocument();
    expect(within(pay).queryByRole('button')).not.toBeInTheDocument();
    expect(pay.querySelectorAll('dt').length).toBeLessThanOrEqual(2);
    const wa = await screen.findByTestId('card-WhatsApp Business');
    expect(wa.querySelectorAll('dt').length).toBeLessThanOrEqual(2);
  });

  it('/webhooks redirects to the Webhooks tab of Connections', async () => {
    renderPage('/webhooks');
    await screen.findByRole('heading', { name: 'Connections' });
    expect(screen.getByTestId('where')).toHaveTextContent('/connections?tab=webhooks');
  });
});
