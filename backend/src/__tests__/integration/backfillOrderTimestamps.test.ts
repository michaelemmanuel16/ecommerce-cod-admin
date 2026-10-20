/**
 * M1-T06: scripts/backfill-order-timestamps.ts fills confirmedAt/confirmedById, dispatchedAt, firstContactAt
 * and returnedAt from order_history and calls. It never overwrites a set value, never guesses, never changes
 * status_version, is idempotent, and with --tenant leaves other tenants alone.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'child_process';
import path from 'path';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

const SUFFIX = Date.now();
const at = (h: number) => new Date(Date.UTC(2026, 8, 10, h, 0, 0));
let tenantA: string;
let tenantB: string;
let repId: number;
let full: number; // history: pending -> confirmed -> out_for_delivery -> delivered -> returned
let deliveredOnly: number; // only a delivered row
let noHistory: number; // delivered status, no rows at all
let calls: number; // confirmed status, two rep calls (calls.sales_rep_id is NOT NULL, so every call is a rep call)
let preset: number; // confirmedAt already set, history says otherwise
let otherTenantOrder: number;

const run = (...args: string[]) =>
  execFileSync(
    path.join(__dirname, '../../../node_modules/.bin/ts-node'),
    ['scripts/backfill-order-timestamps.ts', ...args],
    { cwd: path.join(__dirname, '../../..'), env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' },
  );

const row = (id: number) => prismaBase.order.findUniqueOrThrow({ where: { id } });

async function mkOrder(tenantId: string, customerId: number, status: any, extra: Record<string, unknown> = {}) {
  return (await prismaBase.order.create({ data: { customerId, status, subtotal: 10, totalAmount: 10, tenantId, ...extra } as any })).id;
}
const hist = (orderId: number, tenantId: string, status: any, createdAt: Date, changedBy?: number) =>
  prismaBase.orderHistory.create({ data: { orderId, status, createdAt, tenantId, changedBy } });

beforeAll(async () => {
  tenantA = (await createTenant('TS Backfill A')).id;
  tenantB = (await createTenant('TS Backfill B')).id;
  const mkCustomer = (tenantId: string, n: number) =>
    prismaBase.customer.create({
      data: { firstName: 'Ama', lastName: 'Test', phoneNumber: `+2332${String(SUFFIX).slice(-6)}${n}`, address: 'x', state: 'x', area: 'x', tenantId },
    });
  const [custA, custB] = [await mkCustomer(tenantA, 1), await mkCustomer(tenantB, 2)];
  repId = (await prismaBase.user.create({
    data: { email: `ts-rep-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Rep', lastName: 'T', role: 'sales_rep', tenantId: tenantA },
  })).id;

  full = await mkOrder(tenantA, custA.id, 'returned');
  await hist(full, tenantA, 'pending_confirmation', at(7));
  await hist(full, tenantA, 'confirmed', at(9), repId);
  await hist(full, tenantA, 'confirmed', at(10)); // a later confirmed row must not win
  await hist(full, tenantA, 'out_for_delivery', at(11));
  await hist(full, tenantA, 'delivered', at(12));
  await hist(full, tenantA, 'returned', at(13));

  deliveredOnly = await mkOrder(tenantA, custA.id, 'delivered');
  await hist(deliveredOnly, tenantA, 'delivered', at(15));

  noHistory = await mkOrder(tenantA, custA.id, 'delivered');

  calls = await mkOrder(tenantA, custA.id, 'confirmed');
  await prismaBase.call.createMany({
    data: [
      { orderId: calls, customerId: custA.id, salesRepId: repId, outcome: 'no_answer', createdAt: at(18), tenantId: tenantA },
      { orderId: calls, customerId: custA.id, salesRepId: repId, outcome: 'no_answer', createdAt: at(8), tenantId: tenantA },
    ],
  });

  preset = await mkOrder(tenantA, custA.id, 'confirmed', { confirmedAt: at(1) });
  await hist(preset, tenantA, 'confirmed', at(5), repId);

  otherTenantOrder = await mkOrder(tenantB, custB.id, 'delivered');
  await hist(otherTenantOrder, tenantB, 'out_for_delivery', at(6));
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.$disconnect();
});

describe('backfill-order-timestamps', () => {
  it('writes nothing by default (dry run)', async () => {
    const out = run('--tenant', tenantA);
    expect(out).toContain('dry run');
    expect(out).toMatch(/confirmedAt: applies 5, already set 1, would fill 1/);
    const r = await row(full);
    expect(r.confirmedAt).toBeNull();
    expect(r.dispatchedAt).toBeNull();
  });

  it('fills from the first matching history row and the earliest rep call', async () => {
    const out = run('--apply', '--tenant', tenantA);
    expect(out).toContain('MODE: apply');

    const f = await row(full);
    expect(f.confirmedAt).toEqual(at(9));
    expect(f.confirmedById).toBe(repId);
    expect(f.dispatchedAt).toEqual(at(11)); // out_for_delivery wins over delivered
    expect(f.returnedAt).toEqual(at(13));
    expect(f.firstContactAt).toBeNull(); // no call: never guessed

    const d = await row(deliveredOnly);
    expect(d.dispatchedAt).toEqual(at(15)); // delivered row used when there is no out_for_delivery row
    expect(d.confirmedAt).toBeNull();
    expect(d.returnedAt).toBeNull();

    const n = await row(noHistory);
    expect([n.confirmedAt, n.confirmedById, n.dispatchedAt, n.firstContactAt, n.returnedAt]).toEqual([null, null, null, null, null]);

    const c = await row(calls);
    expect(c.firstContactAt).toEqual(at(8));
  });

  it('never overwrites a value that is already set', async () => {
    const p = await row(preset);
    expect(p.confirmedAt).toEqual(at(1));
    expect(p.confirmedById).toBeNull();
  });

  it('does not change status_version', async () => {
    for (const id of [full, deliveredOnly, noHistory, calls, preset]) {
      expect((await row(id)).statusVersion).toBe(0);
    }
  });

  it('leaves another tenant alone when run with --tenant', async () => {
    const o = await row(otherTenantOrder);
    expect(o.dispatchedAt).toBeNull();
  });

  it('a second run fills 0 rows', async () => {
    const before = await prismaBase.order.findMany({ where: { tenantId: tenantA }, orderBy: { id: 'asc' } });
    const out = run('--apply', '--tenant', tenantA);
    expect(out).toMatch(/Total: .*\n(  \w+: applies \d+, already set \d+, filled 0, still empty \d+, filled in all 0\n?){4}/);
    const after = await prismaBase.order.findMany({ where: { tenantId: tenantA }, orderBy: { id: 'asc' } });
    expect(after).toEqual(before);
  });

  it('without --tenant, fills every tenant', async () => {
    run('--apply');
    expect((await row(otherTenantOrder)).dispatchedAt).toEqual(at(6));
  });

  it('refuses to run in production without --allow-production', () => {
    expect(() =>
      execFileSync(path.join(__dirname, '../../../node_modules/.bin/ts-node'), ['scripts/backfill-order-timestamps.ts', '--apply'], {
        cwd: path.join(__dirname, '../../..'), env: { ...process.env, NODE_ENV: 'production' }, stdio: 'pipe',
      }),
    ).toThrow();
  });
});
