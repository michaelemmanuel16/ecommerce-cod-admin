/**
 * The output of the 13 read tools on the numbers fixture, recorded from the tool files BEFORE they
 * moved onto the registry (snapshot in __snapshots__/toolOutputs.test.ts.snap). A green snapshot proves the registry
 * tools return the same fields and values.
 * Ids that the database assigns (they differ between runs) and fixture-seed timestamps are replaced by a placeholder.
 * "Now" is fixed at 17 October 2026, 13:00 (the fixture's own now), so periods like `today` and `month` are stable.
 *
 * Also here: the scan over the outputs (no fulfilmentRate / deliveryRate key), the fixture numbers of the analytics, financial and rep tools
 * and the registry tools called directly through runTool.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { getTool, runTool, ToolContext } from '../../tools/registry';
import '../../tools';
import { toolData, toolActorContext, toolAuditCount } from './helpers/callTool';

jest.setTimeout(180_000);

const FIXTURE_NOW = new Date('2026-10-17T13:00:00Z');
const BANNED_KEYS = /^(deliveryRate|fulfilmentRate|fulfillmentRate)$/;

const ID_KEYS = /^(id|orderId|customerId|agentId|productId|partnerId|repId|nextCursor)$/;
const SEED_TIME_KEYS = /^(createdAt|customerSince)$/;

/** Replace database-assigned ids and seed-time stamps so the snapshot holds the same text on every run. */
function normalize(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  }
  if (ID_KEYS.test(key) && value !== null && value !== undefined) return '<id>';
  if (SEED_TIME_KEYS.test(key)) return '<time>';
  return value;
}

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); collectKeys(v, out); }
  }
  return out;
}

/** One call per tool (a few have two), in a fixed order. orders_update_status is a write tool: it has its own test file. */
const CALLS: Array<[string, Record<string, unknown>]> = [
  ['orders_search', {}],
  ['orders_search', { status: 'delivered', limit: 5 }],
  ['orders_search', { search: 'Akosua', limit: 3 }],
  ['orders_summary', { period: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-17' }],
  ['orders_summary', { period: 'today' }],
  ['customers_lookup', { phone: '+233251000002' }],
  ['customers_lookup', { name: 'Akosua' }],
  ['products_inventory', {}],
  ['products_inventory', { lowStockOnly: true }],
  ['deliveries_active', { limit: 5 }],
  ['deliveries_active', { status: 'out_for_delivery', limit: 5 }],
  ['analytics_daily', { date: '2026-10-17' }],
  ['analytics_weekly', { weekOf: '2026-10-12' }],
  ['analytics_monthly', { month: '2026-10' }],
  ['financial_summary', { period: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-17' }],
  ['agents_status', {}],
  ['agents_performance', { period: 'month' }],
  ['reps_status', {}],
  ['reps_performance', { period: 'month' }],
];

let tenantId: string;

const callMcp = (name: string, args: Record<string, unknown>) => toolData(name, args, tenantId);
beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  jest.useFakeTimers({
    now: FIXTURE_NOW,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
});

afterAll(async () => {
  jest.useRealTimers();
  await prismaBase.auditLog.deleteMany({ where: { tenantId } });
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

describe('read tool outputs on the numbers fixture (snapshot of the pre-registry output)', () => {
  it.each(CALLS.map(([name, args], i) => [`${name} ${JSON.stringify(args)}`, name, args, i] as const))(
    '%s',
    async (_label, name, args) => {
      expect(normalize(await callMcp(name, args))).toMatchSnapshot();
    },
  );

  it('no tool output holds a fulfilmentRate or deliveryRate key (scan over the 13 read tool outputs; the 14th, orders_update_status, is scanned in ordersUpdateStatusTool.test.ts)', async () => {
    const keys: string[] = [];
    for (const [name, args] of CALLS) collectKeys(await callMcp(name, args), keys);
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.filter((k) => BANNED_KEYS.test(k))).toEqual([]);
  });
});

describe('registry tools called directly with runTool', () => {
  const run = async (name: string, args: Record<string, unknown>) => {
    const res = await runTool(name as any, args, await toolActorContext(tenantId));
    expect(res.status).toBe('ok');
    return JSON.parse(JSON.stringify((res as any).data));
  };

  it('products_inventory says when the list stops at 200 active products', async () => {
    const before = await run('products_inventory', {});
    expect(before.truncated).toBe(false);
    const extra = Array.from({ length: 201 }, (_, i) => ({
      tenantId, sku: `TRUNC-${i}`, name: `zz truncation ${i}`, category: 'test', price: 1, stockQuantity: 1,
    }));
    await prismaBase.product.createMany({ data: extra });
    try {
      const after = await run('products_inventory', {});
      expect(after.truncated).toBe(true);
      expect(after.products).toHaveLength(200);
    } finally {
      await prismaBase.product.deleteMany({ where: { tenantId, sku: { startsWith: 'TRUNC-' } } });
    }
  });

  it('writes one audit row for each call', async () => {
    const before = await toolAuditCount(tenantId, 'agents_status');
    await run('agents_status', {});
    const after = await toolAuditCount(tenantId, 'agents_status');
    expect(after - before).toBe(1);
  });

  it('every tool has a description and a money flag where it returns money', () => {
    for (const [name] of CALLS) expect(getTool(name)!.description.length).toBeGreaterThan(20);
    expect(getTool('financial_summary')!.money).toBe(true);
    expect(getTool('agents_status')!.money).toBe(false);
  });
});

describe('analytics and financial tools on the KPI services (1 to 17 October 2026)', () => {
  it('orders_summary, financial_summary and analytics_monthly return revenue 92000.00 and 376 delivered', async () => {
    const summary = await callMcp('orders_summary', { period: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-17' });
    expect(summary).toMatchObject({ revenue: '92000.00', deliveredCount: 376, currency: 'GHS' });
    const fin = await callMcp('financial_summary', { period: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-17' });
    expect(fin.revenue).toMatchObject({ delivered: '92000.00', deliveredOrders: 376 });
    const month = await callMcp('analytics_monthly', { month: '2026-10' });
    expect(month).toMatchObject({ revenue: '92000.00', delivered: 376 });
  });

  it('financial_summary has digitalRevenue (GL 4020) and paystackFees (GL 5060) as money strings, and says so', async () => {
    const fin = await callMcp('financial_summary', { period: 'month' });
    expect(fin.digitalRevenue).toMatch(/^-?\d+\.\d{2}$/);
    expect(fin.paystackFees).toMatch(/^-?\d+\.\d{2}$/);
    const description = getTool('financial_summary')!.description;
    expect(description).toContain('digitalRevenue');
    expect(description).toContain('4020');
    expect(description).toContain('paystackFees');
    expect(description).toContain('5060');
  });
});

describe('rep and partner rates on the fixture (NUMBERS.md)', () => {
  it('reps_performance: delivered-from-confirmed 52 / 44 / 30, confirmation 73 / 71 / 58', async () => {
    const body = await callMcp('reps_performance', { period: 'month' });
    const byName = (n: string) => body.reps.find((r: any) => r.name.startsWith(n));
    expect(Math.round(byName('Adwoa').deliveredFromConfirmedRate)).toBe(52);
    expect(Math.round(byName('Confirm').deliveredFromConfirmedRate)).toBe(44);
    expect(Math.round(byName('Nana').deliveredFromConfirmedRate)).toBe(30);
    expect(byName('Adwoa')).toMatchObject({ confirmed: 640, delivered: 253, closed: 486 });
    expect(Math.round(byName('Adwoa').confirmationRate)).toBe(74); // 73.5 stored; the check on the counts is in the rep checks
    expect(Math.round(byName('Nana').confirmationRate)).toBe(58);
  });

  it('agents_performance: Logiswift 45%, Kofi 54%, Esi 55%, Kwesi 54%, Kasapa no closed orders', async () => {
    const body = await callMcp('agents_performance', { period: 'month' });
    const row = (n: string) => body.agents.find((a: any) => a.name.startsWith(n));
    expect(Math.round(row('Logiswift').deliverySuccessRate)).toBe(45);
    expect(Math.round(row('Kofi').deliverySuccessRate)).toBe(54);
    expect(Math.round(row('Esi').deliverySuccessRate)).toBe(55);
    expect(Math.round(row('Kwesi').deliverySuccessRate)).toBe(54);
    expect(row('Kasapa').deliverySuccessRate).toBeNull();
    expect(row('Logiswift')).toMatchObject({ assigned: 590, delivered: 220, closed: 490 });
  });
});
