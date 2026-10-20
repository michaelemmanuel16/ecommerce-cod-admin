/**
 * M1-T34: the KPI contract ("Done when" 1 to 4 and 8 of docs/plan/M1.md), on the numbers fixture, 1 to 17 October 2026.
 * Seeds once, then calls the fixtureChecks modules (they hold the assertions; none is repeated here):
 *   1. endpoints + MCP tools: delivered revenue 92000.00 and 376 delivered orders
 *   2. rates (71 / 48 / 34), orders needed a day 56, AOV 245, projected month 167.8k, needed a day 6.3k
 *   3. rep rates (52 / 44 / 30 / 48), and a payout does not change them
 *   4. product delivered units
 *   8. the order-versus-ledger check opens no `ledger_gap` Finding
 * numbersFixture.test.ts keeps its own SQL checks, the history and partner checks, and the seed-hash checks.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { rates } from '../../services/kpi/rates';
import { repRates } from '../../services/kpi/reps';
import { endOfDay, getStoreTimeZone, startOfDay } from '../../services/kpi/dates';
import { checkLedgerForTenant } from '../../services/ledgerCheckService';
import { endpointsFixtureChecks } from './fixtureChecks/endpoints';
import { mcpFixtureChecks } from './fixtureChecks/mcp';
import { leadershipFixtureChecks } from './fixtureChecks/leadership';
import { productsFixtureChecks } from './fixtureChecks/products';
import { repsFixtureChecks } from './fixtureChecks/reps';

jest.setTimeout(180_000);

// The fixture's last day is 17 October 2026; the 45-day ledger window from the 18th reaches back to 4 September.
const LEDGER_NOW = new Date('2026-10-18T10:00:00Z');

let tenantId: string;

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  await prismaBase.finding.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  await prismaBase.finding.deleteMany({ where: { tenantId } });
  await prismaBase.auditLog.deleteMany({ where: { tenantId } });
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

// Done when 1 (endpoints and MCP tools), 2 (orders needed, AOV, projection), 4 (product units).
endpointsFixtureChecks(() => tenantId);
mcpFixtureChecks(() => tenantId);
leadershipFixtureChecks(() => tenantId);
productsFixtureChecks(() => tenantId);

// Done when 2: the three named rates.
describe('KPI rates on the fixture (Done when 2)', () => {
  it('confirmation 71% (1,026 / 1,445), delivery success 48% (376 / 778), yield about 34%', async () => {
    const r = await rates(tenantId, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-18T00:00:00Z'));
    expect(r.confirmationRate.detail).toEqual({ confirmed: 1026, placed: 1445 });
    expect(Math.round(r.confirmationRate.value as number)).toBe(71);
    expect(r.deliverySuccessRate.detail).toMatchObject({ delivered: 376, closed: 778 });
    expect(Math.round(r.deliverySuccessRate.value as number)).toBe(48);
    expect(r.orderToCashYield.value).toBeGreaterThanOrEqual(33);
    expect(r.orderToCashYield.value).toBeLessThanOrEqual(35);
  });
});

// Done when 3: rep rates.
repsFixtureChecks(() => tenantId);

describe('a payout does not change the rep rates (Done when 3)', () => {
  it('marking every delivered order commission-paid leaves every rep rate as it was', async () => {
    const zone = getStoreTimeZone();
    const from = startOfDay('2026-10-01', zone);
    const to = endOfDay('2026-10-17', zone);
    const before = await repRates(tenantId, from, to);
    const reps = await prismaBase.user.findMany({ where: { tenantId, role: 'sales_rep' }, select: { id: true } });
    const snapshot = (r: Awaited<ReturnType<typeof repRates>>) => ({
      all: [r.all.confirmationRate.value, r.all.deliveredFromConfirmedRate.value],
      reps: reps.map((u) => [u.id, r.rep(u.id).confirmationRate.value, r.rep(u.id).deliveredFromConfirmedRate.value]),
    });

    await prismaBase.order.updateMany({ where: { tenantId, status: 'delivered' }, data: { commissionPaid: true } });
    const after = await repRates(tenantId, from, to);
    expect(snapshot(after)).toEqual(snapshot(before));
    expect(after.all.deliveredFromConfirmedRate.detail).toMatchObject({ delivered: 376, closed: 778 });
  });
});

// Done when 8: the nightly order-versus-ledger job.
describe('order-versus-ledger check on the fixture (Done when 8)', () => {
  it('creates no ledger_gap Finding for the fixture days', async () => {
    const result = await checkLedgerForTenant(tenantId, LEDGER_NOW);
    expect(result.gapDays).toEqual([]);
    expect(result.days).toBeGreaterThan(0);
    expect(await prismaBase.finding.count({ where: { tenantId, type: 'ledger_gap' } })).toBe(0);
  });
});
