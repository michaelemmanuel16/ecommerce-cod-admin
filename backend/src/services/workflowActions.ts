import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { OrderStatus } from '@prisma/client';
import { transitionOrder } from './orderStateMachine';
import { systemActor } from './systemUserService';
import { setOrderPriorityAndNotes } from './orderService';

/**
 * Order writes shared by the two workflow executors (the Bull job in queues/workflowQueue.ts and
 * WorkflowService's synchronous one). Neither file writes the order itself (M2-T16).
 */

/** The status an `update_order` action sets: the editor writes `config.status`; older shapes are still read. */
export function workflowStatus(action: any): OrderStatus | undefined {
  return action.config?.status ?? action.status ?? action.config?.updates?.status;
}

/** Words an `update_order` priority may use. Order.priority is an Int; the editor's own words are 'medium' and 'normal'. */
const PRIORITY_WORDS: Record<string, number> = { low: 1, normal: 5, medium: 5, high: 10, urgent: 15 };
const MAX_NOTE_LENGTH = 1000;

function parsePriority(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (text in PRIORITY_WORDS) return PRIORITY_WORDS[text];
    if (/^-?\d+$/.test(text)) return Number(text);
  }
  throw new Error(`update_order priority must be an integer or one of ${Object.keys(PRIORITY_WORDS).join(', ')}`);
}

function parseNotes(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Error('update_order notes must be a non-empty string');
  if (text.length > MAX_NOTE_LENGTH) throw new Error(`update_order notes must be at most ${MAX_NOTE_LENGTH} characters`);
  return text;
}

/**
 * Apply an `update_order` action: status, priority and notes, nothing else. Status moves through the
 * state machine as the system user, first; `depth` is the depth of the run that caused the move (loop
 * guard, M2-T17) and the move carries depth + 1. Priority and notes are one tenant-scoped write (setOrderPriorityAndNotes); notes are
 * appended to the staff notes. No field is an error, not a no-op. A priority/notes-only update fires no
 * status-changed workflow. Returns what was set and whether the status really moved.
 */
export async function updateOrderByWorkflow(orderId: number, action: any, depth: number = 0) {
  const status = workflowStatus(action);
  const rawPriority = action.config?.priority ?? action.priority;
  const rawNotes = action.config?.notes ?? action.notes;
  if (!status && rawPriority == null && rawNotes == null) {
    throw new Error('update_order needs a status, priority or notes');
  }
  // Validate everything before the status moves, so a bad priority leaves the order untouched.
  const priority = rawPriority == null ? undefined : parsePriority(rawPriority);
  const notes = rawNotes == null ? undefined : parseNotes(rawNotes);

  let changed = false;
  if (status) {
    const moved = await transitionOrder(orderId, status, await systemActor(), {
      note: 'Status set by workflow',
      workflowDepth: depth + 1,
    });
    changed = moved.changed;
  }

  if (priority !== undefined || notes !== undefined) {
    await setOrderPriorityAndNotes(orderId, { priority, notes });
    changed = true;
  }

  return { changed, updates: { status, priority, notes } };
}

/** Add a tag to an order once, in one write. */
export async function addOrderTag(orderId: number, tag: string): Promise<void> {
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, NOT: { tags: { has: tag } } },
    data: { tags: { push: tag } },
  });
  if (count === 0 && !(await prisma.order.findFirst({ where: { id: orderId }, select: { id: true } }))) {
    throw new AppError('Order not found', 404);
  }
}
