import apiClient from './api';

/** The Inbox APIs (M9-T17, T18, T19): the feed and its counts, reminders, and threads by subject. */

export const INBOX_VIEWS = ['all', 'assigned', 'mentions', 'reminders', 'notes', 'alerts', 'replies'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];
export type InboxStatus = 'open' | 'done' | 'snoozed';
export type InboxKind = 'alert' | 'reply' | 'mention' | 'reminder' | 'note' | 'system';

export type InboxCounts = Record<InboxView, number>;

export interface InboxSubject { type: string; id: number }

export interface InboxItem {
  id: number;
  kind: InboxKind;
  /** The event name, for example `mention` or `overdue_collections`. */
  event: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  doneAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  userId: number;
  actorId: number | null;
  /** Who caused it. null for a system row. */
  actorName?: string | null;
  subject: InboxSubject | null;
  subjectDeleted: boolean;
  /** false: the link is greyed (the item was deleted, or it now belongs to someone else). */
  subjectAccessible: boolean;
}

export interface InboxPage { items: InboxItem[]; nextCursor: string | null }

export interface InboxQuery { view: InboxView; status: InboxStatus; scope?: 'mine' | 'all'; cursor?: string; limit?: number }

export interface Reminder {
  id: number;
  createdById: number;
  assignedToId: number;
  subjectType: string | null;
  subjectId: number | null;
  note: string;
  dueAt: string;
  status: 'pending' | 'sent' | 'cancelled';
}

export interface ThreadComment {
  id: number;
  parentId: number | null;
  authorId: number;
  authorName: string;
  body: string;
  mentionIds: number[];
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  replies?: ThreadComment[];
}

export interface Thread {
  id: number | null;
  subjectType: string;
  subjectId: number;
  archived: boolean;
  unreadCount: number;
  comments: ThreadComment[];
}

export interface Mentionable { id: number; name: string; role: string }

export const inboxService = {
  async list(q: InboxQuery): Promise<InboxPage> {
    const { data } = await apiClient.get('/api/inbox', { params: q });
    return { items: data.items ?? [], nextCursor: data.nextCursor ?? null };
  },

  async counts(): Promise<InboxCounts> {
    const { data } = await apiClient.get('/api/inbox/counts');
    return data.counts;
  },

  async patch(id: number, body: { read?: boolean; done?: boolean; snoozedUntil?: string | null }): Promise<{ item: InboxItem; counts: InboxCounts }> {
    const { data } = await apiClient.patch(`/api/inbox/${id}`, body);
    return data;
  },

  async markAll(view: InboxView): Promise<{ updated: number; counts: InboxCounts }> {
    const { data } = await apiClient.post('/api/inbox/mark-all', { view });
    return data;
  },

  async createReminder(body: { note: string; dueAt: string; subjectType?: string; subjectId?: number }): Promise<Reminder> {
    const { data } = await apiClient.post('/api/reminders', body);
    return data.reminder;
  },

  async listReminders(status: Reminder['status'] = 'pending'): Promise<Reminder[]> {
    const { data } = await apiClient.get('/api/reminders', { params: { status, mine: 1 } });
    return data.reminders ?? [];
  },

  async cancelReminder(id: number): Promise<void> {
    await apiClient.delete(`/api/reminders/${id}`);
  },

  async getThread(type: string, id: number): Promise<Thread> {
    const { data } = await apiClient.get(`/api/threads/by-subject/${type}/${id}`);
    return data.thread;
  },

  async mentionable(type: string, id: number): Promise<Mentionable[]> {
    const { data } = await apiClient.get(`/api/threads/by-subject/${type}/${id}/mentionable`);
    return data.people ?? [];
  },

  async addComment(type: string, id: number, body: { body: string; parentId?: number; mentionIds?: number[] }): Promise<ThreadComment> {
    const { data } = await apiClient.post(`/api/threads/by-subject/${type}/${id}/comments`, body);
    return data.comment;
  },
};
