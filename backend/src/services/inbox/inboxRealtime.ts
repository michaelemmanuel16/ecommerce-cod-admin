import { Notification } from '@prisma/client';
import logger from '../../utils/logger';
import { getSocketInstance } from '../../utils/socketInstance';
import { emitInboxCounts, emitInboxNew } from '../../sockets';
import { getCounts, present } from './inboxFeedService';

/** Tell one person's open screens about a new row. A socket problem never fails the caller. */
export async function pushInboxNew(row: Notification): Promise<void> {
  const io = getSocketInstance();
  if (!io) return;
  try {
    emitInboxNew(io, String(row.userId), present(row, new Set()), row.tenantId);
    emitInboxCounts(io, String(row.userId), await getCounts(row.userId), row.tenantId);
  } catch (error) {
    logger.warn('Inbox: realtime push failed', { userId: row.userId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Send the person's fresh counts (after read, done, snooze or mark all). */
export async function pushInboxCounts(userId: number, tenantId: string): Promise<void> {
  const io = getSocketInstance();
  if (!io) return;
  try {
    emitInboxCounts(io, String(userId), await getCounts(userId), tenantId);
  } catch (error) {
    logger.warn('Inbox: counts push failed', { userId, error: error instanceof Error ? error.message : String(error) });
  }
}
