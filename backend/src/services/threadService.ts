import { Comment, Prisma, Thread } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { HUMAN_USERS_WHERE } from './systemUserService';
import { isOwnerRole } from './inbox/inboxEvents';
import { notify } from './inbox/inboxService';
import { assertSubjectVisible, NoteSubjectType } from './inbox/subjectAccess';

/**
 * Threads, comments and mentions (M9-T19). One thread per subject, made on the first comment.
 * Comment text is plain text: stored and returned as given, never turned into HTML here. The frontend renders it as text.
 */

export const COMMENT_MAX_LENGTH = 4000;
export const DELETED_COMMENT_TEXT = 'Comment deleted';
const EXCERPT_LENGTH = 140;

export interface ThreadUser { id: number; role: string }

type CommentWithAuthor = Comment & { author: { firstName: string; lastName: string } };

const authorName = (c: CommentWithAuthor) => `${c.author.firstName} ${c.author.lastName}`.trim();

export function presentComment(c: CommentWithAuthor) {
  const deleted = c.deletedAt !== null;
  return {
    id: c.id,
    parentId: c.parentId,
    authorId: c.authorId,
    authorName: authorName(c),
    body: deleted ? DELETED_COMMENT_TEXT : c.body,
    mentionIds: deleted ? [] : c.mentionIds,
    edited: c.editedAt !== null && !deleted,
    deleted,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
  };
}

const AUTHOR = { select: { firstName: true, lastName: true } } as const;

const findThread = (type: NoteSubjectType, id: number) =>
  prisma.thread.findFirst({ where: { subjectType: type, subjectId: id } });

/** GET: the thread (or an empty one) with comments oldest first, replies under their parent, and my unread count. Opening marks it read. */
export async function getThreadBySubject(type: NoteSubjectType, id: number, user: ThreadUser) {
  const thread = await findThread(type, id);
  await assertSubjectVisible(type, id, user as never, { includeDeleted: thread?.archivedAt != null });
  if (!thread) {
    return { thread: { id: null, subjectType: type, subjectId: id, archived: false, unreadCount: 0, comments: [] } };
  }

  const [rows, read] = await Promise.all([
    prisma.comment.findMany({
      where: { threadId: thread.id },
      include: { author: AUTHOR },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.threadRead.findFirst({ where: { threadId: thread.id, userId: user.id } }),
  ]);
  const unreadCount = rows.filter((c) => c.authorId !== user.id && c.deletedAt === null && (!read || c.createdAt > read.lastReadAt)).length;

  const top = rows.filter((c) => c.parentId === null);
  const comments = top.map((c) => ({
    ...presentComment(c),
    replies: rows.filter((r) => r.parentId === c.id).map(presentComment),
  }));

  const now = new Date();
  await prisma.threadRead.upsert({
    where: { threadId_userId: { threadId: thread.id, userId: user.id } },
    create: { tenantId: resolveTenantId(), threadId: thread.id, userId: user.id, lastReadAt: now },
    update: { lastReadAt: now },
  });

  return { thread: { id: thread.id, subjectType: type, subjectId: id, archived: thread.archivedAt !== null, unreadCount, comments } };
}

/** True when this person may open the subject (same rule as the thread itself). */
async function canSee(type: NoteSubjectType, id: number, person: { id: number; role: string }, includeDeleted = false): Promise<boolean> {
  try {
    await assertSubjectVisible(type, id, person as never, { includeDeleted });
    return true;
  } catch (error) {
    if (error instanceof AppError && (error.statusCode === 403 || error.statusCode === 404)) return false;
    throw error;
  }
}

/** Mentioned people must be active people of this business who can see the subject: the notification carries the comment text. */
async function activeMentionIds(type: NoteSubjectType, subjectId: number, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const found = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true, ...HUMAN_USERS_WHERE }, select: { id: true, role: true, firstName: true, lastName: true } });
  if (found.length !== ids.length) throw new AppError('You can mention only active people of this business', 400);
  for (const person of found) {
    if (!(await canSee(type, subjectId, person))) {
      throw new AppError(`${`${person.firstName} ${person.lastName}`.trim()} cannot see this ${type}`, 400);
    }
  }
  return ids;
}

/** GET mentionable: the active people of this business who can open the subject, so the mention picker never lists someone the API would refuse. Never the caller. */
export async function listMentionable(type: NoteSubjectType, id: number, user: ThreadUser) {
  await assertSubjectVisible(type, id, user as never);
  const people = await prisma.user.findMany({
    where: { isActive: true, id: { not: user.id }, ...HUMAN_USERS_WHERE },
    select: { id: true, role: true, firstName: true, lastName: true },
    orderBy: [{ firstName: 'asc' }, { id: 'asc' }],
    take: 200,
  });
  const visible = await Promise.all(people.map(async (p) => ((await canSee(type, id, p)) ? p : null)));
  return {
    people: visible.filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), role: p.role })),
  };
}

async function getOrCreateThread(type: NoteSubjectType, id: number): Promise<Thread> {
  const existing = await findThread(type, id);
  if (existing) return existing;
  try {
    return await prisma.thread.create({ data: { tenantId: resolveTenantId(), subjectType: type, subjectId: id } });
  } catch (error) {
    // Two first comments at the same moment: the unique key lets one win
    if ((error as { code?: string })?.code === 'P2002') return (await findThread(type, id))!;
    throw error;
  }
}

const excerpt = (body: string) => (body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH)}...` : body);

/** POST: add a comment (or a reply, one level) and tell the people who need to know, once each. */
export async function addComment(
  type: NoteSubjectType, id: number,
  input: { body: string; parentId?: number; mentionIds?: number[] },
  user: ThreadUser,
) {
  if (input.body.trim().length === 0) throw new AppError('Write a comment', 400);
  if (input.body.length > COMMENT_MAX_LENGTH) throw new AppError(`A comment can be ${COMMENT_MAX_LENGTH} characters at most`, 400);

  const existing = await findThread(type, id);
  if (existing?.archivedAt) throw new AppError('This thread is archived because the item was deleted', 409);
  await assertSubjectVisible(type, id, user as never);

  const mentionIds = await activeMentionIds(type, id, [...new Set(input.mentionIds ?? [])]);

  const thread = existing ?? await getOrCreateThread(type, id);
  if (thread.archivedAt) throw new AppError('This thread is archived because the item was deleted', 409);

  if (input.parentId !== undefined) {
    const parent = await prisma.comment.findFirst({ where: { id: input.parentId, threadId: thread.id } });
    if (!parent) throw new AppError('The comment you reply to was not found in this thread', 400);
    if (parent.parentId !== null) throw new AppError('You can reply to a comment, not to a reply', 400);
    if (parent.deletedAt) throw new AppError('The comment you reply to was deleted', 400);
  }

  // People who spoke before this comment, read before it is written
  const earlier = await prisma.comment.findMany({
    where: { threadId: thread.id, deletedAt: null }, select: { authorId: true }, distinct: ['authorId'],
  });

  const comment = await prisma.comment.create({
    data: {
      tenantId: resolveTenantId(), threadId: thread.id, authorId: user.id, parentId: input.parentId ?? null,
      body: input.body, mentionIds,
    },
    include: { author: AUTHOR },
  });

  await notifyComment(type, id, comment, earlier.map((e) => e.authorId), mentionIds);
  return { comment: presentComment(comment) };
}

/** One `mention` for each person mentioned; one `team_note` for the other people who commented here. Never the author. */
async function notifyComment(type: NoteSubjectType, id: number, comment: CommentWithAuthor, earlierAuthors: number[], mentionIds: number[]): Promise<void> {
  const tenantId = comment.tenantId;
  const who = authorName(comment);
  const base = { tenantId, subject: { type, id }, actorId: comment.authorId, data: { commentId: comment.id, threadId: comment.threadId } };

  const mentioned = mentionIds.filter((m) => m !== comment.authorId);
  if (mentioned.length > 0) {
    await notify({ ...base, event: 'mention', recipients: mentioned, title: `${who} mentioned you on ${type} #${id}`, message: excerpt(comment.body) });
  }

  // `notify` sends an empty list to the owner, so an empty list must not be passed
  const others = [...new Set(earlierAuthors)].filter((a) => a !== comment.authorId && !mentioned.includes(a));
  const people = others.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: others }, isActive: true, ...HUMAN_USERS_WHERE }, select: { id: true, role: true } });
  // Someone who lost access since they commented is skipped: the note carries the comment text
  const active: number[] = [];
  for (const person of people) if (await canSee(type, id, person)) active.push(person.id);
  if (active.length > 0) {
    await notify({ ...base, event: 'team_note', recipients: active, title: `${who} added a note on ${type} #${id}`, message: excerpt(comment.body) });
  }
}

async function loadCommentOr404(id: number): Promise<CommentWithAuthor> {
  const c = await prisma.comment.findFirst({ where: { id }, include: { author: AUTHOR } });
  if (!c) throw new AppError('Comment not found', 404);
  return c;
}

/** An author who lost access to the subject (the order moved to another rep) can no longer change the comment: 404. */
async function assertStillSees(thread: Thread | null, user: ThreadUser): Promise<void> {
  if (!thread) return;
  if (!(await canSee(thread.subjectType as NoteSubjectType, thread.subjectId, user, thread.archivedAt != null))) {
    throw new AppError('Comment not found', 404);
  }
}

/** PATCH: the author only. Sets `editedAt`; nobody is notified again. */
export async function editComment(id: number, body: string, user: ThreadUser) {
  if (body.trim().length === 0) throw new AppError('Write a comment', 400);
  if (body.length > COMMENT_MAX_LENGTH) throw new AppError(`A comment can be ${COMMENT_MAX_LENGTH} characters at most`, 400);
  const current = await loadCommentOr404(id);
  if (current.authorId !== user.id) throw new AppError('Only the author can edit a comment', 403);
  if (current.deletedAt) throw new AppError('This comment was deleted', 409);
  const thread = await prisma.thread.findFirst({ where: { id: current.threadId } });
  await assertStillSees(thread, user);
  if (thread?.archivedAt) throw new AppError('This thread is archived because the item was deleted', 409);
  const updated = await prisma.comment.update({ where: { id }, data: { body, editedAt: new Date() }, include: { author: AUTHOR } });
  return { comment: presentComment(updated) };
}

/** DELETE: the author, the owner or an admin. A soft delete: the thread shows "Comment deleted". */
export async function deleteComment(id: number, user: ThreadUser) {
  const current = await loadCommentOr404(id);
  if (current.authorId !== user.id && !isOwnerRole(user.role as never)) throw new AppError('Only the author, the owner or an admin can delete a comment', 403);
  if (!isOwnerRole(user.role as never)) {
    await assertStillSees(await prisma.thread.findFirst({ where: { id: current.threadId } }), user);
  }
  if (current.deletedAt) return { comment: presentComment(current) };
  const updated = await prisma.comment.update({ where: { id }, data: { deletedAt: new Date() }, include: { author: AUTHOR } });
  return { comment: presentComment(updated) };
}

/** The extended client and its transaction client both fit. */
type ThreadClient = { thread: { updateMany(args: Prisma.ThreadUpdateManyArgs): PromiseLike<unknown> } };

/**
 * The subject was deleted: its thread is archived (kept to read, closed to comments). Call from the delete path of
 * the order, customer or product. Pass the transaction client when the delete runs in one.
 */
export async function archiveThreadsFor(type: NoteSubjectType, ids: number[], client: ThreadClient = prisma): Promise<void> {
  if (ids.length === 0) return;
  await client.thread.updateMany({ where: { subjectType: type, subjectId: { in: ids }, archivedAt: null }, data: { archivedAt: new Date() } });
}
