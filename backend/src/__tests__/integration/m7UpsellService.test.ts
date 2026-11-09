/**
 * M7-T04 (COD-63, F-759): Upsell service rules.
 * - Server computes extra value from package/add-on price (client sends only ids; body value field ignored).
 * - Writes UpsellLine, raises order total, voids on cancel.
 * - Two concurrent edits: last save wins, response carries a warning flag.
 * - Archived package not offered; remaining tiers listed.
 * - Fixture: Adwoa GH₵6,100 extra -> GH₵610 reward on delivery.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { upsellService } from '../../services/upsellService';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import * as Money from '../../utils/money';

jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: { triggerStatusChangeWorkflows: () => Promise.resolve() },
  registerWorkflowListeners: jest.fn(),
}));

const SUFFIX = Date.now();
let tenantId: string;
let customerId: number;
let productId: number;
let formId: number;
let pkg1Id: number;
let pkg2Id: number;
let pkg3Id: number;
let archivedPkgId: number;
let addon1Id: number;
let addon2Id: number;
let adwoaId: number;
let adwoaToken: string;
let nanaId: number;
let nanaToken: string;
let agentId: number;
let adminId: number;

const tenantIds: string[] = [];

async function setupTenant(label: string) {
  tenantId = (await createTenant(label)).id;
  tenantIds.push(tenantId);
  await seedTenantDefaults(tenantId);

  const customer = await prismaBase.customer.create({
    data: {
      firstName: 'Akua',
      lastName: 'Mensah',
      phoneNumber: `+2332${String(SUFFIX).slice(-7)}2`,
      address: '22 High St',
      state: 'Greater Accra',
      area: 'Accra',
      tenantId,
    },
  });
  customerId = customer.id;

  const product = await prismaBase.product.create({
    data: {
      name: 'Magic Writing Set',
      sku: `MWS-${SUFFIX}`,
      category: 'Stationery',
      price: 249,
      cogs: 80,
      stockQuantity: 500,
      tenantId,
    },
  });
  productId = product.id;

  const form = await prismaBase.checkoutForm.create({
    data: {
      name: 'Magic Set Form',
      slug: `magic-set-${SUFFIX}`,
      productId,
      fields: {},
      styling: {},
      regions: {},
      tenantId,
    },
  });
  formId = form.id;

  // Package tiers: 1 set GH₵249, 2 sets GH₵449, 3 sets GH₵629
  // Archived tier: GH₵350
  const p1 = await prismaBase.formPackage.create({
    data: { formId, name: '1 Set', price: 249, quantity: 1, isDefault: true, sortOrder: 1 },
  });
  pkg1Id = p1.id;

  const p2 = await prismaBase.formPackage.create({
    data: { formId, name: '2 Sets', price: 449, quantity: 2, sortOrder: 2 },
  });
  pkg2Id = p2.id;

  const p3 = await prismaBase.formPackage.create({
    data: { formId, name: '3 Sets', price: 629, quantity: 3, sortOrder: 3 },
  });
  pkg3Id = p3.id;

  const archivedForm = await prismaBase.checkoutForm.create({
    data: {
      name: 'Archived Set Form',
      slug: `archived-set-${SUFFIX}`,
      productId,
      fields: {},
      styling: {},
      regions: {},
      archivedAt: new Date(),
      tenantId,
    },
  });
  const pArchived = await prismaBase.formPackage.create({
    data: { formId: archivedForm.id, name: 'Special Bundle', price: 350, quantity: 1, sortOrder: 4 },
  });
  archivedPkgId = pArchived.id;

  // Add-ons: Refill pens +GH₵40, Pencil grip trainer +GH₵35
  const a1 = await prismaBase.formUpsell.create({
    data: { formId, name: 'Refill Pens', price: 40, isActive: true, sortOrder: 1 },
  });
  addon1Id = a1.id;

  const a2 = await prismaBase.formUpsell.create({
    data: { formId, name: 'Pencil Grip Trainer', price: 35, isActive: true, sortOrder: 2 },
  });
  addon2Id = a2.id;

  const makeUser = async (name: string, role: string, extra: any = {}) => {
    const user = await prismaBase.user.create({
      data: {
        email: `${name}-${tenantIds.length}-${SUFFIX}@codadmin.test`,
        password: 'hash',
        firstName: name,
        lastName: 'Rep',
        role,
        tenantId,
        ...extra,
      } as any,
    });
    const { generateAccessToken } = await import('../../utils/jwt');
    const token = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId,
    });
    return { id: user.id, token };
  };

  const adwoa = await makeUser('adwoa', 'sales_rep', { kind: 'person', commissionAmount: 8 });
  adwoaId = adwoa.id;
  adwoaToken = adwoa.token;

  const nana = await makeUser('nana', 'sales_rep', { kind: 'person', commissionAmount: 8 });
  nanaId = nana.id;
  nanaToken = nana.token;

  const agent = await makeUser('delivery-agent', 'delivery_agent');
  agentId = agent.id;

  const admin = await makeUser('superadmin', 'super_admin');
  adminId = admin.id;
}

beforeAll(() => setupTenant('M7 Upsell Tenant'), 30000);

afterAll(async () => {
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('M7-T04: Upsell service rules', () => {
  it('archived package not offered; remaining active tiers and add-ons listed', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    await prismaBase.formSubmission.create({
      data: {
        formId,
        orderId: order.id,
        formData: {},
        selectedPackage: { id: pkg1Id, name: '1 Set', price: 249, quantity: 1 },
        totalAmount: 249,
        tenantId,
      },
    });

    const res = await request(app)
      .get(`/api/orders/${order.id}/upsell-options`)
      .set('Authorization', `Bearer ${adwoaToken}`);

    expect(res.status).toBe(200);
    const body = res.body;

    // Remaining tiers: pkg1, pkg2, pkg3 are offered; archivedPkgId is NOT offered
    const offeredPkgIds = body.availablePackages.map((p: any) => p.id);
    expect(offeredPkgIds).toContain(pkg1Id);
    expect(offeredPkgIds).toContain(pkg2Id);
    expect(offeredPkgIds).toContain(pkg3Id);
    expect(offeredPkgIds).not.toContain(archivedPkgId);

    // Active add-ons offered
    const offeredAddonIds = body.availableAddons.map((a: any) => a.id);
    expect(offeredAddonIds).toContain(addon1Id);
    expect(offeredAddonIds).toContain(addon2Id);
  });

  it('server computes extra value from package and add-on prices; client spoofed value is ignored', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    await prismaBase.formSubmission.create({
      data: {
        formId,
        orderId: order.id,
        formData: {},
        selectedPackage: { id: pkg1Id, name: '1 Set', price: 249, quantity: 1 },
        totalAmount: 249,
        tenantId,
      },
    });

    // Client sends pkg2 (price 449, diff = 200) + addon1 (price 40)
    // Server expected extra value = 240
    // Client attempts to spoof extraValue = 999999
    const res = await request(app)
      .post(`/api/orders/${order.id}/upsell`)
      .set('Authorization', `Bearer ${adwoaToken}`)
      .send({
        packageId: pkg2Id,
        addOnIds: [addon1Id],
        extraValue: 999999, // MUST BE IGNORED
        value: 888888,      // MUST BE IGNORED
      });

    expect(res.status).toBe(200);
    expect(Money.parse(res.body.extraValue).toFixed(4)).toBe('240.0000');
    expect(res.body.estimatedReward).toBe('24.00'); // 10% of 240

    // Order totals raised
    const updated = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(Money.parse(updated!.subtotal).toFixed(4)).toBe('489.0000'); // 249 + 240
    expect(Money.parse(updated!.totalAmount).toFixed(4)).toBe('489.0000');
    expect(Money.parse(updated!.codAmount!).toFixed(4)).toBe('489.0000');

    // Writes UpsellLine rows
    const lines = await prismaBase.upsellLine.findMany({
      where: { orderId: order.id, status: 'active' },
      orderBy: { kind: 'asc' },
    });
    expect(lines).toHaveLength(2);
    const addonLine = lines.find((l) => l.kind === 'addon');
    const pkgLine = lines.find((l) => l.kind === 'package');

    expect(addonLine).toBeDefined();
    expect(Money.parse(addonLine!.extraValue).toFixed(4)).toBe('40.0000');
    expect(addonLine!.repId).toBe(adwoaId);

    expect(pkgLine).toBeDefined();
    expect(Money.parse(pkgLine!.extraValue).toFixed(4)).toBe('200.0000');
    expect(pkgLine!.repId).toBe(adwoaId);
  });

  it('rejects an archived package when requested', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    const res = await request(app)
      .post(`/api/orders/${order.id}/upsell`)
      .set('Authorization', `Bearer ${adwoaToken}`)
      .send({
        packageId: archivedPkgId,
      });

    expect(res.status).toBe(400);
  });

  it('voids active UpsellLine records on order cancellation', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    await prismaBase.formSubmission.create({
      data: {
        formId,
        orderId: order.id,
        formData: {},
        selectedPackage: { id: pkg1Id, name: '1 Set', price: 249 },
        totalAmount: 249,
        tenantId,
      },
    });

    // Apply upsell
    await upsellService.applyUpsell({
      orderId: order.id,
      repId: adwoaId,
      packageId: pkg2Id,
      addOnIds: [addon1Id],
      tenantId,
    });

    const activeBefore = await prismaBase.upsellLine.findMany({
      where: { orderId: order.id, status: 'active' },
    });
    expect(activeBefore.length).toBeGreaterThan(0);

    // Cancel order
    await runInTenant(tenantId, () =>
      transitionOrder(order.id, 'cancelled', { kind: 'user', userId: adwoaId, role: 'sales_rep' }, { declineReason: 'changed_mind' })
    );

    // Upsell lines are now void
    const activeAfter = await prismaBase.upsellLine.findMany({
      where: { orderId: order.id, status: 'active' },
    });
    expect(activeAfter).toHaveLength(0);

    const voidLines = await prismaBase.upsellLine.findMany({
      where: { orderId: order.id, status: 'void' },
    });
    expect(voidLines.length).toBe(activeBefore.length);
  });

  it('two concurrent edits: last save wins, response carries a warning flag', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: null,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    await prismaBase.formSubmission.create({
      data: {
        formId,
        orderId: order.id,
        formData: {},
        selectedPackage: { id: pkg1Id, name: '1 Set', price: 249 },
        totalAmount: 249,
        tenantId,
      },
    });

    // Time T0: Both Adwoa and Nana opened the card
    const openedAt = new Date(Date.now() - 5000).toISOString();

    // Adwoa saves first at T1: package 2 (diff 200)
    const res1 = await request(app)
      .post(`/api/orders/${order.id}/upsell`)
      .set('Authorization', `Bearer ${adwoaToken}`)
      .send({
        packageId: pkg2Id,
        openedAt,
      });

    expect(res1.status).toBe(200);

    // Nana saves second at T2 on the same card with the earlier openedAt
    // Nana picks package 3 (diff 380) + addon 1 (40) -> total extra 420
    const res2 = await request(app)
      .post(`/api/orders/${order.id}/upsell`)
      .set('Authorization', `Bearer ${nanaToken}`)
      .send({
        packageId: pkg3Id,
        addOnIds: [addon1Id],
        openedAt,
      });

    expect(res2.status).toBe(200);
    // Last save wins! Response carries warningFlag
    expect(res2.body.warningFlag).toBe(true);
    expect(res2.body.warning).toBeDefined();
    expect(Money.parse(res2.body.extraValue).toFixed(4)).toBe('420.0000');

    // Final order reflects Nana's save (last save won)
    const activeLines = await prismaBase.upsellLine.findMany({
      where: { orderId: order.id, status: 'active' },
    });
    expect(activeLines).toHaveLength(2);
    expect(activeLines.every((l) => l.repId === nanaId)).toBe(true);

    const updated = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(Money.parse(updated!.totalAmount).toFixed(4)).toBe('669.0000'); // 249 + 420
  });

  it('call card confirmation with orderChanges applies upsell and creates pending upsell commission', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    await prismaBase.formSubmission.create({
      data: {
        formId,
        orderId: order.id,
        formData: {},
        selectedPackage: { id: pkg1Id, name: '1 Set', price: 249 },
        totalAmount: 249,
        tenantId,
      },
    });

    // Adwoa logs confirmed call with orderChanges: pkg2 (200 extra) + addon1 (40 extra) = 240 extra
    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${adwoaToken}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'confirmed',
        notes: 'Customer confirmed and upgraded to 2 sets with refill pens',
        orderChanges: {
          packageId: pkg2Id,
          addOnIds: [addon1Id],
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.call.outcome).toBe('confirmed');
    expect(res.body.upsell).toBeDefined();
    expect(Money.parse(res.body.upsell.extraValue).toFixed(4)).toBe('240.0000');

    // Commission entries created:
    // Base = 8 pending, Upsell = 24 pending (10% of 240)
    const baseEntry = await prismaBase.commissionEntry.findFirst({
      where: { orderId: order.id, kind: 'base' },
    });
    expect(baseEntry).not.toBeNull();
    expect(baseEntry!.status).toBe('pending');
    expect(Money.parse(baseEntry!.amount).toFixed(4)).toBe('8.0000');

    const upsellEntry = await prismaBase.commissionEntry.findFirst({
      where: { orderId: order.id, kind: 'upsell' },
    });
    expect(upsellEntry).not.toBeNull();
    expect(upsellEntry!.status).toBe('pending');
    expect(Money.parse(upsellEntry!.amount).toFixed(4)).toBe('24.0000');
  });

  it('fixture: Adwoa GH₵6,100 extra gives GH₵610 reward on delivery', async () => {
    // Setup a high-tier package with 6,100 extra value
    const bigPackage = await prismaBase.formPackage.create({
      data: {
        formId,
        name: 'Bulk School Pack',
        price: 6349, // 249 + 6100 extra
        quantity: 30,
        sortOrder: 10,
      },
    });

    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: adwoaId,
        deliveryAgentId: agentId,
        tenantId,
      } as any,
    });

    await prismaBase.formSubmission.create({
      data: {
        formId,
        orderId: order.id,
        formData: {},
        selectedPackage: { id: pkg1Id, name: '1 Set', price: 249 },
        totalAmount: 249,
        tenantId,
      },
    });

    // Adwoa confirms order with upsell to the big package (extra value = 6,100)
    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${adwoaToken}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'confirmed',
        notes: 'Bulk order confirmed by Adwoa',
        orderChanges: {
          packageId: bigPackage.id,
        },
      });

    expect(res.status).toBe(201);
    expect(Money.parse(res.body.upsell.extraValue).toFixed(4)).toBe('6100.0000');

    // Pending commission entry has amount 610 (10% of 6,100)
    const pendingUpsell = await prismaBase.commissionEntry.findFirst({
      where: { orderId: order.id, kind: 'upsell' },
    });
    expect(pendingUpsell).not.toBeNull();
    expect(pendingUpsell!.status).toBe('pending');
    expect(Money.parse(pendingUpsell!.amount).toFixed(2)).toBe('610.00');

    // Move order to delivered
    const adminActor: TransitionActor = { kind: 'user', userId: adminId, role: 'super_admin' };
    await runInTenant(tenantId, () =>
      transitionOrder(order.id, 'ready_for_pickup', adminActor)
    );
    await runInTenant(tenantId, () =>
      transitionOrder(order.id, 'out_for_delivery', adminActor, { deliveryAgentId: agentId })
    );
    await runInTenant(tenantId, () =>
      transitionOrder(order.id, 'delivered', adminActor, { deliveryAgentId: agentId })
    );

    // On delivery, the commission entries flip to earned and post to GL
    const earnedUpsell = await prismaBase.commissionEntry.findFirst({
      where: { orderId: order.id, kind: 'upsell' },
    });
    expect(earnedUpsell!.status).toBe('earned');
    expect(earnedUpsell!.earnedAt).not.toBeNull();
    expect(earnedUpsell!.journalEntryId).not.toBeNull();
    expect(Money.parse(earnedUpsell!.amount).toFixed(2)).toBe('610.00');

    // Base entry also earned: GH₵8
    const earnedBase = await prismaBase.commissionEntry.findFirst({
      where: { orderId: order.id, kind: 'base' },
    });
    expect(earnedBase!.status).toBe('earned');
    expect(earnedBase!.journalEntryId).not.toBeNull();
    expect(Money.parse(earnedBase!.amount).toFixed(2)).toBe('8.00');
  });

  it('F5: a sales_rep cannot upsell an order assigned to another rep (403)', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: adwoaId,
        tenantId,
      } as any,
    });

    const res = await request(app)
      .post(`/api/orders/${order.id}/upsell`)
      .set('Authorization', `Bearer ${nanaToken}`)
      .send({
        packageId: pkg2Id,
      });

    expect(res.status).toBe(403);
  });

  it('F5: only orders in pending_confirmation or confirmed may be upsold (409 otherwise)', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'delivered',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: adwoaId,
        tenantId,
      } as any,
    });

    const res = await request(app)
      .post(`/api/orders/${order.id}/upsell`)
      .set('Authorization', `Bearer ${adwoaToken}`)
      .send({
        packageId: pkg2Id,
      });

    expect(res.status).toBe(409);
  });

  it('F5: two sequential saves give the right total (no double-count)', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        customerRepId: adwoaId,
        tenantId,
      } as any,
    });

    await prismaBase.formSubmission.create({
      data: {
        formId,
        orderId: order.id,
        formData: {},
        selectedPackage: { id: pkg1Id, name: '1 Set', price: 249 },
        totalAmount: 249,
        tenantId,
      },
    });

    // Save 1: package 2 (price 449, extra 200)
    const res1 = await request(app)
      .post(`/api/orders/${order.id}/upsell`)
      .set('Authorization', `Bearer ${adwoaToken}`)
      .send({ packageId: pkg2Id });

    expect(res1.status).toBe(200);
    expect(Money.parse(res1.body.order.totalAmount).toFixed(4)).toBe('449.0000');
    expect(Money.parse(res1.body.extraValue).toFixed(4)).toBe('200.0000');

    // Save 2: package 3 (price 629, extra 380)
    const res2 = await request(app)
      .post(`/api/orders/${order.id}/upsell`)
      .set('Authorization', `Bearer ${adwoaToken}`)
      .send({ packageId: pkg3Id });

    expect(res2.status).toBe(200);
    expect(Money.parse(res2.body.order.totalAmount).toFixed(4)).toBe('629.0000');
    expect(Money.parse(res2.body.extraValue).toFixed(4)).toBe('380.0000');

    const inDb = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(Money.parse(inDb!.totalAmount).toFixed(4)).toBe('629.0000');
    expect(Money.parse(inDb!.subtotal).toFixed(4)).toBe('629.0000');

    // Active upsell lines should only be package 3
    const activeLines = await prismaBase.upsellLine.findMany({
      where: { orderId: order.id, status: 'active' },
    });
    expect(activeLines).toHaveLength(1);
    expect(activeLines[0].sourceId).toBe(pkg3Id);
    expect(Money.parse(activeLines[0].extraValue).toFixed(4)).toBe('380.0000');
  });
});
