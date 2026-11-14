import { Prisma, Reminder, ReminderStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { resolveTenantId, runInTenant, withoutTenant } from '../utils/tenantContext';
import { HUMAN_USERS_WHERE } from './systemUserService';
import { isOwnerRole } from './inbox/inboxEvents';
import { notify } from './inbox/inboxService';
import { assertSubjectVisible, NoteSubjectType } from './inbox/subjectAccess';

/** Reminders (M9-T18): a note with a due time for one person, sent through the inbox when it falls due. */

const YEAR_MS = 366 * 24 * 3600 * 1000;
const MAX_DUE_PER_TICK = 500;

export interface ReminderUser { id: number; role: string }

export interface CreateReminderInput {
  subjectType?: NoteSubjectType;
  subjectId?: number;
  note: string;
  dueAt: Date;
  assignedToId?: number;
}

/** A due time must be in the future and at most one year ahead. */
export function assertDueAtValid(dueAt: Date, now = new Date()): void {
  if (Number.isNaN(dueAt.getTime())) throw new AppError('Due date is not a valid date', 400);
  if (dueAt.getTime() <= now.getTime()) throw new AppError('The due time must be in the future', 400);
  if (dueAt.getTime() > now.getTime() + YEAR_MS) throw new AppError('The due time can be one year ahead at most', 400);
}

const canChange = (r: Pick<Reminder, 'createdById' | 'assignedToId'>, user: ReminderUser) =>
  isOwnerRole(user.role as never) || r.createdById === user.id || r.assignedToId === user.id;

async function loadOr404(id: number): Promise<Reminder> {
  const r = await prisma.reminder.findFirst({ where: { id } });
  if (!r) throw new AppError('Reminder not found', 404);
  return r;
}

export async function createReminder(input: CreateReminderInput, user: ReminderUser, now = new Date()): Promise<Reminder> {
  assertDueAtValid(input.dueAt, now);
  if (input.subjectType && input.subjectId) await assertSubjectVisible(input.subjectType, input.subjectId, user as never);

  const assignedToId = input.assignedToId ?? user.id;
  const assignee = await prisma.user.findFirst({ where: { id: assignedToId, isActive: true, ...HUMAN_USERS_WHERE }, select: { id: true } });
  if (!assignee) throw new AppError('The person for this reminder was not found or is not active', 400);

  return prisma.reminder.create({
    data: {
      tenantId: resolveTenantId(),
      createdById: user.id,
      assignedToId,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      note: input.note,
      dueAt: input.dueAt,
    },
  });
}

export async function listReminders(user: ReminderUser, q: { status?: ReminderStatus; mine?: boolean }): Promise<Reminder[]> {
  const mineWhere: Prisma.ReminderWhereInput = { OR: [{ createdById: user.id }, { assignedToId: user.id }] };
  const where: Prisma.ReminderWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.mine || !isOwnerRole(user.role as never) ? mineWhere : {}),
  };
  return prisma.reminder.findMany({ where, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 200 });
}

export async function updateReminder(id: number, patch: { note?: string; dueAt?: Date; cancel?: boolean }, user: ReminderUser, now = new Date()): Promise<Reminder> {
  const current = await loadOr404(id);
  if (!canChange(current, user)) throw new AppError('You cannot change this reminder', 403);
  if (current.status !== 'pending') throw new AppError(`This reminder is already ${current.status}`, 409);
  if (patch.dueAt) assertDueAtValid(patch.dueAt, now);

  const data: Prisma.ReminderUpdateManyMutationInput = patch.cancel
    ? { status: 'cancelled' }
    : { ...(patch.note !== undefined ? { note: patch.note } : {}), ...(patch.dueAt ? { dueAt: patch.dueAt } : {}) };
  // The status in the filter: a reminder the job claimed a moment ago is not changed
  const { count } = await prisma.reminder.updateMany({ where: { id, status: 'pending' }, data });
  if (count === 0) throw new AppError('This reminder is no longer pending', 409);
  return loadOr404(id);
}

/** DELETE is cancel: the row stays as history. */
export const cancelReminder = (id: number, user: ReminderUser): Promise<Reminder> => updateReminder(id, { cancel: true }, user);

interface PersonState { id: number; firstName: string; lastName: string; isActive: boolean }

/** Who gets it: the assignee; if deactivated the creator; if the creator is deactivated too, the owner. */
async function pickRecipient(r: Reminder): Promise<{ recipients: number[] | 'owner'; message: string }> {
  const people = await withSoftDeleted(() => prisma.user.findMany({
    where: { id: { in: [r.assignedToId, r.createdById] } },
    select: { id: true, firstName: true, lastName: true, isActive: true },
  })) as PersonState[];
  const assignee = people.find((p) => p.id === r.assignedToId);
  const creator = people.find((p) => p.id === r.createdById);
  if (assignee?.isActive) return { recipients: [assignee.id], message: r.note };
  const name = assignee ? `${assignee.firstName} ${assignee.lastName}`.trim() : 'The person';
  const message = `${name} is deactivated; this reminder came to you. ${r.note}`;
  return { recipients: creator?.isActive ? [creator.id] : 'owner', message };
}

/**
 * Send one reminder if this worker wins the claim: one `updateMany` moves pending to sent, so two workers
 * (or two ticks) never send twice. If the notification cannot be written the claim is given back, and the
 * next tick tries again. Runs inside the reminder's tenant.
 */
async function fireOne(id: number, now: Date): Promise<boolean> {
  const { count } = await prisma.reminder.updateMany({ where: { id, status: 'pending', dueAt: { lte: now } }, data: { status: 'sent', sentAt: now } });
  if (count === 0) return false;
  const reminder = await loadOr404(id);
  try {
    const { recipients, message } = await pickRecipient(reminder);
    await notify({
      tenantId: reminder.tenantId,
      event: 'reminder_due',
      kind: 'reminder',
      subject: reminder.subjectType && reminder.subjectId ? { type: reminder.subjectType, id: reminder.subjectId } : undefined,
      recipients,
      title: 'Reminder',
      message,
      data: { reminderId: reminder.id, createdById: reminder.createdById },
    });
    return true;
  } catch (error) {
    await prisma.reminder.updateMany({ where: { id, status: 'sent' }, data: { status: 'pending', sentAt: null } });
    throw error;
  }
}

/**
 * The due job body (every minute): reads the database, so a reminder that fell due while the server was down
 * goes out on the next tick. Returns how many were sent.
 */
export async function processDueReminders(now = new Date()): Promise<number> {
  const due = await withoutTenant('reminder-due-job', () => prisma.reminder.findMany({
    where: { status: 'pending', dueAt: { lte: now } },
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    take: MAX_DUE_PER_TICK,
    select: { id: true, tenantId: true },
  }));
  let sent = 0;
  for (const { id, tenantId } of due) {
    try {
      if (await runInTenant(tenantId, () => fireOne(id, now))) sent++;
    } catch (error) {
      logger.error('Reminder could not be sent; it will be tried again', { reminderId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}
