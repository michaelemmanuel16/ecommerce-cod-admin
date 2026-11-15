import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Messages } from '../../pages/Messages';

const svc = vi.hoisted(() => ({
  listConversations: vi.fn(), listTemplates: vi.fn(), createTemplate: vi.fn(), updateTemplate: vi.fn(), deleteTemplate: vi.fn(), syncTemplates: vi.fn(),
}));
vi.mock('../../services/messages.service', () => ({ messagesService: svc }));
vi.mock('../../services/communication.service', () => ({ communicationService: { getCampaigns: vi.fn().mockResolvedValue([]) } }));

let role: 'admin' | 'manager' = 'admin';
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    user: { id: 5, role }, isManager: true, isAdmin: role === 'admin',
    can: (r: string, a: string) => r === 'messages' && (a === 'view' || role === 'admin'),
  }),
}));

const tpl = (id: number, over: Record<string, unknown> = {}) => ({
  id, channel: 'sms', name: `Template ${id}`, key: null, subject: null, body: `Body ${id}`, variables: [], language: null, category: null,
  status: null, rejectReason: null, metaTemplateName: null, quickReplies: null, sendable: true, createdAt: '', updatedAt: '', ...over,
});
const LIST = [
  tpl(1, { name: 'Out for delivery', body: 'Your order is on the way' }),
  tpl(2, { channel: 'whatsapp', name: 'Order confirm', body: 'Hello {{1}}', status: 'approved', language: 'en_US', category: 'UTILITY' }),
  tpl(3, { channel: 'whatsapp', name: 'Review ask', body: 'How is it?', status: 'pending', sendable: false }),
  tpl(4, { channel: 'whatsapp', name: 'Promo', body: 'Sale', status: 'rejected', rejectReason: 'INVALID_FORMAT', sendable: false }),
  tpl(5, { channel: 'email', name: 'Receipt', subject: 'Order {{order_number}}', body: '<p>Hi {{customer_name}}</p>' }),
];

const renderTab = () => render(
  <ToastProvider>
    <MemoryRouter initialEntries={['/messages?tab=templates']}>
      <Routes><Route path="/messages" element={<Messages />} /></Routes>
    </MemoryRouter>
  </ToastProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  svc.listConversations.mockResolvedValue({ items: [], nextCursor: null });
  svc.listTemplates.mockResolvedValue(LIST);
  svc.createTemplate.mockResolvedValue(tpl(9));
  svc.updateTemplate.mockResolvedValue(tpl(1));
  svc.deleteTemplate.mockResolvedValue(undefined);
  svc.syncTemplates.mockResolvedValue({ created: 2, updated: 1, total: 3 });
});

describe('Messages page: Templates', () => {
  it('lists every channel in one list and shows the Meta status of each WhatsApp template', async () => {
    renderTab();
    expect(await screen.findByText('Out for delivery')).toBeInTheDocument();
    const card = (name: string) => screen.getByText(name).closest('.tpl') as HTMLElement;
    expect(within(card('Out for delivery')).getByText('SMS')).toBeInTheDocument();
    expect(within(card('Order confirm')).getByText('Approved')).toBeInTheDocument();
    expect(within(card('Review ask')).getByText('Pending')).toBeInTheDocument();
    expect(within(card('Promo')).getByText('Rejected')).toBeInTheDocument();
    expect(within(card('Promo')).getByText(/INVALID_FORMAT/)).toBeInTheDocument();
    expect(within(card('Receipt')).getByText('Email')).toBeInTheDocument();
    expect(within(card('Receipt')).queryByText('Approved')).toBeNull();
  });

  it('asks the API again with the channel and the search', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Out for delivery');
    await user.selectOptions(screen.getByLabelText('Channel'), 'whatsapp');
    await waitFor(() => expect(svc.listTemplates).toHaveBeenLastCalledWith({ channel: 'whatsapp' }));
    await user.type(screen.getByLabelText('Search templates'), 'promo');
    await waitFor(() => expect(svc.listTemplates).toHaveBeenLastCalledWith({ channel: 'whatsapp', q: 'promo' }));
  });

  it('shows an empty state', async () => {
    svc.listTemplates.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
  });

  it('creates an SMS template with the channel, name and body', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /New template/ }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText('Template name'), 'Restock');
    await user.type(within(dlg).getByLabelText('Message'), 'Pens are back');
    expect(within(dlg).getByTestId('preview-bubble')).toHaveTextContent('Pens are back');
    await user.click(within(dlg).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(svc.createTemplate).toHaveBeenCalledWith({ channel: 'sms', name: 'Restock', body: 'Pens are back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('an email template needs a subject, and a merge tag chip inserts into the body and shows sample data in the preview', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /New template/ }));
    const dlg = screen.getByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Email' }));
    await user.type(within(dlg).getByLabelText('Template name'), 'Hello mail');
    await user.click(within(dlg).getByLabelText(/Message/));
    await user.click(within(dlg).getByRole('button', { name: 'Customer name' }));
    expect(within(dlg).getByLabelText(/Message/)).toHaveValue('{{customer_name}}');
    expect(within(dlg).getByRole('button', { name: 'Save template' })).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText('Subject'), { target: { value: 'Hi {{customer_name}}' } });
    expect(within(dlg).getByText('Hi Ama Mensah')).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(svc.createTemplate).toHaveBeenCalledWith({ channel: 'email', name: 'Hello mail', subject: 'Hi {{customer_name}}', body: '{{customer_name}}' }));
  });

  it('shows the API validation message inside the dialog and keeps it open', async () => {
    svc.createTemplate.mockRejectedValue({ response: { data: { message: 'A template with this name already exists' } } });
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /New template/ }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText('Template name'), 'Restock');
    await user.type(within(dlg).getByLabelText('Message'), 'x');
    await user.click(within(dlg).getByRole('button', { name: 'Save template' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('A template with this name already exists');
  });

  it('edits a template with PUT and keeps its channel fixed', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Edit Out for delivery' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).queryByRole('button', { name: 'WhatsApp' })).toBeNull();
    const body = within(dlg).getByLabelText('Message');
    await user.clear(body);
    await user.type(body, 'On the way');
    await user.click(within(dlg).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(svc.updateTemplate).toHaveBeenCalledWith(1, { name: 'Out for delivery', body: 'On the way' }));
  });

  it('deletes after a confirm', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Delete Out for delivery' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(svc.deleteTemplate).toHaveBeenCalledWith(1));
  });

  it('Sync from Meta calls the sync and reloads the list', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Out for delivery');
    await user.click(screen.getByRole('button', { name: /Sync from Meta/ }));
    await waitFor(() => expect(svc.syncTemplates).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Synced from Meta: 2 new, 1 updated')).toBeInTheDocument();
    await waitFor(() => expect(svc.listTemplates).toHaveBeenCalledTimes(2));
  });

  it('shows the API sentence when the sync is refused', async () => {
    svc.syncTemplates.mockRejectedValue({ response: { data: { message: 'WhatsApp is not set up.' } } });
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: /Sync from Meta/ }));
    expect(await screen.findByText('WhatsApp is not set up.')).toBeInTheDocument();
  });

  it('a manager reads the list and has no write controls', async () => {
    role = 'manager';
    renderTab();
    expect(await screen.findByText('Out for delivery')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New template/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sync from Meta/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
  });
});

describe('the old MessageTemplates component', () => {
  it('is imported by nothing', () => {
    const files = import.meta.glob('../../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const users = Object.entries(files)
      .filter(([path]) => !path.includes('/__tests__/'))
      .filter(([, text]) => /integrations\/MessageTemplates|pages\/Communications|from '\.\/Communications'/.test(text))
      .map(([path]) => path);
    expect(users).toEqual([]);
  });
});
