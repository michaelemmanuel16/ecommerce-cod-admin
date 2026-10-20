/**
 * COD-13: a picker range arrives as 'YYYY-MM-DD' for both bounds (decision D43). A date-only `endDate` is a store-zone
 * day and covers all of it: a row at 23:30 store time on that day is in the range. A full ISO instant is still read as
 * the instant (a 23:00 end leaves the 23:30 row out), so older callers keep working.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let lateOrderId: number;
let lateCallId: number;
let lateJournalId: number;
let lateMessageId: number;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// 23:30 on 17 Sep 2026 in the store zone (Africa/Accra, UTC+0). No other seeded row is in September.
const DAY = '2026-09-17';
const LATE = new Date('2026-09-17T23:30:00.000Z');
const DATE_ONLY = `startDate=${DAY}&endDate=${DAY}`;
const ISO_EARLY_END = `startDate=${DAY}&endDate=2026-09-17T23:00:00.000Z`;

beforeAll(async () => {
  pair = await createTwoTenants('datebounds');
  const a = pair.a;
  const own = await prismaBase.order.findUniqueOrThrow({ where: { id: a.ids.order } });
  const late = await prismaBase.order.create({
    data: {
      customerId: own.customerId, status: 'delivered', deliveryDate: LATE, createdAt: LATE, updatedAt: LATE,
      shippingCost: 0, deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: a.id,
      customerRepId: a.users.salesRep.id, deliveryAgentId: a.users.deliveryAgent.id,
      subtotal: 100, totalAmount: 100, codAmount: 100,
    },
  });
  lateOrderId = late.id;
  const call = await prismaBase.call.create({
    data: { customerId: own.customerId, salesRepId: a.users.salesRep.id, outcome: 'confirmed', createdAt: LATE, tenantId: a.id },
  });
  lateCallId = call.id;
  const journal = await prismaBase.journalEntry.create({
    data: {
      entryNumber: `JE-DATEBOUNDS-${Date.now()}`, entryDate: LATE, description: 'late entry', sourceType: 'manual',
      createdBy: a.users.admin.id, tenantId: a.id,
    },
  });
  lateJournalId = journal.id;
  const message = await prismaBase.messageLog.create({
    data: { channel: 'whatsapp', messageBody: 'late message', createdAt: LATE, tenantId: a.id },
  });
  lateMessageId = message.id;
  await prismaBase.expense.create({
    data: { category: 'other', amount: 25, description: 'late expense', expenseDate: LATE, tenantId: a.id },
  });
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const get = (path: string, token = () => pair.a.users.admin.token) => request(app).get(path).set(auth(token()));

describe('orders', () => {
  it('list: a date-only endDate includes 23:30 on that day; an earlier ISO end leaves it out', async () => {
    const day = await get(`/api/orders?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(day.body.orders.map((o: { id: number }) => o.id)).toContain(lateOrderId);
    const iso = await get(`/api/orders?${ISO_EARLY_END}`);
    expect(iso.body.orders.map((o: { id: number }) => o.id)).not.toContain(lateOrderId);
  });

  it('stats: same rule', async () => {
    const day = await get(`/api/orders/stats?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(day.body.stats.totalOrders).toBe(1);
    const iso = await get(`/api/orders/stats?${ISO_EARLY_END}`);
    expect(iso.body.stats.totalOrders).toBe(0);
  });
});

describe('analytics', () => {
  it('conversion funnel', async () => {
    const day = await get(`/api/analytics/conversion-funnel?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(day.body.funnel).toEqual([{ status: 'delivered', count: 1 }]);
    const iso = await get(`/api/analytics/conversion-funnel?${ISO_EARLY_END}`);
    expect(iso.body.funnel).toEqual([]);
  });

  it('status distribution', async () => {
    const day = await get(`/api/analytics/status-distribution?${DATE_ONLY}`);
    expect(day.body.distribution).toEqual([{ status: 'delivered', count: 1 }]);
    const iso = await get(`/api/analytics/status-distribution?${ISO_EARLY_END}`);
    expect(iso.body.distribution).toEqual([]);
  });
});

describe('rep and agent performance (users routes)', () => {
  it('reps/performance counts the 23:30 order for a date-only end', async () => {
    const assigned = (body: { performance: { repId: number; metrics: { totalAssigned: number } }[] }) =>
      body.performance.find((r) => r.repId === pair.a.users.salesRep.id)?.metrics.totalAssigned;
    const day = await get(`/api/users/reps/performance?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(assigned(day.body)).toBe(1);
    const iso = await get(`/api/users/reps/performance?${ISO_EARLY_END}`);
    expect(assigned(iso.body)).toBe(0);
  });

  it('agents/performance counts the 23:30 order for a date-only end', async () => {
    const assigned = (body: { performance: { userId: number; totalAssigned: number }[] }) =>
      body.performance.find((r) => r.userId === pair.a.users.deliveryAgent.id)?.totalAssigned;
    const day = await get(`/api/users/agents/performance?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(assigned(day.body)).toBe(1);
    const iso = await get(`/api/users/agents/performance?${ISO_EARLY_END}`);
    expect(assigned(iso.body)).toBe(0);
  });
});

describe('financial', () => {
  it('summary revenue: a date-only end covers the day; an ISO end still snaps to the end of its day, as before', async () => {
    const day = await get(`/api/financial/summary?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(day.body.summary.totalRevenue).toBe('100.00');
    const iso = await get(`/api/financial/summary?${ISO_EARLY_END}`);
    expect(iso.body.summary.totalRevenue).toBe('100.00');
    const before = await get(`/api/financial/summary?startDate=${DAY}&endDate=2026-09-16T12:00:00.000Z`);
    expect(before.body.summary.totalRevenue).toBe('0.00');
  });

  it('expenses list and breakdown', async () => {
    const day = await get(`/api/financial/expenses?${DATE_ONLY}`);
    expect(day.body.expenses).toHaveLength(1);
    const iso = await get(`/api/financial/expenses?${ISO_EARLY_END}`);
    expect(iso.body.expenses).toHaveLength(0);
    const bd = await get(`/api/financial/expenses/breakdown?${DATE_ONLY}`);
    expect(bd.body.breakdown).toHaveLength(1);
    const bdIso = await get(`/api/financial/expenses/breakdown?${ISO_EARLY_END}`);
    expect(bdIso.body.breakdown).toHaveLength(0);
  });

  it('reports', async () => {
    const day = await get(`/api/financial/reports?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(day.body.reports).toEqual([expect.objectContaining({ date: DAY, revenue: '100.00', orders: 1 })]);
    // An ISO end snaps to the end of its day, as the summary does.
    const iso = await get(`/api/financial/reports?${ISO_EARLY_END}`);
    expect(iso.body.reports).toEqual([expect.objectContaining({ date: DAY, revenue: '100.00', orders: 1 })]);
    const before = await get(`/api/financial/reports?startDate=${DAY}&endDate=2026-09-16T12:00:00.000Z`);
    expect(before.body.reports).toEqual([]);
  });
});

describe('deliveries (agent-orders)', () => {
  it('a delivered order at 23:30 is in a date-only range', async () => {
    const tok = () => pair.a.users.deliveryAgent.token;
    const day = await get(`/api/deliveries/agent-orders?status=delivered&${DATE_ONLY}`, tok);
    expect(day.status).toBe(200);
    expect(day.body.deliveries.map((d: { orderId: number }) => d.orderId)).toContain(lateOrderId);
    const iso = await get(`/api/deliveries/agent-orders?status=delivered&${ISO_EARLY_END}`, tok);
    expect(iso.body.deliveries.map((d: { orderId: number }) => d.orderId)).not.toContain(lateOrderId);
  });
});

// readDateBound in the controller (calls) and parseInclusiveBound in the service (journal entries, WhatsApp messages).
describe('other date filters', () => {
  it('calls list (controller path): a date-only endDate includes 23:30 on that day', async () => {
    const day = await get(`/api/calls?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(day.body.calls.map((c: { id: number }) => c.id)).toContain(lateCallId);
    const iso = await get(`/api/calls?${ISO_EARLY_END}`);
    expect(iso.body.calls.map((c: { id: number }) => c.id)).not.toContain(lateCallId);
  });

  it('journal entries (service path): same rule', async () => {
    const day = await get(`/api/gl/journal-entries?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(day.body.entries.map((e: { id: number }) => e.id)).toContain(lateJournalId);
    const iso = await get(`/api/gl/journal-entries?${ISO_EARLY_END}`);
    expect(iso.body.entries.map((e: { id: number }) => e.id)).not.toContain(lateJournalId);
  });

  it('WhatsApp messages (service path): same rule', async () => {
    const day = await get(`/api/whatsapp/messages?${DATE_ONLY}`);
    expect(day.status).toBe(200);
    expect(day.body.data.map((m: { id: number }) => m.id)).toContain(lateMessageId);
    const iso = await get(`/api/whatsapp/messages?${ISO_EARLY_END}`);
    expect(iso.body.data.map((m: { id: number }) => m.id)).not.toContain(lateMessageId);
  });
});
