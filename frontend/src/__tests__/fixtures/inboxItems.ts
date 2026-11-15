import type { InboxCounts, InboxItem } from '../../services/inbox.service';

export const COUNTS: InboxCounts = { all: 3, assigned: 1, mentions: 1, reminders: 1, notes: 0, alerts: 1, replies: 0 };

export const item = (id: number, over: Partial<InboxItem> = {}): InboxItem => ({
  id, kind: 'alert', event: 'order_assigned', title: `Title ${id}`, message: `Message ${id}`, data: null,
  isRead: false, readAt: null, doneAt: null, snoozedUntil: null, createdAt: '2026-11-14T10:00:00.000Z',
  userId: 1, actorId: null, actorName: null, subject: null, subjectDeleted: false, subjectAccessible: true, ...over,
});

/** A socket stand-in: handlers by event name, and a way to fire them. */
export function fakeSocket(connected = true) {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const socket = {
    connected,
    on: (e: string, h: (...a: unknown[]) => void) => { (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h); },
    off: (e: string, h: (...a: unknown[]) => void) => { handlers.get(e)?.delete(h); },
    fire: (e: string, ...a: unknown[]) => { handlers.get(e)?.forEach((h) => h(...a)); },
    count: (e: string) => handlers.get(e)?.size ?? 0,
  };
  return socket;
}
