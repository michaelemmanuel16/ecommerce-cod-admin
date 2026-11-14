import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';

const mockNotify = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../../services/inbox/inboxService', () => ({ notify: (...a: any[]) => mockNotify(...a) }));
const mockVisible = jest.fn<(...a: any[]) => Promise<void>>();
jest.mock('../../services/inbox/subjectAccess', () => ({
  NOTE_SUBJECT_TYPES: ['order', 'customer', 'payout', 'product'],
  assertSubjectVisible: (...a: any[]) => mockVisible(...a),
}));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { addComment, archiveThreadsFor, deleteComment, editComment, DELETED_COMMENT_TEXT } from '../../services/threadService';
import { commentCreateSchema } from '../../validators/threadSchema';
import { runInTenant } from '../../utils/tenantContext';
import { AppError } from '../../middleware/errorHandler';

const ME = { id: 1, role: 'sales_rep' };
const thread = { id: 7, tenantId: 't1', subjectType: 'order', subjectId: 5, archivedAt: null };
const created = (data: any) => ({ id: 100, createdAt: new Date(), editedAt: null, deletedAt: null, tenantId: 't1', ...data, author: { firstName: 'Ama', lastName: 'Mensah' } });
const run = <T>(fn: () => Promise<T>) => runInTenant('t1', fn);

beforeEach(() => {
  mockNotify.mockResolvedValue([]);
  mockVisible.mockResolvedValue(undefined);
  (prismaMock.thread.findFirst as any).mockResolvedValue(thread);
  (prismaMock.comment.findMany as any).mockResolvedValue([]);
  (prismaMock.user.findMany as any).mockImplementation(async ({ where }: any) => where.id.in.map((id: number) => ({ id })));
  (prismaMock.comment.create as any).mockImplementation(async ({ data }: any) => created(data));
});

const add = (input: any, user = ME) => run(() => addComment('order', 5, input, user));
const notifiedEvents = () => mockNotify.mock.calls.map((c) => c[0].event);

describe('comment length', () => {
  it('4000 characters is fine, 4001 is refused (schema and service)', async () => {
    expect(commentCreateSchema.safeParse({ body: 'a'.repeat(4000) }).success).toBe(true);
    expect(commentCreateSchema.safeParse({ body: 'a'.repeat(4001) }).success).toBe(false);
    expect(commentCreateSchema.safeParse({ body: '   ' }).success).toBe(false);
    await expect(add({ body: 'a'.repeat(4001) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(add({ body: 'a'.repeat(4000) })).resolves.toBeTruthy();
  });
  it('text with HTML is kept as it is', async () => {
    const out = await add({ body: '<script>alert(1)</script>' });
    expect(out.comment.body).toBe('<script>alert(1)</script>');
    expect((prismaMock.comment.create as any).mock.calls[0][0].data.body).toBe('<script>alert(1)</script>');
  });
});

describe('mentions', () => {
  it('an inactive or other-tenant id is a 400 and nothing is written', async () => {
    (prismaMock.user.findMany as any).mockResolvedValue([{ id: 2 }]); // 3 is not found among active people of this tenant
    await expect(add({ body: 'hi', mentionIds: [2, 3] })).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect((prismaMock.user.findMany as any).mock.calls[0][0].where).toMatchObject({ isActive: true });
  });

  it('a mentioned person gets ONE mention, even when listed twice; the author is never notified', async () => {
    await add({ body: 'look @Kofi', mentionIds: [2, 2, 1, 2] });
    const mention = mockNotify.mock.calls.filter((c) => c[0].event === 'mention');
    expect(mention).toHaveLength(1);
    expect(mention[0][0].recipients).toEqual([2]);
    expect(mention[0][0].actorId).toBe(1);
    expect((prismaMock.comment.create as any).mock.calls[0][0].data.mentionIds).toEqual([2, 1]);
  });

  it('only the author mentioned: nobody is notified and nothing falls to the owner', async () => {
    await add({ body: 'note to self', mentionIds: [1] });
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('people who cannot see the subject', () => {
  const noAccess = (blocked: number[]) => mockVisible.mockImplementation(async (_t: any, _i: any, who: any) => {
    if (blocked.includes(who.id)) throw new AppError('no', 403);
  });
  it('mentioning someone who cannot see the subject is a 400 that names them; nothing is saved or sent', async () => {
    (prismaMock.user.findMany as any).mockResolvedValue([{ id: 2, role: 'sales_rep', firstName: 'Kofi', lastName: 'Asare' }]);
    noAccess([2]);
    await expect(add({ body: 'hi', mentionIds: [2] })).rejects.toMatchObject({ statusCode: 400, message: 'Kofi Asare cannot see this order' });
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });
  it('an earlier commenter who lost access gets no team_note, silently', async () => {
    (prismaMock.comment.findMany as any).mockResolvedValue([{ authorId: 2 }, { authorId: 3 }]);
    (prismaMock.user.findMany as any).mockImplementation(async ({ where }: any) => where.id.in.map((id: number) => ({ id, role: 'sales_rep' })));
    noAccess([2]);
    await add({ body: 'update' });
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ event: 'team_note', recipients: [3] });
  });
  it('editing or deleting after losing access is a 404 (an owner may still delete)', async () => {
    (prismaMock.comment.findFirst as any).mockResolvedValue(created({ id: 9, threadId: 7, authorId: 1, parentId: null, body: 'old', mentionIds: [] }));
    (prismaMock.comment.update as any).mockImplementation(async ({ data }: any) => created({ id: 9, threadId: 7, authorId: 1, parentId: null, mentionIds: [], ...data }));
    noAccess([1]);
    await expect(run(() => editComment(9, 'new', ME))).rejects.toMatchObject({ statusCode: 404 });
    await expect(run(() => deleteComment(9, ME))).rejects.toMatchObject({ statusCode: 404 });
    await expect(run(() => deleteComment(9, { id: 1, role: 'admin' }))).resolves.toBeTruthy();
  });
});

describe('team_note recipients', () => {
  it('earlier commenters get one team_note; not the author, not people already mentioned, not deactivated people', async () => {
    (prismaMock.comment.findMany as any).mockResolvedValue([{ authorId: 1 }, { authorId: 2 }, { authorId: 3 }, { authorId: 4 }]);
    (prismaMock.user.findMany as any).mockImplementation(async ({ where }: any) => where.id.in.filter((id: number) => id !== 4).map((id: number) => ({ id })));
    await add({ body: 'update', mentionIds: [2] });
    const note = mockNotify.mock.calls.find((c) => c[0].event === 'team_note')![0];
    expect(note.recipients).toEqual([3]); // 1 is the author, 2 is mentioned, 4 is deactivated
    expect(notifiedEvents().sort()).toEqual(['mention', 'team_note']);
  });

  it('the first comment on a subject notifies nobody; an empty list is never sent (it would go to the owner)', async () => {
    (prismaMock.thread.findFirst as any).mockResolvedValue(null);
    (prismaMock.thread.create as any).mockResolvedValue(thread);
    await add({ body: 'first' });
    expect(prismaMock.thread.create).toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('only deactivated earlier commenters: no team_note at all', async () => {
    (prismaMock.comment.findMany as any).mockResolvedValue([{ authorId: 4 }]);
    (prismaMock.user.findMany as any).mockResolvedValue([]);
    await add({ body: 'update' });
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('replies, archive, subject', () => {
  it('an archived thread refuses a comment with 409', async () => {
    (prismaMock.thread.findFirst as any).mockResolvedValue({ ...thread, archivedAt: new Date() });
    await expect(add({ body: 'hi' })).rejects.toMatchObject({ statusCode: 409 });
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });
  it('a subject the person cannot see stops the comment', async () => {
    mockVisible.mockRejectedValue(Object.assign(new Error('no'), { statusCode: 403 }));
    await expect(add({ body: 'hi' })).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });
  it('a reply goes under a top-level comment of the same thread only', async () => {
    (prismaMock.comment.findFirst as any).mockResolvedValueOnce(null);
    await expect(add({ body: 'r', parentId: 50 })).rejects.toMatchObject({ statusCode: 400 });
    (prismaMock.comment.findFirst as any).mockResolvedValueOnce({ id: 50, parentId: 49, deletedAt: null });
    await expect(add({ body: 'r', parentId: 50 })).rejects.toMatchObject({ statusCode: 400 });
    (prismaMock.comment.findFirst as any).mockResolvedValueOnce({ id: 50, parentId: null, deletedAt: null });
    await expect(add({ body: 'r', parentId: 50 })).resolves.toBeTruthy();
    expect((prismaMock.comment.create as any).mock.calls[0][0].data.parentId).toBe(50);
  });
});

describe('edit and delete', () => {
  const row = (over: any = {}) => created({ id: 9, threadId: 7, authorId: 1, parentId: null, body: 'old', mentionIds: [2], ...over });
  beforeEach(() => {
    (prismaMock.comment.findFirst as any).mockResolvedValue(row());
    (prismaMock.comment.update as any).mockImplementation(async ({ data }: any) => row(data));
  });

  it('only the author edits; the edit sets editedAt and notifies nobody', async () => {
    const out = await run(() => editComment(9, 'new', ME));
    expect(out.comment).toMatchObject({ body: 'new', edited: true });
    expect((prismaMock.comment.update as any).mock.calls[0][0].data.editedAt).toBeInstanceOf(Date);
    expect(mockNotify).not.toHaveBeenCalled();
    await expect(run(() => editComment(9, 'new', { id: 2, role: 'admin' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(() => editComment(9, 'a'.repeat(4001), ME))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('the author, an admin and the owner may delete; another rep may not; the text is hidden', async () => {
    for (const u of [ME, { id: 8, role: 'admin' }, { id: 9, role: 'super_admin' }]) {
      const out = await run(() => deleteComment(9, u));
      expect(out.comment).toMatchObject({ body: DELETED_COMMENT_TEXT, deleted: true, mentionIds: [] });
    }
    await expect(run(() => deleteComment(9, { id: 3, role: 'sales_rep' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(() => deleteComment(9, { id: 3, role: 'manager' }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a missing comment is 404', async () => {
    (prismaMock.comment.findFirst as any).mockResolvedValue(null);
    await expect(run(() => deleteComment(9, ME))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('archiveThreadsFor', () => {
  it('archives the open threads of the subjects, and does nothing for an empty list', async () => {
    (prismaMock.thread.updateMany as any).mockResolvedValue({ count: 1 });
    await archiveThreadsFor('order', []);
    expect(prismaMock.thread.updateMany).not.toHaveBeenCalled();
    await archiveThreadsFor('order', [5, 6]);
    expect((prismaMock.thread.updateMany as any).mock.calls[0][0]).toMatchObject({
      where: { subjectType: 'order', subjectId: { in: [5, 6] }, archivedAt: null },
    });
  });
});
