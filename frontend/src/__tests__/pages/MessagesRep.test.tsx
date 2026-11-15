import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Messages } from '../../pages/Messages';
import { tabsFor } from '../../pages/messages/tabs';
import { conversation, message, thread } from '../fixtures/messages';

const svc = vi.hoisted(() => ({
  listConversations: vi.fn(), getThread: vi.fn(), reply: vi.fn(), update: vi.fn(), approvedTemplates: vi.fn(), assignees: vi.fn(),
  overview: vi.fn(), log: vi.fn(), listTemplates: vi.fn(), listOptOuts: vi.fn(),
}));
vi.mock('../../services/messages.service', () => ({ messagesService: svc }));
vi.mock('../../services/communication.service', () => ({ communicationService: { getCampaigns: vi.fn(), getRecipients: vi.fn() } }));

// A call rep: not a manager, with the default messages view and create cells
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ user: { id: 7, role: 'sales_rep' }, isManager: false, isAdmin: false, can: (r: string, a: string) => r === 'messages' && (a === 'view' || a === 'create') }),
}));

const renderPage = (path: string) => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/messages" element={<Messages />} /></Routes>
    </MemoryRouter>
  </ToastProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  svc.listConversations.mockResolvedValue({ items: [conversation()], nextCursor: null });
  svc.getThread.mockResolvedValue(thread([message({ id: 1, direction: 'inbound', status: 'delivered', messageBody: 'Where is my order?' })]));
  svc.reply.mockResolvedValue(undefined);
  svc.assignees.mockResolvedValue([]);
  svc.approvedTemplates.mockResolvedValue([]);
});

describe('Messages page: a call rep', () => {
  it('sees the Conversations tab only', async () => {
    renderPage('/messages');
    await screen.findByRole('button', { name: /Ama Mensah/ });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Conversations']);
    expect(svc.overview).not.toHaveBeenCalled();
  });

  it.each(['overview', 'log', 'bulk', 'campaigns', 'templates', 'optouts'])('cannot open the %s tab by its address', async (tab) => {
    renderPage(`/messages?tab=${tab}`);
    await screen.findByRole('button', { name: /Ama Mensah/ });
    expect(svc.overview).not.toHaveBeenCalled();
    expect(svc.log).not.toHaveBeenCalled();
    expect(svc.listTemplates).not.toHaveBeenCalled();
    expect(svc.listOptOuts).not.toHaveBeenCalled();
  });

  it('can reply to a customer', async () => {
    const user = userEvent.setup();
    renderPage('/messages');
    await user.click(await screen.findByRole('button', { name: /Ama Mensah/ }));
    await user.type(await screen.findByRole('textbox', { name: /reply/i }), 'It leaves today');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(svc.reply).toHaveBeenCalledWith(1, { body: 'It leaves today' }));
  });
});

describe('tabsFor', () => {
  it('gives a manager every tab but Bulk send, and an admin with messages:create all of them', () => {
    expect(tabsFor({ isManager: true, isAdmin: false, canCreate: false }).map((t) => t.key)).toEqual(['overview', 'conversations', 'log', 'campaigns', 'templates', 'optouts']);
    expect(tabsFor({ isManager: true, isAdmin: true, canCreate: true })).toHaveLength(7);
    expect(tabsFor({ isManager: false, isAdmin: false, canCreate: true }).map((t) => t.key)).toEqual(['conversations']);
  });
});
