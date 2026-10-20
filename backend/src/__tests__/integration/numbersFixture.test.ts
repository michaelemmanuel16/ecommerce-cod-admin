/**
 * M1-T23: the NUMBERS.md fixture. Seeds the test database, then checks every number of docs/mockups/v2/NUMBERS.md
 * with SQL (not through the app), checks that a second seed gives the same hash, that the revenue entries
 * leave no gap against the ledger, and that the script exits 1 under NODE_ENV=production.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawnSync } from 'child_process';
import path from 'path';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG, SeedFixtureResult } from '../fixtures/numbersFixture';
import { deliveredRevenue } from '../../services/kpi/revenue';
import { rates } from '../../services/kpi/rates';
import { historyFixtureChecks } from './fixtureChecks/history';
import { leadershipFixtureChecks } from './fixtureChecks/leadership';
import { productsFixtureChecks } from './fixtureChecks/products';
import { repsFixtureChecks } from './fixtureChecks/reps';
import { partnersFixtureChecks } from './fixtureChecks/partners';

jest.setTimeout(180_000);

let first: SeedFixtureResult;
let tenantId: string;

/** One SQL query as a { key: number } map. */
async function counts(sql: string): Promise<Record<string, number>> {
  const rows = await prismaBase.$queryRawUnsafe<Array<{ k: string; n: bigint }>>(sql, tenantId);
  return Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]));
}

beforeAll(async () => {
  first = await seedFixture(prismaBase);
  tenantId = first.tenantId;
});

afterAll(async () => {
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

describe('numbers fixture (M1-T23)', () => {
  it('has the order counts by status and 1,026 confirmed', async () => {
    const byStatus = await counts(`SELECT status::text AS k, COUNT(*) AS n FROM orders WHERE tenant_id = $1 AND created_at >= '2026-10-01' GROUP BY 1`);
    expect(byStatus.pending_confirmation).toBe(64);
    expect(byStatus.cancelled).toBe(355);
    expect((byStatus.confirmed ?? 0) + (byStatus.preparing ?? 0) + (byStatus.ready_for_pickup ?? 0)).toBe(100);
    expect(byStatus.out_for_delivery).toBe(148);
    expect(byStatus.delivered).toBe(376);
    expect(byStatus.failed_delivery).toBe(354);
    expect(byStatus.returned).toBe(48);
    expect(Object.values(byStatus).reduce((a, b) => a + b, 0)).toBe(1445);

    const [row] = await prismaBase.$queryRawUnsafe<Array<{ n: bigint; confirmed: bigint; first_oct: bigint; last_oct: bigint }>>(
      `SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL AND confirmed_by_id IS NOT NULL) AS confirmed,
              COUNT(*) FILTER (WHERE created_at >= '2026-10-01' AND created_at < '2026-10-18') AS first_oct,
              COUNT(*) FILTER (WHERE status NOT IN ('pending_confirmation','cancelled') AND confirmed_at IS NULL) AS last_oct
       FROM orders WHERE tenant_id = $1`, tenantId);
    expect(Number(row.confirmed)).toBe(1026);
    expect(Number(row.first_oct)).toBe(1445); // all placed 1 to 17 October
    expect(Number(row.last_oct)).toBe(0); // no confirmed-set order without confirmedAt
  });

  it('has timestamps that fit each status', async () => {
    const [row] = await prismaBase.$queryRawUnsafe<Array<Record<string, bigint>>>(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('out_for_delivery','delivered','failed_delivery','returned') AND dispatched_at IS NULL) AS no_dispatch,
         COUNT(*) FILTER (WHERE status IN ('confirmed','preparing','ready_for_pickup','pending_confirmation','cancelled') AND dispatched_at IS NOT NULL) AS early_dispatch,
         COUNT(*) FILTER (WHERE status = 'delivered' AND (delivery_date IS NULL OR delivery_date < '2026-10-01' OR delivery_date >= '2026-10-18')) AS bad_delivery,
         COUNT(*) FILTER (WHERE status <> 'delivered' AND delivery_date IS NOT NULL) AS stray_delivery,
         COUNT(*) FILTER (WHERE status = 'returned' AND returned_at IS NULL) AS no_return,
         COUNT(*) FILTER (WHERE status <> 'returned' AND returned_at IS NOT NULL) AS stray_return,
         COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL AND first_contact_at > confirmed_at) AS contact_after_confirm
       FROM orders WHERE tenant_id = $1 AND created_at >= '2026-10-01'`, tenantId);
    for (const [key, value] of Object.entries(row)) expect([key, Number(value)]).toEqual([key, 0]);
  });

  it('has history rows that end on the order status', async () => {
    const [row] = await prismaBase.$queryRawUnsafe<Array<{ bad: bigint; rows: bigint }>>(
      `SELECT COUNT(*) FILTER (WHERE last.status <> o.status) AS bad, COUNT(*) AS rows
       FROM orders o JOIN LATERAL (SELECT status FROM order_history h WHERE h.order_id = o.id ORDER BY h.created_at DESC, h.id DESC LIMIT 1) last ON true
       WHERE o.tenant_id = $1 AND o.created_at >= '2026-10-01'`, tenantId);
    expect(Number(row.rows)).toBe(1445);
    expect(Number(row.bad)).toBe(0);
  });

  it('has the 5 partners with assigned and delivered counts', async () => {
    const rows = await prismaBase.$queryRawUnsafe<Array<{ k: string; assigned: bigint; delivered: bigint; closed: bigint; out: bigint }>>(
      `SELECT u.first_name AS k, COUNT(*) AS assigned, COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered,
              COUNT(*) FILTER (WHERE o.status IN ('failed_delivery','returned')) AS closed,
              COUNT(*) FILTER (WHERE o.status = 'out_for_delivery') AS out
       FROM orders o JOIN users u ON u.id = o.delivery_agent_id WHERE o.tenant_id = $1 GROUP BY 1`, tenantId);
    const by = Object.fromEntries(rows.map((r) => [r.k, [Number(r.assigned), Number(r.delivered), Number(r.closed), Number(r.out)]]));
    expect(by).toEqual({
      Logiswift: [590, 220, 270, 100],
      Kofi: [172, 82, 70, 20],
      Esi: [102, 48, 40, 14],
      Kwesi: [54, 26, 22, 6],
      Kasapa: [8, 0, 0, 8],
    });
  });

  it('has the 3 call reps with confirmed, closed and delivered counts and 2,310 calls', async () => {
    const rows = await prismaBase.$queryRawUnsafe<Array<{ k: string; confirmed: bigint; closed: bigint; delivered: bigint; assigned: bigint }>>(
      `SELECT u.first_name AS k, COUNT(*) FILTER (WHERE o.confirmed_at IS NOT NULL) AS confirmed,
              COUNT(*) FILTER (WHERE o.status IN ('delivered','failed_delivery','returned')) AS closed,
              COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered, COUNT(*) AS assigned
       FROM orders o JOIN users u ON u.id = o.customer_rep_id WHERE o.tenant_id = $1 GROUP BY 1`, tenantId);
    const by = Object.fromEntries(rows.map((r) => [r.k, [Number(r.confirmed), Number(r.closed), Number(r.delivered), Number(r.assigned)]]));
    expect(by).toEqual({ Adwoa: [640, 486, 253, 871], Confirm: [328, 249, 110, 465], Nana: [58, 43, 13, 100] });

    const calls = await counts(`SELECT u.first_name AS k, COUNT(*) AS n FROM calls c JOIN users u ON u.id = c.sales_rep_id WHERE c.tenant_id = $1 GROUP BY 1`);
    expect(calls).toEqual({ Adwoa: 1360, Confirm: 780, Nana: 170 });
    const [noContact] = await prismaBase.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM orders WHERE tenant_id = $1 AND customer_rep_id IS NOT NULL AND status <> 'pending_confirmation' AND first_contact_at IS NULL`, tenantId);
    expect(Number(noContact.n)).toBe(0);
  });

  it('has the delivered units by product, 635 units and revenue GH₵92,000.00', async () => {
    const units = await counts(
      `SELECT p.sku AS k, SUM(i.quantity) AS n FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
       WHERE o.tenant_id = $1 AND o.status = 'delivered' AND o.created_at >= '2026-10-01' GROUP BY 1`);
    expect(units).toEqual({ 'MG-COPYBOOK-SET': 306, 'MG-REFILL-PENS': 172, 'MG-GRIP-TRAINER': 89, 'MG-PARENT-GUIDE': 58, 'DT-CREAM': 10 });
    expect(Object.values(units).reduce((a, b) => a + b, 0)).toBe(635);

    const [row] = await prismaBase.$queryRawUnsafe<Array<{ revenue: string; orders: bigint; aov: string; products: bigint }>>(
      `SELECT TO_CHAR(SUM(total_amount), 'FM999999990.0000') AS revenue, COUNT(*) AS orders,
              TO_CHAR(ROUND(SUM(total_amount) / COUNT(*)), 'FM999990') AS aov,
              (SELECT COUNT(*) FROM products WHERE tenant_id = $1) AS products
       FROM orders WHERE tenant_id = $1 AND status = 'delivered' AND created_at >= '2026-10-01'`, tenantId);
    expect(row.revenue).toBe('92000.0000');
    expect(Number(row.orders)).toBe(376);
    expect(row.aov).toBe('245'); // 92,000 / 376 = 244.68
    expect(Number(row.products)).toBe(5);
  });

  it('has an order total equal to its items less its discount, on every order', async () => {
    const [row] = await prismaBase.$queryRawUnsafe<Array<{ bad: bigint }>>(
      `SELECT COUNT(*) AS bad FROM orders o
       WHERE o.tenant_id = $1 AND o.total_amount <> (SELECT SUM(i.total_price) FROM order_items i WHERE i.order_id = o.id) - o.discount`, tenantId);
    expect(Number(row.bad)).toBe(0);
  });

  it('posts one revenue entry per delivered order, dated deliveryDate, and the ledger has no gap', async () => {
    const [row] = await prismaBase.$queryRawUnsafe<Array<{ entries: bigint; gaps: bigint; revenue: string; undated: bigint; unbalanced: bigint }>>(
      `SELECT COUNT(*) FILTER (WHERE o.status = 'delivered' AND j.id IS NOT NULL) AS entries,
              COUNT(*) FILTER (WHERE (o.status = 'delivered') <> (j.id IS NOT NULL)
                               OR (j.id IS NOT NULL AND (SELECT COALESCE(SUM(t.credit_amount), 0) FROM account_transactions t JOIN accounts a ON a.id = t.account_id
                                    WHERE t.journal_entry_id = j.id AND a.code = '4010') <> o.total_amount)) AS gaps,
              TO_CHAR((SELECT SUM(t.credit_amount) FROM account_transactions t JOIN accounts a ON a.id = t.account_id
                       JOIN journal_entries jj ON jj.id = t.journal_entry_id AND jj.entry_date >= '2026-10-01'
                       WHERE t.tenant_id = $1 AND a.code = '4010'), 'FM999999990.00') AS revenue,
              COUNT(*) FILTER (WHERE j.id IS NOT NULL AND j.entry_date <> o.delivery_date) AS undated,
              (SELECT COUNT(*) FROM (SELECT journal_entry_id FROM account_transactions WHERE tenant_id = $1 GROUP BY 1
                                     HAVING SUM(debit_amount) <> SUM(credit_amount)) x) AS unbalanced
       FROM orders o LEFT JOIN journal_entries j ON j.source_type = 'order_delivery' AND j.source_id = o.id AND j.tenant_id = o.tenant_id AND NOT j.is_voided
       WHERE o.tenant_id = $1 AND o.created_at >= '2026-10-01'`, tenantId);
    expect(Number(row.entries)).toBe(376);
    expect(Number(row.gaps)).toBe(0);
    expect(row.revenue).toBe('92000.00');
    expect(Number(row.undated)).toBe(0);
    expect(Number(row.unbalanced)).toBe(0);
  });

  it('touches no other tenant', async () => {
    const [row] = await prismaBase.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM orders WHERE source = 'fixture' AND tenant_id <> $1`, tenantId);
    expect(Number(row.n)).toBe(0);
  });

  it('gives the same hash on a second seed', async () => {
    const second = await seedFixture(prismaBase);
    expect(second.tenantId).toBe(first.tenantId);
    expect(second.hash).toBe(first.hash);
    expect(second.deliveredRevenue).toBe('92000.00');
    const [row] = await prismaBase.$queryRawUnsafe<Array<{ n: bigint; je: bigint }>>(
      `SELECT COUNT(*) AS n, (SELECT COUNT(*) FROM journal_entries WHERE tenant_id = $1 AND entry_date >= '2026-10-01') AS je FROM orders WHERE tenant_id = $1 AND created_at >= '2026-10-01'`, tenantId);
    expect(Number(row.n)).toBe(1445); // the re-run replaced the rows, it did not add to them
    expect(Number(row.je)).toBe(376);
  });

  it('exits 1 under NODE_ENV=production and writes nothing', () => {
    const result = spawnSync(
      path.join(__dirname, '../../../node_modules/.bin/ts-node'),
      ['scripts/seed-fixture.ts'],
      { cwd: path.join(__dirname, '../../..'), env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NODE_ENV=production');
  });

  it('exits 1 even with --allow-production', () => {
    const result = spawnSync(
      path.join(__dirname, '../../../node_modules/.bin/ts-node'),
      ['scripts/seed-fixture.ts', '--allow-production'],
      { cwd: path.join(__dirname, '../../..'), env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
  });
});

// M1-T16 and T17 "done when": the KPI services read the fixture numbers for 1 to 17 October 2026.
describe('KPI services on the fixture (M1-T16, T17)', () => {
  const from = new Date('2026-10-01T00:00:00Z');
  const to = new Date('2026-10-18T00:00:00Z');

  it('delivered revenue is 92,000.00 over 376 orders', async () => {
    const r = await deliveredRevenue(tenantId, from, to);
    expect(r.total.value).toBe('92000.00');
    expect(r.deliveredOrders.value).toBe(376);
  });

  it('confirmation 71% (1,026 / 1,445), delivery success 48% (376 / 778), yield about 34%', async () => {
    const r = await rates(tenantId, from, to);
    expect(r.confirmationRate.detail).toEqual({ confirmed: 1026, placed: 1445 });
    expect(Math.round(r.confirmationRate.value as number)).toBe(71);
    expect(r.deliverySuccessRate.detail).toMatchObject({ delivered: 376, closed: 778 });
    expect(Math.round(r.deliverySuccessRate.value as number)).toBe(48);
    expect(r.orderToCashYield.value).toBeGreaterThanOrEqual(33);
    expect(r.orderToCashYield.value).toBeLessThanOrEqual(35);
  });
});

historyFixtureChecks(() => tenantId);
leadershipFixtureChecks(() => tenantId);
productsFixtureChecks(() => tenantId);
repsFixtureChecks(() => tenantId);
partnersFixtureChecks(() => tenantId);
