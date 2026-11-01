/**
 * M6-T10 (COD-58): month close. Preview writes nothing; the run creates and posts the reward entries and locks the month;
 * a second run changes nothing; part-month holders, AI agents, a role with no target; a failed read stops and opens a Finding.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import * as ratesModule from '../../services/kpi/rates';
import * as targets from '../../services/targetService';
import * as commissionService from '../../services/commissionService';
import { runPeriodClose, runPeriodCloseJob } from '../../services/periodCloseService';
import { getSystemUserId } from '../../services/systemUserService';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
let callRepRole: { id: number };
let deliveryRole: { id: number };
let customerId: number;
let seq = 0;

const api = {
  get: (token: string, url: string) => request(app).get(url).set(bearer(token)),
  post: (token: string, url: string, body: object = {}) => request(app).post(url).set(bearer(token)).send(body),
  put: (token: string, url: string, body: object = {}) => request(app).put(url).set(bearer(token)).send(body),
};
const SEP = { start: new Date('2026-09-01'), end: new Date('2026-09-30') };
const AUG = { start: new Date('2026-08-01'), end: new Date('2026-08-31') };
const MAY = { start: new Date('2026-05-01'), end: new Date('2026-05-31') };
const JUN = { start: new Date('2026-06-01'), end: new Date('2026-06-30') };

async function mkUser(label: string, role: 'sales_rep' | 'delivery_agent', extra: Record<string, unknown> = {}) {
  const name = `${label}${SUFFIX}x${seq++}`;
  const u = await prismaBase.user.create({
    data: { email: `${name}@codadmin.test`, password: await bcrypt.hash('Passw0rd!pc', 4), firstName: name, lastName: 'Pc', role, tenantId: pair.a.id, ...extra },
  });
  return u;
}
const hold = (userId: number, roleId: number, toDate: Date | null = null) =>
  prismaBase.roleAssignment.create({ data: { tenantId: pair.a.id, roleId, holderId: userId, fromDate: new Date('2026-01-01'), toDate } });
const personTarget = (userId: number, roleId: number, month: { start: Date; end: Date }, value: number, periodEnd?: Date) =>
  prismaBase.target.create({
    data: { tenantId: pair.a.id, scope: 'person', metric: 'confirmed_delivered', unit: 'count', periodStart: month.start, periodEnd: periodEnd ?? month.end, value, roleId, userId },
  });
const monthTarget = (month: { start: Date; end: Date }) =>
  prismaBase.target.create({ data: { tenantId: pair.a.id, scope: 'month', metric: 'confirmed_delivered', unit: 'count', periodStart: month.start, periodEnd: month.end, value: 1000 } });
const delivered = (repId: number, n: number, deliveredOn: string) =>
  prismaBase.order.createMany({
    data: Array.from({ length: n }, () => ({
      tenantId: pair.a.id, customerId, status: 'delivered' as const, subtotal: '10', totalAmount: '10', codAmount: '10',
      deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
      confirmedById: repId, customerRepId: repId, confirmedAt: new Date('2026-08-25T10:00:00Z'), deliveryDate: new Date(deliveredOn),
    })),
  });
const counts = async () => ({
  entries: await prismaBase.commissionEntry.count({ where: { tenantId: pair.a.id, kind: 'reward' } }),
  journals: await prismaBase.journalEntry.count({ where: { tenantId: pair.a.id, sourceType: 'commission_accrual' } }),
  closed: await prismaBase.target.count({ where: { tenantId: pair.a.id, closedAt: { not: null } } }),
});

let r1: Awaited<ReturnType<typeof mkUser>>; // exactly 100 percent
let r2: Awaited<ReturnType<typeof mkUser>>; // 130 percent
let r3: Awaited<ReturnType<typeof mkUser>>; // 90 percent
let leaver: Awaited<ReturnType<typeof mkUser>>; // unassigned on the 20th, target 100, 110 delivered
let ai: Awaited<ReturnType<typeof mkUser>>;
let partner: Awaited<ReturnType<typeof mkUser>>; // Delivery, no target

beforeAll(async () => {
  pair = await createTwoTenants('m6close');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'pc-owner');
  ownerB = await superAdminToken(pair.b.id, pair.b.slug, 'pc-owner');
  callRepRole = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Call rep' } });
  deliveryRole = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Delivery' } });
  customerId = (await prismaBase.order.findFirstOrThrow({ where: { tenantId: pair.a.id } })).customerId;

  await api.put(ownerA, '/api/rewards/settings', {
    tiers: [
      { roleId: callRepRole.id, tier100: { amount: 300 }, tier120: { amount: 500, dayOff: true } },
      { roleId: deliveryRole.id, tier100: { amount: 250 }, tier120: { amount: 400, dayOff: true } },
    ],
  });
  const month = await monthTarget(SEP);
  await prismaBase.target.create({
    data: { tenantId: pair.a.id, scope: 'role', metric: 'confirmed_delivered', unit: 'count', periodStart: SEP.start, periodEnd: SEP.end, value: 500, roleId: callRepRole.id, parentId: month.id },
  });
  [r1, r2, r3, leaver] = [await mkUser('one', 'sales_rep'), await mkUser('two', 'sales_rep'), await mkUser('three', 'sales_rep'), await mkUser('left', 'sales_rep')];
  for (const u of [r1, r2, r3]) await hold(u.id, callRepRole.id);
  await hold(leaver.id, callRepRole.id, new Date('2026-09-20'));
  await personTarget(r1.id, callRepRole.id, SEP, 10);
  await personTarget(r2.id, callRepRole.id, SEP, 10);
  await personTarget(r3.id, callRepRole.id, SEP, 10);
  // Unassigned on the 20th: the target was cut short at the 19th (T07 release).
  await personTarget(leaver.id, callRepRole.id, SEP, 100, new Date('2026-09-19'));
  await delivered(r1.id, 10, '2026-09-10T10:00:00Z');
  await delivered(r2.id, 13, '2026-09-11T10:00:00Z');
  await delivered(r3.id, 9, '2026-09-12T10:00:00Z');
  await delivered(leaver.id, 110, '2026-09-15T10:00:00Z');

  ai = await mkUser('robo', 'sales_rep', { kind: 'ai_agent', password: '!' });
  await hold(ai.id, callRepRole.id);
  await personTarget(ai.id, callRepRole.id, SEP, 10);
  await delivered(ai.id, 13, '2026-09-13T10:00:00Z');

  partner = await mkUser('part', 'delivery_agent');
  await hold(partner.id, deliveryRole.id); // a Delivery holder with no target for September
}, 180_000);

afterAll(async () => {
  jest.restoreAllMocks();
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('who may close', () => {
  it('needs a login; only the Owner (not an admin or a rep) previews or runs', async () => {
    expect((await request(app).post('/api/period-close/2026-09/preview')).status).toBe(401);
    for (const token of [pair.a.users.admin.token, pair.a.users.salesRep.token]) {
      expect((await api.post(token, '/api/period-close/2026-09/preview')).status).toBe(403);
      expect((await api.post(token, '/api/period-close/2026-09')).status).toBe(403);
    }
  });

  it('only a month that has ended: the current and a future month are 400 MONTH_NOT_ENDED; a bad month is 400', async () => {
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    for (const period of [current, '2099-01']) {
      for (const url of [`/api/period-close/${period}/preview`, `/api/period-close/${period}`]) {
        const res = await api.post(ownerA, url);
        expect([url, res.status, res.body.code]).toEqual([url, 400, 'MONTH_NOT_ENDED']);
      }
    }
    expect((await api.post(ownerA, '/api/period-close/2026-13')).status).toBe(400);
    expect((await api.post(ownerA, '/api/period-close/September')).status).toBe(400);
  });
});

describe('preview and run (September)', () => {
  let before: Awaited<ReturnType<typeof counts>>;

  it('preview lists the rewards and writes nothing at all', async () => {
    before = await counts();
    const res = await api.post(ownerA, '/api/period-close/2026-09/preview');
    expect(res.status).toBe(200);
    const byUser = new Map<number, any>(res.body.entries.map((e: { userId: number }) => [e.userId, e]));
    expect(byUser.get(r1.id)).toMatchObject({ tier: '100', amount: '300.00', dayOff: false, note: null, percent: 100, exists: false });
    expect(byUser.get(r2.id)).toMatchObject({ tier: '120', amount: '500.00', dayOff: true, note: 'Paid day off', percent: 130 });
    expect(byUser.get(leaver.id)).toMatchObject({ tier: '100', amount: '300.00' }); // the part-month holder is judged on their own target
    expect(byUser.has(r3.id)).toBe(false);
    expect(byUser.has(ai.id)).toBe(false);
    expect(byUser.has(partner.id)).toBe(false);
    expect(res.body.entries).toHaveLength(3);
    expect(res.body.total).toBe('1100.00');
    expect(await counts()).toEqual(before);
  });

  it('the run creates one reward per person at the tier reached, posts DR 5050 / CR 2020 dated 30 September, and locks the month', async () => {
    const res = await api.post(ownerA, '/api/period-close/2026-09');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ period: '2026-09', alreadyClosed: false, created: 3, total: '1100.00' });
    expect(res.body.badges).toBeGreaterThan(0);
    expect(res.body.entries.map((e: { userId: number }) => e.userId).sort()).toEqual([r1.id, r2.id, leaver.id].sort());

    const entries = await prismaBase.commissionEntry.findMany({ where: { tenantId: pair.a.id, kind: 'reward', period: '2026-09' } });
    const of = (id: number) => entries.find((e) => e.userId === id)!;
    expect(of(r1.id)).toMatchObject({ roleId: callRepRole.id, status: 'earned', note: null, orderId: null });
    expect(of(r1.id).amount.toString()).toBe('300');
    expect(of(r2.id).amount.toString()).toBe('500'); // the 120 amount only, not 300 + 500
    expect(of(r2.id).note).toBe('Paid day off');
    expect(of(leaver.id).amount.toString()).toBe('300');
    expect(entries.every((e) => e.journalEntryId !== null)).toBe(true);

    const journals = await prismaBase.journalEntry.findMany({
      where: { tenantId: pair.a.id, sourceType: 'commission_accrual', sourceId: { in: entries.map((e) => e.id) } },
      include: { transactions: { include: { account: true } } },
    });
    expect(journals).toHaveLength(3);
    for (const j of journals) {
      expect(j.entryDate.toISOString().slice(0, 10)).toBe('2026-09-30');
      const debit = j.transactions.find((t) => t.debitAmount.gt(0))!;
      const credit = j.transactions.find((t) => t.creditAmount.gt(0))!;
      expect([debit.account.code, credit.account.code]).toEqual(['5050', '2020']);
      expect(debit.debitAmount.toString()).toBe(credit.creditAmount.toString());
    }
    expect(journals.reduce((sum, j) => sum + Number(j.transactions[0].debitAmount.gt(0) ? j.transactions[0].debitAmount : j.transactions[1].debitAmount), 0)).toBe(1100);

    // The month and the role and person targets of the month are closed.
    expect(await prismaBase.target.count({ where: { tenantId: pair.a.id, periodStart: SEP.start, scope: { in: ['month', 'role', 'person'] }, closedAt: null } })).toBe(0);
  });

  it('the close awards the result badges of the month inside the close: Top of month to rank 1 (a tie: both), Beat by 20 percent', async () => {
    const awards = await prismaBase.badgeAward.findMany({ where: { tenantId: pair.a.id, period: '2026-09' } });
    const held = (key: string) => awards.filter((a) => a.key === key).map((a) => a.userId).sort();
    // r2 and the AI agent both did 130 percent: rank 1 twice, so both hold Top of month; r1 at exactly 100 is rank 4 and has none
    expect(held('top_of_month')).toEqual([r2.id, ai.id].sort());
    expect(held('beat_target_20')).toEqual([r2.id, ai.id].sort());
    expect(awards.some((a) => a.userId === r3.id)).toBe(false);
    expect(awards.some((a) => a.key === 'hit_target_3_months')).toBe(false);
  });

  it('a second run changes nothing: same entries, no new journal lines, nothing created', async () => {
    const mid = await counts();
    const badgesBefore = await prismaBase.badgeAward.count({ where: { tenantId: pair.a.id, period: '2026-09' } });
    const first = await prismaBase.commissionEntry.findMany({ where: { tenantId: pair.a.id, kind: 'reward', period: '2026-09' }, orderBy: { id: 'asc' } });
    const res = await api.post(ownerA, '/api/period-close/2026-09');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ alreadyClosed: true, created: 0, total: '1100.00' });
    expect(res.body.entries.map((e: { id: number }) => e.id).sort()).toEqual(first.map((e) => e.id).sort());
    expect(await counts()).toEqual(mid);
    // Even with the month's lock gone, the unique key and the posting reference stop a duplicate.
    await prismaBase.target.updateMany({ where: { tenantId: pair.a.id, periodStart: SEP.start }, data: { closedAt: null } });
    const again = await api.post(ownerA, '/api/period-close/2026-09');
    expect(again.body.created).toBe(0);
    expect(again.body.badges).toBe(0); // the same badges are not awarded again
    expect(await prismaBase.badgeAward.count({ where: { tenantId: pair.a.id, period: '2026-09' } })).toBe(badgesBefore);
    expect((await counts()).entries).toBe(mid.entries);
    expect((await counts()).journals).toBe(mid.journals);
  });

  it('a later edit of a September target is refused with MONTH_CLOSED', async () => {
    await api.post(ownerA, '/api/period-close/2026-09'); // closed again after the check above
    const edit = runInTenant(pair.a.id, () => targets.saveTarget({
      scope: 'person', metric: 'confirmed_delivered', unit: 'count', value: 11, period: '2026-09', roleId: callRepRole.id, userId: r1.id,
    }));
    await expect(edit).rejects.toMatchObject({ errorCode: 'MONTH_CLOSED' });
  });

  it('a return after close takes nothing back: the reward stays', async () => {
    await prismaBase.order.updateMany({ where: { tenantId: pair.a.id, confirmedById: r1.id }, data: { status: 'returned' } });
    const entry = await prismaBase.commissionEntry.findFirstOrThrow({ where: { tenantId: pair.a.id, kind: 'reward', userId: r1.id, period: '2026-09' } });
    expect(entry.status).toBe('earned');
    expect((await api.post(ownerA, '/api/period-close/2026-09')).body.entries.some((e: { userId: number }) => e.userId === r1.id)).toBe(true);
  });
});

describe('a failed read stops the close', () => {
  it('writes nothing, opens a Finding naming the month and the error; a later run (as the system user) works', async () => {
    await monthTarget(AUG);
    await personTarget(r1.id, callRepRole.id, AUG, 5);
    await delivered(r1.id, 6, '2026-08-12T10:00:00Z');
    const before = await counts();
    const spy = jest.spyOn(ratesModule, 'deliveredByRep').mockRejectedValue(new Error('KPI store unavailable'));
    try {
      const res = await api.post(ownerA, '/api/period-close/2026-08');
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('KPI_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toContain('KPI store unavailable'); // the cause stays in the log and the Finding
    } finally {
      spy.mockRestore();
    }
    expect(await counts()).toEqual(before);
    const finding = await prismaBase.finding.findFirstOrThrow({ where: { tenantId: pair.a.id, subjectType: 'period_close', subjectId: '2026-08' } });
    expect(finding.status).toBe('open');
    expect(finding.note).toContain('2026-08');
    expect(finding.note).toContain('KPI store unavailable');
    expect(await prismaBase.target.count({ where: { tenantId: pair.a.id, periodStart: AUG.start, closedAt: { not: null } } })).toBe(0);

    // The job's path: the tenant's system user closes it once the read works again.
    const system = await runInTenant(pair.a.id, () => getSystemUserId(pair.a.id));
    const done = await runInTenant(pair.a.id, () => runPeriodClose('2026-08', system));
    expect(done).toMatchObject({ created: 1, alreadyClosed: false });
    const entry = await prismaBase.commissionEntry.findFirstOrThrow({ where: { tenantId: pair.a.id, kind: 'reward', period: '2026-08' } });
    expect(entry.amount.toString()).toBe('500'); // 6 of 5 is 120 percent
    const journal = await prismaBase.journalEntry.findFirstOrThrow({ where: { tenantId: pair.a.id, sourceType: 'commission_accrual', sourceId: entry.id } });
    expect(journal.createdBy).toBe(system);
    expect(journal.entryDate.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});

describe('two runs at once', () => {
  it('one creates the entries, the other returns alreadyClosed: one entry and one journal entry each', async () => {
    await monthTarget(MAY);
    await personTarget(r1.id, callRepRole.id, MAY, 5);
    await delivered(r1.id, 6, '2026-05-12T10:00:00Z');
    const [a, b] = await Promise.all([api.post(ownerA, '/api/period-close/2026-05'), api.post(ownerA, '/api/period-close/2026-05')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.alreadyClosed, b.body.alreadyClosed].sort()).toEqual([false, true]);
    expect(a.body.entries).toEqual(b.body.entries);
    const entries = await prismaBase.commissionEntry.findMany({ where: { tenantId: pair.a.id, kind: 'reward', period: '2026-05' } });
    expect(entries).toHaveLength(1);
    expect(await prismaBase.journalEntry.count({ where: { tenantId: pair.a.id, sourceType: 'commission_accrual', sourceId: entries[0].id } })).toBe(1);
  });
});

describe('a month with no month target', () => {
  it('a hand run is 409 NOTHING_TO_CLOSE with no audit row; the job skips quietly with no Finding', async () => {
    const audits = () => prismaBase.auditLog.count({ where: { tenantId: pair.a.id, action: 'period_close' } });
    const before = await audits();
    const res = await api.post(ownerA, '/api/period-close/2026-07');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOTHING_TO_CLOSE');
    expect(res.body.message ?? res.body.error).toContain('2026-07');
    expect(await audits()).toBe(before);
    // The job for the month before 1 August skips tenants with no target for it, and does not fail.
    await expect(runPeriodCloseJob(new Date('2026-08-01T03:00:00Z'))).resolves.toBeUndefined();
    expect(await prismaBase.finding.count({ where: { tenantId: pair.a.id, subjectType: 'period_close', subjectId: '2026-07' } })).toBe(0);
  });
});

describe('a ledger failure inside the run', () => {
  it('opens the Finding and writes nothing (the transaction rolls back); the next run works', async () => {
    await monthTarget(JUN);
    await personTarget(r1.id, callRepRole.id, JUN, 5);
    await delivered(r1.id, 5, '2026-06-12T10:00:00Z');
    const before = await counts();
    expect(await prismaBase.badgeAward.count({ where: { tenantId: pair.a.id, period: '2026-06' } })).toBe(0);
    const spy = jest.spyOn(commissionService, 'postEntry').mockRejectedValueOnce(new Error('ledger down'));
    try {
      const res = await api.post(ownerA, '/api/period-close/2026-06');
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await counts()).toEqual(before);
    expect(await prismaBase.badgeAward.count({ where: { tenantId: pair.a.id, period: '2026-06' } })).toBe(0); // a failed close leaves no badge
    const finding = await prismaBase.finding.findFirstOrThrow({ where: { tenantId: pair.a.id, subjectType: 'period_close', subjectId: '2026-06' } });
    expect(finding.note).toContain('ledger down');
    expect((await api.post(ownerA, '/api/period-close/2026-06')).body).toMatchObject({ created: 1, alreadyClosed: false });
    const june = await prismaBase.badgeAward.findMany({ where: { tenantId: pair.a.id, period: '2026-06' } });
    expect(june.map((a) => [a.userId, a.key])).toEqual([[r1.id, 'top_of_month']]);
  });
});

describe('tenant isolation', () => {
  it('tenant B previews and closes September with none of A: no entries, nothing of A is read or locked', async () => {
    const aBefore = await counts();
    const preview = await api.post(ownerB, '/api/period-close/2026-09/preview');
    expect(preview.status).toBe(200);
    expect(preview.body.entries).toEqual([]);
    const run = await api.post(ownerB, '/api/period-close/2026-09');
    expect(run.status).toBe(409); // B has no September target
    expect(run.body.code).toBe('NOTHING_TO_CLOSE');
    expect(await counts()).toEqual(aBefore);
    expect(await prismaBase.commissionEntry.count({ where: { tenantId: pair.b.id, kind: 'reward' } })).toBe(0);
  });
});
