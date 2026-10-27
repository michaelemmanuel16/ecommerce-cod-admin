/**
 * M5-T02 (COD-47): the settlement schema. Fee rules are unique per (partner, outcome, validFrom),
 * a settlement is unique per (partner, reference), and the new Finding values and nullable
 * fee fields are accepted.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;

beforeAll(async () => {
  pair = await createTwoTenants('m5schema');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('M5 settlement schema', () => {
  it('fee rule is unique on (partner, outcome, validFrom) and allows a later rule', async () => {
    const { a } = pair;
    const partner = a.users.deliveryAgent.id;
    const base = { tenantId: a.id, partnerUserId: partner, outcome: 'failed' as const, amount: '5' };
    await prismaBase.feeRule.create({ data: { ...base, validFrom: new Date('2026-10-01') } });
    await expect(prismaBase.feeRule.create({ data: { ...base, validFrom: new Date('2026-10-01') } })).rejects.toThrow();
    const later = await prismaBase.feeRule.create({ data: { ...base, basis: 'percent', amount: '10', validFrom: new Date('2026-11-01') } });
    expect(later.basis).toBe('percent');
  });

  it('settlement is unique on (tenant, partner, reference)', async () => {
    const { a } = pair;
    const data = {
      tenantId: a.id, partnerId: a.users.deliveryAgent.id, payoutDate: new Date('2026-10-21'), payoutAmount: '10',
      reference: 'dup-ref', status: 'short' as const,
    };
    await prismaBase.partnerSettlement.create({ data });
    await expect(prismaBase.partnerSettlement.create({ data })).rejects.toThrow();
  });

  it('order fee fields start null and a finding takes the M5 types and fields', async () => {
    const { a } = pair;
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: a.ids.order } });
    expect(order.deliveryFee).toBeNull();
    expect(order.deliveryFeeSource).toBeNull();
    const finding = await prismaBase.finding.create({
      data: {
        tenantId: a.id, type: 'fee_rule_missing', subjectType: 'partner', subjectId: String(a.users.deliveryAgent.id),
        assigneeId: a.users.admin.id,
      },
    });
    const closed = await prismaBase.finding.update({
      where: { id: finding.id },
      data: { status: 'written_off', resolvedAt: new Date(), resolvedById: a.users.admin.id, explanation: 'test' },
    });
    expect(closed.status).toBe('written_off');
    expect(closed.explanation).toBe('test');
  });

  it('an expense defaults to source manual and takes paidFrom and a journal entry link', async () => {
    const { a } = pair;
    const expense = await prismaBase.expense.create({
      data: { tenantId: a.id, category: 'Other', amount: '10', description: 'm5 test', expenseDate: new Date('2026-10-01'), paidFrom: 'momo' },
    });
    expect(expense.source).toBe('manual');
    expect(expense.paidFrom).toBe('momo');
    const linked = await prismaBase.expense.update({ where: { id: expense.id }, data: { journalEntryId: a.ids.journalEntry } });
    expect(linked.journalEntryId).toBe(a.ids.journalEntry);
    await prismaBase.expense.delete({ where: { id: expense.id } });
  });

  it('system config keeps period notes', async () => {
    const { a } = pair;
    const notes = { '2026-08': 'Booked with the older cost per set.' };
    const config = await prismaBase.systemConfig.upsert({
      where: { tenantId: a.id }, create: { tenantId: a.id, periodNotes: notes }, update: { periodNotes: notes },
    });
    expect(config.periodNotes).toEqual(notes);
  });
});
