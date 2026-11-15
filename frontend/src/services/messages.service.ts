import { apiClient } from './api';
import type { Assignee, ConversationList, Channel, LogPage, LogStatus, Overview, ReplyTemplate, Thread, TrackedMessages } from '../pages/messages/types';

// Every call is quiet: the page shows the server's sentence itself (a toast or an inline line).
const quiet = { quiet: true } as const;

export interface ConversationQuery {
  status?: 'open' | 'done';
  unanswered?: boolean;
  assignedTo?: 'me' | 'none' | number;
  q?: string;
  cursor?: string;
}

export interface MessageFilters {
  channel?: Channel;
  from?: string;
  to?: string;
}

export const messagesService = {
  /** GET /api/conversations. The API scopes it: a rep gets only the conversations they can see. */
  async listConversations(query: ConversationQuery): Promise<ConversationList> {
    const { data } = await apiClient.get<ConversationList>('/api/conversations', { params: { ...query, unanswered: query.unanswered === undefined ? undefined : String(query.unanswered) }, skipCache: true, ...quiet });
    return data;
  },

  async getThread(id: number): Promise<Thread> {
    const { data } = await apiClient.get<Thread>(`/api/conversations/${id}/messages`, { skipCache: true, ...quiet });
    return data;
  },

  /** Free text (window open) or an approved template (any time). */
  async reply(id: number, payload: { body: string } | { templateId: number; variables: string[] }): Promise<void> {
    await apiClient.post(`/api/conversations/${id}/reply`, payload, quiet);
  },

  async update(id: number, patch: { assignedToId?: number | null; status?: 'open' | 'done' }): Promise<void> {
    await apiClient.patch(`/api/conversations/${id}`, patch, quiet);
  },

  /** The approved WhatsApp templates a closed window allows. */
  async approvedTemplates(): Promise<ReplyTemplate[]> {
    const { data } = await apiClient.get<{ items: ReplyTemplate[] }>('/api/message-templates', { params: { channel: 'whatsapp', status: 'approved' }, ...quiet });
    return data.items.filter((t) => t.sendable);
  },

  /** People a conversation can go to: active staff who can open Conversations. The API checks the choice again on save. */
  async assignees(): Promise<Assignee[]> {
    const { data } = await apiClient.get<{ users: Array<{ id: number; firstName: string; lastName: string; role: string; isActive: boolean }> }>('/api/users', { params: { isActive: 'true', limit: 100 }, ...quiet });
    return data.users
      .filter((u) => u.isActive && ['super_admin', 'admin', 'manager', 'sales_rep'].includes(u.role))
      .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }));
  },

  /** GET /api/messages/overview: the tiles. Same definition as the log (backend messageStats.ts). */
  async overview(filters: MessageFilters): Promise<Overview> {
    const { data } = await apiClient.get<Overview>('/api/messages/overview', { params: filters, skipCache: true, ...quiet });
    return data;
  },

  async log(filters: MessageFilters & { status?: LogStatus; recipient?: string; cursor?: string; limit?: number }): Promise<LogPage> {
    const { data } = await apiClient.get<LogPage>('/api/messages/log', { params: filters, skipCache: true, ...quiet });
    return data;
  },

  /** GET /api/orders/:id/messages or /api/customers/:id/messages: what was sent about one order or to one customer, with status. */
  async forSubject(type: 'order' | 'customer', id: number): Promise<TrackedMessages> {
    const { data } = await apiClient.get<TrackedMessages>(`/api/${type}s/${id}/messages`, { skipCache: true, ...quiet });
    return data;
  },
};
