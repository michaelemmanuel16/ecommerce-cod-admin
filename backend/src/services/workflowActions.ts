import { OrderStatus } from '@prisma/client';
import { transitionOrder } from './orderStateMachine';
import { systemActor } from './systemUserService';
import { setOrderPriorityAndNotes } from './orderService';
import { safeHttpRequest } from '../utils/safeHttp';

/**
 * Order writes shared by the two workflow executors (the Bull job in queues/workflowQueue.ts and
 * WorkflowService's synchronous one). Neither file writes the order itself (M2-T16).
 */

/**
 * The status an `update_order` action sets: the editor writes `config.status`. `action.status` and
 * `config.updates.status` are older saved shapes; keep reading them or old workflows stop moving orders.
 * (Priority and notes never read `config.updates`.)
 */
export function workflowStatus(action: any): OrderStatus | undefined {
  return action.config?.status ?? action.status ?? action.config?.updates?.status;
}

/** Words an `update_order` priority may use. Order.priority is an Int; the editor's own words are 'medium' and 'normal'. */
const PRIORITY_WORDS: Record<string, number> = { low: 1, normal: 5, medium: 5, high: 10, urgent: 15 };
const MAX_NOTE_LENGTH = 1000;

function parsePriority(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (text in PRIORITY_WORDS) return PRIORITY_WORDS[text];
    if (/^\d+$/.test(text)) return Number(text);
  }
  throw new Error(`update_order priority must be a whole number 0 or more, or one of ${Object.keys(PRIORITY_WORDS).join(', ')}`);
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

/**
 * The `http_request` action, shared by both executors (M9-T21). The editor writes `config.url/method/headers/body`;
 * a flat `action.url` is an older saved shape. A refused or failed call, or a 4xx/5xx answer, throws: the step fails
 * with a clear message. Nothing about the headers is logged or returned (they may hold a token).
 */
export async function runHttpRequestAction(action: any): Promise<{ success: true; status: number; url: string; body: string; truncated: boolean }> {
  const source = action.config?.url ? action.config : action;
  const res = await safeHttpRequest({ url: source.url, method: source.method, headers: source.headers, body: source.body });
  if (!res.ok) throw new Error(`http_request failed: the server answered HTTP ${res.status}`);
  return { success: true, status: res.status, url: res.url, body: res.body, truncated: res.truncated };
}
