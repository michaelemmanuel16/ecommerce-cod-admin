/**
 * M1-T28: the order-versus-ledger check on the numbers fixture. The fixture has no gap, so the first run opens
 * 0 Findings. Editing one 4010 amount opens exactly one `ledger_gap` Finding for that day; a second run does not
 * add another (it updates the amount). The health endpoint data shows the run time and the open gap.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { checkLedgerForTenant, getLedgerHealth } from '../../services/ledgerCheckService';
import { runInTenant } from '../../utils/tenantContext';

jest.setTimeout(180_000);

// The fixture's last day is 17 October 2026; the 45-day window from the 18th reaches back to 4 September.
const NOW = new Date('2026-10-18T10:00:00Z');

let tenantId: string;

const findings = () => prismaBase.finding.findMany({ where: { tenantId, type: 'ledger_gap' } });

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

describe('order-versus-ledger check (M1-T28)', () => {
  it('opens no Finding on the fixture and records the run', async () => {
    const result = await checkLedgerForTenant(tenantId, NOW);
    expect(result.gapDays).toEqual([]);
    expect(result.days).toBeGreaterThan(0);
    expect(await findings()).toHaveLength(0);
    const health = await runInTenant(tenantId, () => getLedgerHealth());
    expect(health.openGaps).toEqual([]);
    expect(health.lastRunAt).not.toBeNull();
  });

  it('opens exactly one Finding when one 4010 amount is edited, and not a second on the next run', async () => {
    const [row] = await prismaBase.$queryRawUnsafe<Array<{ id: number; day: string; credit: string }>>(
      `SELECT t.id, TO_CHAR(j.entry_date, 'YYYY-MM-DD') AS day, t.credit_amount::text AS credit
       FROM account_transactions t JOIN journal_entries j ON j.id = t.journal_entry_id JOIN accounts a ON a.id = t.account_id
       WHERE t.tenant_id = $1 AND a.code = '4010' AND t.credit_amount > 0 AND j.entry_date >= '2026-10-05' AND j.entry_date < '2026-10-06'
       ORDER BY t.id LIMIT 1`, tenantId);
    // entry_date is UTC; the store zone (Accra) is UTC+0, so the UTC day is the store day.
    await prismaBase.$executeRawUnsafe(`UPDATE account_transactions SET credit_amount = credit_amount - 5 WHERE id = $1`, row.id);

    const first = await checkLedgerForTenant(tenantId, NOW);
    expect(first.gapDays).toEqual([row.day]);
    const afterFirst = await findings();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({ subjectType: 'day', subjectId: row.day, status: 'open' });
    expect(afterFirst[0].amount?.toString()).toBe('5');

    // Edit again: the second run updates the same Finding.
    await prismaBase.$executeRawUnsafe(`UPDATE account_transactions SET credit_amount = credit_amount - 2 WHERE id = $1`, row.id);
    await checkLedgerForTenant(tenantId, NOW);
    const afterSecond = await findings();
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].id).toBe(afterFirst[0].id);
    expect(afterSecond[0].amount?.toString()).toBe('7');

    const health = await runInTenant(tenantId, () => getLedgerHealth());
    expect(health.openGaps).toEqual([{ day: row.day, amount: '7.00' }]);
  });
});
