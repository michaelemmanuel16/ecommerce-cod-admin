import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Messages } from '../../pages/Messages';
import { figures, logRow } from '../fixtures/messages';

const svc = vi.hoisted(() => ({ overview: vi.fn(), log: vi.fn(), listConversations: vi.fn() }));
vi.mock('../../services/messages.service', () => ({ messagesService: svc }));
vi.mock('../../services/communication.service', () => ({ communicationService: { getCampaigns: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ user: { id: 5, role: 'manager' }, isManager: true, isAdmin: false, can: (r: string, a: string) => r === 'messages' && a === 'view' }),
}));

// One number, used by the tile and by the log: both screens must show what the API says
const SENT = 120;
const renderPage = (path = '/messages') => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/messages" element={<Messages />} /></Routes>
    </MemoryRouter>
  </ToastProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  svc.overview.mockResolvedValue({ channels: {}, total: figures({ sent: SENT, delivered: 110, deliveredRate: 91.7, read: 60, readRate: 50, failed: 6, failedRate: 5, replied: 12, replyRate: 10, skipped: 3 }) });
  svc.log.mockResolvedValue({ items: [logRow(), logRow({ id: 2, status: 'failed', errorMessage: 'Number is not on WhatsApp', order: null, customer: null, recipient: '+233249999999' })], total: SENT, nextCursor: null });
  svc.listConversations.mockResolvedValue({ items: [], nextCursor: null });
});

describe('Messages page: Overview', () => {
  it('opens on Overview and shows the counts and rates the API gives, for This month', async () => {
    renderPage();
    const sent = (await screen.findByText('Sent', { selector: '.kpi .l' })).closest('.kpi') as HTMLElement;
    expect(within(sent).getByText('120')).toBeInTheDocument();
    const delivered = screen.getByText('Delivered', { selector: '.kpi .l' }).closest('.kpi') as HTMLElement;
    expect(within(delivered).getByText('110')).toBeInTheDocument();
    expect(within(delivered).getByText(/91\.7% of sent/)).toBeInTheDocument();
    expect(screen.getByText('Failed', { selector: '.kpi .l' }).closest('.kpi')).toHaveTextContent('5% of sent');
    const first = svc.overview.mock.calls[0][0];
    expect(first.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(first.channel).toBeUndefined();
  });

  it('a new range or channel asks the API again', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Sent', { selector: '.kpi .l' });
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => { const a = svc.overview.mock.calls.at(-1)![0]; expect(a.from).toBe(a.to); });
    await user.selectOptions(screen.getByLabelText('Channel'), 'sms');
    await waitFor(() => expect(svc.overview.mock.calls.at(-1)![0].channel).toBe('sms'));
  });

  it('shows a dash for a rate when nothing was sent', async () => {
    svc.overview.mockResolvedValue({ channels: {}, total: figures({ sent: 0, delivered: 0, read: 0, failed: 0, replied: 0, skipped: 0, deliveredRate: null, readRate: null, failedRate: null, replyRate: null }) });
    renderPage();
    expect((await screen.findByText('Delivered', { selector: '.kpi .l' })).closest('.kpi')).toHaveTextContent('- of sent');
  });

  it('a tile links to the log with its status and range, and that log shows the same total', async () => {
    renderPage();
    const sent = (await screen.findByText('Sent', { selector: '.kpi .l' })).closest('.kpi') as HTMLElement;
    const link = within(sent).getByRole('link', { name: /Show sent messages in the log/ });
    expect(link).toHaveAttribute('href', '/messages?tab=log&status=sent&range=month');
    renderPage('/messages?tab=log&status=sent&range=month');
    expect(await screen.findByText(`Showing 50 of ${SENT} messages`)).toBeInTheDocument();
    expect(svc.log.mock.calls.at(-1)![0]).toMatchObject({ status: 'sent' });
  });
});

describe('Messages page: Message log', () => {
  it('lists rows with links to the customer and the order, and the failure reason', async () => {
    renderPage('/messages?tab=log');
    const row = (await screen.findByText('Ama Mensah')).closest('tr') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Ama Mensah' })).toHaveAttribute('href', '/customers/7');
    expect(within(row).getByRole('link', { name: '#55' })).toHaveAttribute('href', '/orders/55');
    expect(within(row).getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText('Number is not on WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('+233249999999')).toBeInTheDocument();
  });

  it('shows "No messages yet" when there are none', async () => {
    svc.log.mockResolvedValue({ items: [], total: 0, nextCursor: null });
    renderPage('/messages?tab=log');
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
  });

  it('channel, status, range and search change the request, and a filter with no rows says so', async () => {
    const user = userEvent.setup();
    renderPage('/messages?tab=log');
    await screen.findByText('Ama Mensah');
    await user.selectOptions(screen.getByLabelText('Channel'), 'whatsapp');
    await user.selectOptions(screen.getByLabelText('Status'), 'failed');
    await user.selectOptions(screen.getByLabelText('Date range'), 'today');
    await user.type(screen.getByLabelText('Search by phone or name'), 'ama');
    await waitFor(() => expect(svc.log.mock.calls.at(-1)![0]).toMatchObject({ channel: 'whatsapp', status: 'failed', recipient: 'ama' }));
    const last = svc.log.mock.calls.at(-1)![0];
    expect(last.from).toBe(last.to);
    svc.log.mockResolvedValue({ items: [], total: 0, nextCursor: null });
    await user.selectOptions(screen.getByLabelText('Status'), 'read');
    expect(await screen.findByText('No message matches these filters')).toBeInTheDocument();
  });

  it('pages with the cursor from the API and goes back', async () => {
    svc.log.mockResolvedValueOnce({ items: [logRow({ id: 1 })], total: 120, nextCursor: 'CUR2' });
    svc.log.mockResolvedValueOnce({ items: [logRow({ id: 2, customer: { id: 8, name: 'Kofi Page Two' } })], total: 120, nextCursor: null });
    const user = userEvent.setup();
    renderPage('/messages?tab=log');
    await screen.findByText('Ama Mensah');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Kofi Page Two')).toBeInTheDocument();
    expect(svc.log.mock.calls.at(-1)![0].cursor).toBe('CUR2');
    svc.log.mockResolvedValue({ items: [logRow({ id: 1 })], total: 120, nextCursor: 'CUR2' });
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument();
    expect(svc.log.mock.calls.at(-1)![0].cursor).toBeUndefined();
  });
});
