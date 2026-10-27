/**
 * M5-T19 (COD-51, F-913, F-1164, F-939): the unified payout API.
 * Fixture numbers: Adwoa owed GH₵2,034 and Nana GH₵134, payable 2,168 (account 2020).
 * A payout lists the payee's open entries, marks them paid, posts DR 2020 / CR 1010 and stores method, reference and recorder.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { postEntry } from '../../services/commissionService';
import { createTenant, deleteTenantRows, mkUser as mkTenantUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { accountBalance } from './helpers/ledgerPost';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const tenantIds: string[] = [];
const U: Record<string, any> = {};
let tenantId: string;
let otherTenantId: string;
const E: Record<string, number[]> = {};

const mkUser = (label: string, role: any, extra: Record<string, unknown> = {}, tid = tenantId) => mkTenantUser(tid, label, role, extra);
const balance = (code: string) => accountBalance(tenantId, code);

/** One entry; `post` also books its DR 5050 / CR 2020 so account 2020 matches the open entries. */
const mkEntry = async (userId: number, kind: 'base' | 'upsell' | 'reward', amount: number, day: number, extra: Record<string, unknown> = {}) => {
  const entry = await prismaBase.commissionEntry.create({
    data: { tenantId, userId, kind, status: 'earned', amount, earnedAt: new Date(Date.UTC(2026, 9, day, 10)), ...extra } as any,
  });
  if (entry.status === 'earned') await runInTenant(tenantId, () => prisma.$transaction((tx) => postEntry(tx, entry.id, U.admin.id)));
  return entry.id;
};
const payoutBody = (over: Record<string, unknown>) => ({ method: 'Mobile Money', ...over });

beforeAll(async () => {
  const a = await createTenant('Payouts A');
  const b = await createTenant('Payouts B');
  tenantId = a.id;
  otherTenantId = b.id;
  tenantIds.push(a.id, b.id);
  await seedTenantDefaults(a.id);
  await seedTenantDefaults(b.id);
  U.admin = await mkUser('admin', 'admin');
  U.manager = await mkUser('manager', 'manager');
  U.accountant = await mkUser('acct', 'accountant');
  U.rep = await mkUser('rep', 'sales_rep');
  U.agentRole = await mkUser('agentrole', 'delivery_agent');
  U.adwoa = await mkUser('adwoa', 'sales_rep');
  U.nana = await mkUser('nana', 'sales_rep');
  U.bot = await mkUser('bot', 'sales_rep', { kind: 'ai_agent' });
  U.kofi = await mkUser('kofi', 'delivery_agent');
  U.otherAdmin = await mkUser('otheradmin', 'admin', {}, otherTenantId);

  // Adwoa: earned 2,634, paid 600 earlier, owed 2,034 (2,024 commission + 610 upsell - 600 paid)
  const earlier = await prismaBase.payout.create({ data: { tenantId, payeeId: U.adwoa.id, kind: 'rep', amount: 600, method: 'Bank Transfer', status: 'completed' } });
  await mkEntry(U.adwoa.id, 'base', 600, 1, { status: 'paid', payoutId: earlier.id });
  E.adwoa = [
    await mkEntry(U.adwoa.id, 'base', 1424, 2),
    await mkEntry(U.adwoa.id, 'upsell', 610, 3),
  ];
  // Nana: owed 134 (104 commission + 30 upsell)
  E.nana = [await mkEntry(U.nana.id, 'base', 104, 4), await mkEntry(U.nana.id, 'upsell', 30, 5)];
  // Kofi (a delivery agent): a target reward and, to prove the rule, a stray base entry
  E.kofi = [await mkEntry(U.kofi.id, 'reward', 100, 6), await mkEntry(U.kofi.id, 'base', 5, 7)];
  await mkEntry(U.bot.id, 'base', 8, 8, { status: 'no_payout' });
}, 60000);

afterAll(async () => {
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('the owed preview (F-913)', () => {
  it('shows Adwoa owed 2,034 and Nana owed 134 (payable 2,168 in 2020)', async () => {
    const adwoa = await request(app).get(`/api/payouts/owed/${U.adwoa.id}`).set(bearer(U.admin.token));
    expect(adwoa.status).toBe(200);
    expect(adwoa.body).toMatchObject({ commission: '2024.00', upsellReward: '610.00', earned: '2634.00', paid: '600.00', owed: '2034.00' });
    expect(adwoa.body.entries).toHaveLength(2);

    const nana = await request(app).get(`/api/payouts/owed/${U.nana.id}`).set(bearer(U.manager.token));
    expect(nana.body).toMatchObject({ commission: '104.00', upsellReward: '30.00', owed: '134.00' });
    // 2020 holds the open entries: 2,168 of the two reps plus Kofi's 105 (Adwoa's earlier 600 is paid and not booked here)
    expect(await balance('2020')).toBe(2034 + 134 + 105);
  });

  it('lists every rep with earned, paid and owed for the Rep commissions tab; agents and AI agents are left out', async () => {
    const res = await request(app).get('/api/payouts/owed').set(bearer(U.manager.token));
    expect(res.status).toBe(200);
    const byId = new Map<number, any>(res.body.reps.map((r: any) => [r.id, r]));
    expect(byId.get(U.adwoa.id)).toMatchObject({ delivered: 2, commission: '2024.00', upsellReward: '610.00', earned: '2634.00', paid: '600.00', owed: '2034.00' });
    expect(byId.get(U.nana.id)).toMatchObject({ owed: '134.00', paid: '0.00' });
    expect(byId.get(U.rep.id)).toMatchObject({ owed: '0.00', delivered: 0 });
    // Totals come from the server: owed 2,034 + 134 = 2,168 (R3 fixture), the earlier 600 paid and in this month
    expect(res.body.totals).toEqual({ owed: '2168.00', paid: '600.00', paidInMonth: '600.00', repsOwed: 2 });
    expect(res.body.month).toMatch(/^\d{4}-\d{2}$/);
    expect(byId.get(U.adwoa.id).paidInMonth).toBe('600.00');
    expect(byId.has(U.kofi.id)).toBe(false);
    expect(byId.has(U.bot.id)).toBe(false);
    expect((await request(app).get('/api/payouts/owed').set(bearer(U.rep.token))).status).toBe(403);
    expect((await request(app).get('/api/payouts/owed').set(bearer(U.otherAdmin.token))).body.reps.map((r: any) => r.id)).not.toContain(U.adwoa.id);
  });

  it('Paid in month follows ?month=YYYY-MM, and a bad month is refused', async () => {
    const other = await request(app).get('/api/payouts/owed?month=2020-01').set(bearer(U.admin.token));
    expect(other.body.month).toBe('2020-01');
    expect(other.body.totals).toMatchObject({ paidInMonth: '0.00', paid: '600.00', owed: '2168.00' });
    expect((await request(app).get('/api/payouts/owed?month=2020-13').set(bearer(U.admin.token))).status).toBe(400);
  });

  it('inactive reps show only while owed something, unless ?includeInactive=true', async () => {
    const gone = await mkUser('gone', 'sales_rep', { isActive: false });
    const goneOwed = await mkUser('goneowed', 'sales_rep', { isActive: false });
    await prismaBase.commissionEntry.create({ data: { tenantId, userId: goneOwed.id, kind: 'base', status: 'earned', amount: 12, earnedAt: new Date() } });
    const ids = async (q = '') => (await request(app).get(`/api/payouts/owed${q}`).set(bearer(U.admin.token))).body.reps.map((r: any) => r.id);
    const def = await ids();
    expect(def).toContain(goneOwed.id);
    expect(def).not.toContain(gone.id);
    expect(await ids('?includeInactive=true')).toEqual(expect.arrayContaining([gone.id, goneOwed.id]));
    // A person who left can still be paid what they are owed
    expect((await request(app).get(`/api/payouts/owed/${goneOwed.id}`).set(bearer(U.admin.token))).body.owed).toBe('12.00');
    await prismaBase.commissionEntry.deleteMany({ where: { userId: goneOwed.id } });
  });

  it('an agent preview counts target rewards only; an AI agent has no payout', async () => {
    const kofi = await request(app).get(`/api/payouts/owed/${U.kofi.id}`).set(bearer(U.admin.token));
    expect(kofi.body.owed).toBe('100.00');
    expect(kofi.body.payee.kind).toBe('agent');
    const bot = await request(app).get(`/api/payouts/owed/${U.bot.id}`).set(bearer(U.admin.token));
    expect(bot.status).toBe(400);
    expect(bot.body.error ?? bot.body.message).toMatch(/AI agents/);
  });
});

describe('recording a payout (F-913, M5-T19)', () => {
  it('rejects an amount above owed with "Owed is GH₵2,034"', async () => {
    const res = await request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: U.adwoa.id, amount: 2035, reference: 'TOO-MUCH' }));
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toBe('Owed is GH₵2,034');
    expect(await prismaBase.payout.count({ where: { payeeId: U.adwoa.id, reference: 'TOO-MUCH' } })).toBe(0);
  });

  it('has no delivery fee line: an unknown field is refused', async () => {
    const res = await request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: U.adwoa.id, deliveryFee: 25 }));
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toMatch(/deliveryFee/);
  });

  it('pays Adwoa in full: entries paid, one payout, DR 2020 / CR 1010, method, reference and recorder stored', async () => {
    const before = { payable: await balance('2020'), cash: await balance('1010') };
    const res = await request(app).post('/api/payouts').set(bearer(U.admin.token))
      .send(payoutBody({ payeeId: U.adwoa.id, amount: '2034.00', reference: 'MOMO-1', entryIds: E.adwoa, notes: 'October' }));
    expect(res.status).toBe(201);
    const payout = res.body.payout;
    expect(payout).toMatchObject({ amount: '2034.00', method: 'Mobile Money', reference: 'MOMO-1', kind: 'rep', recordedById: U.admin.id, payeeId: U.adwoa.id });
    expect(payout.commissionEntries).toHaveLength(2);

    const entries = await prismaBase.commissionEntry.findMany({ where: { id: { in: E.adwoa } } });
    expect(entries.every((e) => e.status === 'paid' && e.payoutId === payout.id)).toBe(true);

    const journal = await prismaBase.journalEntry.findFirstOrThrow({
      where: { tenantId, sourceType: 'payout', sourceId: payout.id },
      include: { transactions: { include: { account: true } } },
    });
    expect(journal.transactions.find((t) => Number(t.debitAmount) === 2034)!.account.code).toBe('2020');
    expect(journal.transactions.find((t) => Number(t.creditAmount) === 2034)!.account.code).toBe('1010');
    expect(await balance('2020')).toBe(before.payable - 2034);
    expect(await balance('1010')).toBe(before.cash - 2034);
  });

  it('a second payout on the same entries fails with "Already paid"', async () => {
    const again = await request(app).post('/api/payouts').set(bearer(U.admin.token))
      .send(payoutBody({ payeeId: U.adwoa.id, amount: 2034, reference: 'MOMO-2', entryIds: E.adwoa }));
    expect(again.status).toBe(409);
    expect(again.body.error ?? again.body.message).toBe('Already paid');
    const noIds = await request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: U.adwoa.id, reference: 'MOMO-3' }));
    expect(noIds.status).toBe(409);
    expect(noIds.body.error ?? noIds.body.message).toBe('Already paid');
    expect(await prismaBase.payout.count({ where: { payeeId: U.adwoa.id, reference: { in: ['MOMO-2', 'MOMO-3'] } } })).toBe(0);
  });

  it('pays the oldest first on a part payment and splits the last entry; the rest stays owed', async () => {
    const res = await request(app).post('/api/payouts').set(bearer(U.accountant.token)).send(payoutBody({ payeeId: U.nana.id, amount: 120, reference: 'N-1' }));
    expect(res.status).toBe(201);
    const entries = await prismaBase.commissionEntry.findMany({ where: { userId: U.nana.id }, orderBy: { id: 'asc' } });
    expect(entries.map((e) => [e.kind, e.status, Number(e.amount)])).toEqual([['base', 'paid', 104], ['upsell', 'paid', 16], ['upsell', 'earned', 14]]);
    const owed = await request(app).get(`/api/payouts/owed/${U.nana.id}`).set(bearer(U.admin.token));
    expect(owed.body.owed).toBe('14.00');
    // The ledger agrees: 2020 holds exactly the open entries (Nana's 14 and Kofi's 105)
    expect(await balance('2020')).toBe(14 + 105);
    // The tab and the form read one owed rule: after a split payment both show 14, for Adwoa (paid in full) 0
    const tab = await request(app).get('/api/payouts/owed').set(bearer(U.admin.token));
    for (const person of [U.nana, U.adwoa]) {
      const preview = await request(app).get(`/api/payouts/owed/${person.id}`).set(bearer(U.admin.token));
      expect(tab.body.reps.find((r: any) => r.id === person.id).owed).toBe(preview.body.owed);
    }
    expect(tab.body.reps.find((r: any) => r.id === U.nana.id).owed).toBe('14.00');
  });

  it('keeps a reference unique per payee and method', async () => {
    const same = await request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: U.nana.id, amount: 5, reference: 'N-1' }));
    expect(same.status).toBe(409);
    expect(same.body.error ?? same.body.message).toMatch(/reference was already used/);
    // The same reference on another method, and on another person, is fine
    const otherMethod = await request(app).post('/api/payouts').set(bearer(U.admin.token)).send({ payeeId: U.nana.id, amount: 5, method: 'Cash', reference: 'N-1' });
    expect(otherMethod.status).toBe(201);
    const nanaOwed = await prismaBase.commissionEntry.findMany({ where: { userId: U.nana.id, status: 'earned' } });
    expect(nanaOwed.map((e) => Number(e.amount))).toEqual([9]);
  });

  it('two payouts at the same moment on the same entries: one wins, the other gets "Already paid"', async () => {
    const esi = await mkUser('esi', 'sales_rep');
    const ids = [await mkEntry(esi.id, 'base', 40, 9), await mkEntry(esi.id, 'base', 60, 10)];
    const [x, y] = await Promise.all([
      request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: esi.id, entryIds: ids, reference: 'RACE-1' })),
      request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: esi.id, entryIds: ids, reference: 'RACE-2' })),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.body.error ?? loser.body.message).toBe('Already paid');
    expect(await prismaBase.payout.count({ where: { payeeId: esi.id } })).toBe(1);

    // Same reference at the same moment: the unique key answers the second
    const joy = await mkUser('joy', 'sales_rep');
    const a = await mkEntry(joy.id, 'base', 10, 11);
    const b = await mkEntry(joy.id, 'base', 10, 12);
    const [p, q] = await Promise.all([
      request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: joy.id, entryIds: [a], reference: 'SAME' })),
      request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: joy.id, entryIds: [b], reference: 'SAME' })),
    ]);
    expect([p.status, q.status].sort()).toEqual([201, 409]);
  });

  it('refuses a person with nothing owed', async () => {
    const res = await request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: U.rep.id }));
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toMatch(/Nothing is owed/);
  });

  it('pays a delivery agent target rewards only', async () => {
    const [reward, stray] = E.kofi;
    const refused = await request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: U.kofi.id, entryIds: [reward, stray] }));
    expect(refused.status).toBe(400);
    expect(refused.body.error ?? refused.body.message).toMatch(/target rewards only/);

    const ok = await request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: U.kofi.id, method: 'Cash', reference: 'K-1' }));
    expect(ok.status).toBe(201);
    expect(ok.body.payout).toMatchObject({ kind: 'agent', amount: '100.00' });
    expect((await prismaBase.commissionEntry.findUniqueOrThrow({ where: { id: stray } })).status).toBe('earned');
  });

  it('refuses an AI agent', async () => {
    const res = await request(app).post('/api/payouts').set(bearer(U.admin.token)).send(payoutBody({ payeeId: U.bot.id }));
    expect(res.status).toBe(400);
  });

  it('lists one history for the person with who recorded it', async () => {
    const res = await request(app).get(`/api/payouts?payeeId=${U.adwoa.id}`).set(bearer(U.manager.token));
    expect(res.status).toBe(200);
    const mine = res.body.payouts.find((p: any) => p.reference === 'MOMO-1');
    expect(mine).toMatchObject({ method: 'Mobile Money', amount: '2034.00', payee: { id: U.adwoa.id }, recordedBy: { id: U.admin.id } });
    expect(mine._count.commissionEntries).toBe(2);
  });
});

describe('permission and tenant (F-939)', () => {
  it('a role without the payouts permission is denied (call rep, delivery agent)', async () => {
    for (const u of [U.rep, U.agentRole]) {
      const post = await request(app).post('/api/payouts').set(bearer(u.token)).send(payoutBody({ payeeId: U.nana.id }));
      expect(post.status).toBe(403);
      expect((await request(app).get('/api/payouts').set(bearer(u.token))).status).toBe(403);
      expect((await request(app).get(`/api/payouts/owed/${U.nana.id}`).set(bearer(u.token))).status).toBe(403);
    }
  });

  it('a role with payouts:view only cannot create when the tenant takes create away', async () => {
    await prismaBase.systemConfig.upsert({
      where: { tenantId },
      update: { rolePermissions: { manager: { payouts: ['view'] } } },
      create: { tenantId, rolePermissions: { manager: { payouts: ['view'] } } } as any,
    });
    const { clearPermissionsCache } = await import('../../middleware/auth');
    clearPermissionsCache();
    const post = await request(app).post('/api/payouts').set(bearer(U.manager.token)).send(payoutBody({ payeeId: U.nana.id }));
    expect(post.status).toBe(403);
    expect((await request(app).get('/api/payouts').set(bearer(U.manager.token))).status).toBe(200);
  });

  it('another tenant cannot see or pay this tenant\'s people', async () => {
    const owed = await request(app).get(`/api/payouts/owed/${U.nana.id}`).set(bearer(U.otherAdmin.token));
    expect(owed.status).toBe(404);
    const post = await request(app).post('/api/payouts').set(bearer(U.otherAdmin.token)).send(payoutBody({ payeeId: U.nana.id, amount: 1 }));
    expect(post.status).toBe(404);
    const list = await request(app).get('/api/payouts').set(bearer(U.otherAdmin.token));
    expect(list.body.payouts).toHaveLength(0);
  });

  it('the old rep payout routes are gone', async () => {
    expect((await request(app).get(`/api/users/reps/${U.nana.id}/pending-payments`).set(bearer(U.admin.token))).status).toBe(404);
    expect((await request(app).post(`/api/users/reps/${U.nana.id}/process-payout`).set(bearer(U.admin.token)).send({})).status).toBe(404);
  });
});
