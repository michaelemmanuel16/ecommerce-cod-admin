/**
 * M7-T02 (COD-63, F-769, F-914, F-1164): commission entries creation, lifecycle, and backfill.
 * - Base entry GH₵8 and upsell entry (10% of extra value) pending on confirm by rep call (P6).
 * - Delivery flips entries to earned once (idempotent).
 * - Auto-confirmed (customer YES), self-service, no-rep, and AI-agent orders create none.
 * - Reassigned order still pays the confirming rep.
 * - Return voids open entries and reverses GL postings.
 * - Backfill fixture: Adwoa 253 delivered orders -> 2,024 base + 610 upsell; Nana 13 orders -> 104 base + 30 upsell.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import {
  BASE_COMMISSION_AMOUNT,
  createCommissionEntriesOnConfirm,
  earnEntriesForOrder,
  postEntry,
} from '../../services/commissionService';
import {
  applyCommissionBackfill,
  commissionLedgerCheck,
  planCommissionBackfill,
} from '../../services/commissionBackfillService';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { accountBalance } from './helpers/ledgerPost';
import * as Money from '../../utils/money';

jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: { triggerStatusChangeWorkflows: () => Promise.resolve() },
}));

const SUFFIX = Date.now();
const ADMIN: TransitionActor = { kind: 'user', userId: undefined, role: 'super_admin' };
let tenantId: string;
let customerId: number;
let agentId: number;
let adwoaId: number;
let nanaId: number;
let aiRepId: number;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const move = (id: number, to: any, options: any = {}) => inTenant(() => transitionOrder(id, to, ADMIN, options));
const balance = (code: string) => accountBalance(tenantId, code);

const tenantIds: string[] = [];

async function setupTenant(label: string) {
  tenantId = (await createTenant(label)).id;
  tenantIds.push(tenantId);
  await seedTenantDefaults(tenantId);

  customerId = (await prismaBase.customer.create({
    data: {
      firstName: 'Kofi',
      lastName: 'Annan',
      phoneNumber: `+2332${String(SUFFIX).slice(-7)}${tenantIds.length}`,
      address: '10 High St',
      state: 'Greater Accra',
      area: 'Accra',
      tenantId,
    },
  })).id;

  const user = async (name: string, role: string, extra: Record<string, unknown> = {}) =>
    (await prismaBase.user.create({
      data: {
        email: `${name}-${tenantIds.length}-${SUFFIX}@codadmin.test`,
        password: 'hash',
        firstName: name,
        lastName: 'Rep',
        role,
        tenantId,
        ...extra,
      } as any,
    })).id;

  agentId = await user('kofi-agent', 'delivery_agent');
  adwoaId = await user('adwoa-rep', 'sales_rep', { kind: 'person' });
  nanaId = await user('nana-rep', 'sales_rep', { kind: 'person' });
  aiRepId = await user('ai-bot', 'sales_rep', { kind: 'ai_agent' });
  ADMIN.userId = await user('superadmin', 'super_admin');
}

beforeAll(() => setupTenant('M7 Commission Entries'), 30000);

afterAll(async () => {
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('M7-T02: Commission entry creation and delivery lifecycle', () => {
  it('creates base GH₵8 and upsell 10% entries pending on rep confirmation; earned on delivery', async () => {
    // Create an order in pending_confirmation
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 300,
        totalAmount: 300,
        codAmount: 300,
        customerRepId: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    // Add an active upsell line of extra value GH₵200
    await prismaBase.upsellLine.create({
      data: {
        orderId: order.id,
        repId: adwoaId,
        kind: 'package',
        extraValue: 200,
        status: 'active',
        tenantId,
      },
    });

    // Rep confirms order
    const repActor: TransitionActor = { kind: 'user', userId: adwoaId, role: 'sales_rep' };
    await inTenant(() => transitionOrder(order.id, 'confirmed', repActor));

    // Verify pending entries: base GH₵8, upsell GH₵20 (10% of 200)
    const entries = await prismaBase.commissionEntry.findMany({
      where: { orderId: order.id, status: { not: 'void' } },
      orderBy: { kind: 'asc' },
    });
    expect(entries).toHaveLength(2);

    const base = entries.find((e) => e.kind === 'base')!;
    const upsell = entries.find((e) => e.kind === 'upsell')!;
    expect(base.status).toBe('pending');
    expect(Number(base.amount)).toBe(8);
    expect(base.userId).toBe(adwoaId);

    expect(upsell.status).toBe('pending');
    expect(Number(upsell.amount)).toBe(20);
    expect(upsell.userId).toBe(adwoaId);

    // Delivery flips entries to earned and posts to GL
    const beforePay = await balance('2020');
    const beforeExp = await balance('5050');

    await move(order.id, 'ready_for_pickup');
    await move(order.id, 'out_for_delivery');
    await move(order.id, 'delivered');

    const earned = await prismaBase.commissionEntry.findMany({
      where: { orderId: order.id },
      orderBy: { kind: 'asc' },
    });
    expect(earned).toHaveLength(2);
    expect(earned[0].status).toBe('earned');
    expect(earned[1].status).toBe('earned');
    expect(earned[0].journalEntryId).not.toBeNull();
    expect(earned[1].journalEntryId).not.toBeNull();

    // 8 + 20 = 28 added to 2020 and 5050
    expect(await balance('2020')).toBe(beforePay + 28);
    expect(await balance('5050')).toBe(beforeExp + 28);
  });

  it('delivery is idempotent: re-delivery event does nothing', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'confirmed',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: adwoaId,
        confirmedById: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    await inTenant(() =>
      prisma.$transaction((tx) => createCommissionEntriesOnConfirm(tx, order.id, adwoaId))
    );

    const beforePay = await balance('2020');
    await move(order.id, 'ready_for_pickup');
    await move(order.id, 'out_for_delivery');
    await move(order.id, 'delivered');

    expect(await balance('2020')).toBe(beforePay + 8);

    // Call earnEntriesForOrder directly again (simulate repeat delivery event)
    const res = await inTenant(() =>
      prisma.$transaction((tx) => earnEntriesForOrder(tx, order.id, ADMIN.userId!))
    );
    expect(res.earned).toBe(0);
    expect(res.posted).toBe(0);
    expect(await balance('2020')).toBe(beforePay + 8);
  });

  it('reassigned order still pays confirming rep (rule P6)', async () => {
    // Rep Adwoa confirms order
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    const repActor: TransitionActor = { kind: 'user', userId: adwoaId, role: 'sales_rep' };
    await inTenant(() => transitionOrder(order.id, 'confirmed', repActor));

    // Order is reassigned to Nana
    await prismaBase.order.update({
      where: { id: order.id },
      data: { customerRepId: nanaId },
    });

    // Deliver order
    await move(order.id, 'ready_for_pickup');
    await move(order.id, 'out_for_delivery');
    await move(order.id, 'delivered');

    const entry = await prismaBase.commissionEntry.findFirst({
      where: { orderId: order.id, kind: 'base' },
    });
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe('earned');
    expect(entry!.userId).toBe(adwoaId); // Still pays Adwoa, not Nana!
  });

  it('auto-confirmed, self-service and AI-agent orders create no commission entries', async () => {
    // 1. Auto-confirmed (customer YES): system transition
    const autoOrder = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerResponse: 'yes',
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });
    const systemActor: TransitionActor = { kind: 'system' };
    await inTenant(() => transitionOrder(autoOrder.id, 'confirmed', systemActor));
    await move(autoOrder.id, 'ready_for_pickup');
    await move(autoOrder.id, 'out_for_delivery');
    await move(autoOrder.id, 'delivered');

    const autoEntries = await prismaBase.commissionEntry.findMany({ where: { orderId: autoOrder.id } });
    expect(autoEntries).toHaveLength(0);

    // 2. AI agent confirming: no entries
    const aiOrder = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: aiRepId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });
    const aiActor: TransitionActor = { kind: 'user', userId: aiRepId, role: 'sales_rep' };
    await inTenant(() => transitionOrder(aiOrder.id, 'confirmed', aiActor));
    await move(aiOrder.id, 'ready_for_pickup');
    await move(aiOrder.id, 'out_for_delivery');
    await move(aiOrder.id, 'delivered');

    const aiEntries = await prismaBase.commissionEntry.findMany({ where: { orderId: aiOrder.id } });
    expect(aiEntries).toHaveLength(0);
  });

  it('return voids open entries and reverses GL posting (M5 posting path)', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    const repActor: TransitionActor = { kind: 'user', userId: adwoaId, role: 'sales_rep' };
    await inTenant(() => transitionOrder(order.id, 'confirmed', repActor));

    const beforePay = await balance('2020');
    await move(order.id, 'ready_for_pickup');
    await move(order.id, 'out_for_delivery');
    await move(order.id, 'delivered');

    expect(await balance('2020')).toBe(beforePay + 8);

    // Now return order
    await move(order.id, 'returned');

    const voided = await prismaBase.commissionEntry.findFirst({
      where: { orderId: order.id, kind: 'base' },
    });
    expect(voided!.status).toBe('void');
    // Balance 2020 reversed back to beforePay
    expect(await balance('2020')).toBe(beforePay);
  });

  it('backfill fixture: Adwoa 253 delivered orders -> base 2,024, upsell extra 6,100 -> 610; Nana 13 orders -> 104, extra 300 -> 30', async () => {
    // Create a dedicated tenant for the fixture
    const fixtureTenant = (await createTenant('M7 Backfill Fixture')).id;
    tenantIds.push(fixtureTenant);
    await seedTenantDefaults(fixtureTenant);

    const fCustomer = (await prismaBase.customer.create({
      data: {
        firstName: 'Ama',
        lastName: 'Osei',
        phoneNumber: `+2332${String(Date.now()).slice(-7)}9`,
        address: '5 Road',
        state: 'Ashanti',
        area: 'Kumasi',
        tenantId: fixtureTenant,
      },
    })).id;

    const fAdwoa = (await prismaBase.user.create({
      data: {
        email: `adwoa-fix-${Date.now()}@test.local`,
        password: 'h',
        firstName: 'Adwoa',
        lastName: 'Darko',
        role: 'sales_rep',
        kind: 'person',
        commissionAmount: 8,
        tenantId: fixtureTenant,
      },
    })).id;

    const fNana = (await prismaBase.user.create({
      data: {
        email: `nana-fix-${Date.now()}@test.local`,
        password: 'h',
        firstName: 'Nana',
        lastName: 'Osei',
        role: 'sales_rep',
        kind: 'person',
        commissionAmount: 8,
        tenantId: fixtureTenant,
      },
    })).id;

    // Create 253 delivered orders for Adwoa
    const adwoaOrdersData = Array.from({ length: 253 }, (_, i) => ({
      customerId: fCustomer,
      status: 'delivered' as const,
      subtotal: 100,
      totalAmount: 100,
      codAmount: 100,
      customerRepId: fAdwoa,
      confirmedById: fAdwoa,
      tenantId: fixtureTenant,
      deliveryDate: new Date('2026-10-15T12:00:00Z'),
    }));
    await prismaBase.order.createMany({ data: adwoaOrdersData as any });

    const adwoaOrders = await prismaBase.order.findMany({
      where: { tenantId: fixtureTenant, customerRepId: fAdwoa },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(adwoaOrders).toHaveLength(253);

    // Upsell lines on Adwoa's orders totaling GH₵6,100 extra value
    await prismaBase.upsellLine.create({
      data: {
        orderId: adwoaOrders[0].id,
        repId: fAdwoa,
        kind: 'package',
        extraValue: 6100,
        status: 'active',
        tenantId: fixtureTenant,
      },
    });

    // Create 13 delivered orders for Nana
    const nanaOrdersData = Array.from({ length: 13 }, (_, i) => ({
      customerId: fCustomer,
      status: 'delivered' as const,
      subtotal: 100,
      totalAmount: 100,
      codAmount: 100,
      customerRepId: fNana,
      confirmedById: fNana,
      tenantId: fixtureTenant,
      deliveryDate: new Date('2026-10-15T12:00:00Z'),
    }));
    await prismaBase.order.createMany({ data: nanaOrdersData as any });

    const nanaOrders = await prismaBase.order.findMany({
      where: { tenantId: fixtureTenant, customerRepId: fNana },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(nanaOrders).toHaveLength(13);

    // Upsell lines on Nana's orders totaling GH₵300 extra value
    await prismaBase.upsellLine.create({
      data: {
        orderId: nanaOrders[0].id,
        repId: fNana,
        kind: 'addon',
        extraValue: 300,
        status: 'active',
        tenantId: fixtureTenant,
      },
    });

    // Plan dry run
    const plan = await planCommissionBackfill(fixtureTenant);
    expect(plan.baseCount).toBe(266); // 253 Adwoa + 13 Nana
    expect(plan.upsellCount).toBe(2); // 1 Adwoa + 1 Nana
    expect(plan.rows).toHaveLength(268);

    // Adwoa: 253 * 8 = 2024 base; 10% of 6100 = 610 upsell
    const adwoaBaseRows = plan.rows.filter((r) => r.repId === fAdwoa && (r.kind ?? 'base') === 'base');
    const adwoaUpsellRows = plan.rows.filter((r) => r.repId === fAdwoa && r.kind === 'upsell');
    expect(adwoaBaseRows).toHaveLength(253);
    expect(Money.sum(adwoaBaseRows.map((r) => r.amount)).toString()).toBe('2024');
    expect(adwoaUpsellRows).toHaveLength(1);
    expect(Money.sum(adwoaUpsellRows.map((r) => r.amount)).toString()).toBe('610');

    // Nana: 13 * 8 = 104 base; 10% of 300 = 30 upsell
    const nanaBaseRows = plan.rows.filter((r) => r.repId === fNana && (r.kind ?? 'base') === 'base');
    const nanaUpsellRows = plan.rows.filter((r) => r.repId === fNana && r.kind === 'upsell');
    expect(nanaBaseRows).toHaveLength(13);
    expect(Money.sum(nanaBaseRows.map((r) => r.amount)).toString()).toBe('104');
    expect(nanaUpsellRows).toHaveLength(1);
    expect(Money.sum(nanaUpsellRows.map((r) => r.amount)).toString()).toBe('30');

    // Total backfill amount = 2024 + 610 + 104 + 30 = 2768
    expect(plan.total.toString()).toBe('2768');

    // Apply backfill
    const result = await applyCommissionBackfill(fixtureTenant, plan);
    expect(result.written).toBe(268);
    expect(result.total.toString()).toBe('2768');

    // Check ledger matches open entries
    const ledger = await commissionLedgerCheck(fixtureTenant);
    expect(ledger.openEntries.toString()).toBe('2768');
    expect(ledger.payableBalance.toString()).toBe('2768');
    expect(ledger.difference.toString()).toBe('0');
  });
});
