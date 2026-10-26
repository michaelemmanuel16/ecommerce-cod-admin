/**
 * M4-T35 (COD-46 part 1): migration and two-tenant gaps. Held already: the per-model sweep (twoTenantModels), and the
 * "another tenant" cases of each route (inventoryReadApi, transfersApi, stockCountsApi, shipmentsApi, productsApi,
 * deliveryPartnersTwoTenant), the stock migration on small numbers (stockMigration).
 * Here: (1) the migration at the size of the fixture's 148 out-for-delivery orders, with the 3PL level untouched and a
 * second tenant left alone; (2) one tenant's whole round of M4 writes leaves the other tenant's rows byte for byte the same;
 * (3) read routes asked about the other tenant's ids through filters. PartnerCoverage does not exist (decision O4).
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, actorOf } from '../../services/orderStateMachine';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { makeCustomer } from './helpers/kpiOrders';
import { bearer } from './helpers/superAdminToken';
import { stockUp } from './helpers/stock';
import { migrateTenant } from '../../../scripts/migrate-stock-to-levels';

jest.setTimeout(240_000);

const SUFFIX = Date.now();
const db = prismaBase;
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

describe('stock migration at the size of the fixture (148 orders out for delivery)', () => {
  let tenantId: string;
  let otherId: string;
  let copybook: number;
  let pens: number;
  let logiswiftUser: number;
  const agents: number[] = [];
  let expectedCopybook = 0;
  let expectedPens = 0;
  let expectedByAgent = new Map<number, number>();

  beforeAll(async () => {
    tenantId = (await createTenant('M4 Mig148')).id;
    otherId = (await createTenant('M4 Mig148 Other')).id;
    const mk = (first: string, role: 'admin' | 'delivery_agent') => mkUser(tenantId, first, role);
    const [, lw] = await Promise.all([mk('Boss', 'admin'), mk('Logiswift', 'delivery_agent')]);
    logiswiftUser = lw.id;
    for (const n of ['Kofi', 'Esi', 'Kwesi']) agents.push((await mk(n, 'delivery_agent')).id);
    copybook = (await db.product.create({ data: { name: 'Copybook', sku: `M148-CB-${SUFFIX}`, category: 't', price: 50, stockQuantity: 100, tenantId } })).id;
    pens = (await db.product.create({ data: { name: 'Pens', sku: `M148-PN-${SUFFIX}`, category: 't', price: 10, stockQuantity: 62, tenantId } })).id;
    const customer = await makeCustomer(tenantId);
    const base = { customerId: customer.id, subtotal: '10', totalAmount: '10', codAmount: '10', deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', status: 'out_for_delivery', tenantId };
    for (let i = 0; i < 148; i++) {
      const agent = agents[i % 3];
      const cb = (i % 3) + 1;
      const withPens = i % 4 === 0;
      await db.order.create({ data: {
        ...base, deliveryAgentId: agent,
        orderItems: { create: [
          { productId: copybook, quantity: cb, unitPrice: '1', totalPrice: '1', itemType: 'product' },
          ...(withPens ? [{ productId: pens, quantity: 1, unitPrice: '1', totalPrice: '1', itemType: 'product' }] : []),
        ] },
      } as any });
      expectedCopybook += cb;
      if (withPens) expectedPens += 1;
      expectedByAgent.set(agent, (expectedByAgent.get(agent) ?? 0) + cb);
    }
    // A second tenant with legacy stock of its own: the run for the first must not touch it
    await db.product.create({ data: { name: 'Other', sku: `M148-OT-${SUFFIX}`, category: 't', price: 5, stockQuantity: 40, tenantId: otherId } });
  }, 180_000);

  afterAll(async () => {
    await deleteTenantRows([tenantId, otherId]);
  });

  it('a dry run prints equal sums for 148 corrections and writes nothing', async () => {
    const report = await migrateTenant(tenantId, { dryRun: true, defaultLocation: 'Logiswift' });
    expect(report.ok).toBe(true);
    expect(report.ordersA).toBe(148);
    expect(report.rows.find((r) => r.productId === copybook)).toMatchObject({ warehouse: 100, correctionA: expectedCopybook, before: 100 + expectedCopybook, after: 100 + expectedCopybook, difference: 0 });
    expect(await db.stockLevel.count({ where: { tenantId } })).toBe(0);
    expect(await db.inventoryTransfer.count({ where: { tenantId } })).toBe(0);
  });

  it('the run writes one correction per order and product, sums stay equal, the Logiswift copybook level stays 100', async () => {
    const report = await migrateTenant(tenantId, { dryRun: false, defaultLocation: 'Logiswift' });
    expect(report.ok).toBe(true);
    expect(report.ordersA).toBe(148);
    const corrections = await db.inventoryTransfer.findMany({ where: { tenantId, transferType: 'adjustment' } });
    expect(corrections).toHaveLength(148 + Math.ceil(148 / 4)); // 148 copybook lines + 37 pens lines
    expect(new Set(corrections.map((c) => c.orderId)).size).toBe(148);
    expect(corrections.every((c) => c.notes === 'Migration: stock moved from out-for-delivery to delivery' && c.status === 'received')).toBe(true);
    const units = (productId: number) => corrections.filter((c) => c.productId === productId).reduce((s, c) => s + c.quantity, 0);
    expect([units(copybook), units(pens)]).toEqual([expectedCopybook, expectedPens]);

    const level = async (productId: number, name?: string) => (await db.stockLevel.aggregate({ _sum: { quantity: true }, where: { tenantId, productId, ...(name ? { location: { name } } : {}) } }))._sum.quantity;
    expect(await level(copybook)).toBe(100 + expectedCopybook);
    expect(await level(pens)).toBe(62 + expectedPens);
    expect(await level(copybook, 'Logiswift')).toBe(100); // the migration does not move the 3PL level
    for (const agent of agents) {
      const location = await db.stockLocation.findFirstOrThrow({ where: { tenantId, userId: agent } });
      expect([agent, (await db.stockLevel.findUnique({ where: { locationId_productId: { locationId: location.id, productId: copybook } } }))?.quantity]).toEqual([agent, expectedByAgent.get(agent)]);
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: copybook } })).stockQuantity).toBe(100 + expectedCopybook);
    expect((await db.stockLocation.findFirstOrThrow({ where: { tenantId, name: 'Logiswift' } })).userId).toBe(logiswiftUser);
  });

  it('the other tenant has no location, level or movement after the run, and its product cache is the number it had', async () => {
    expect(await db.stockLocation.count({ where: { tenantId: otherId } })).toBe(0);
    expect(await db.stockLevel.count({ where: { tenantId: otherId } })).toBe(0);
    expect(await db.inventoryTransfer.count({ where: { tenantId: otherId } })).toBe(0);
    expect((await db.product.findFirstOrThrow({ where: { tenantId: otherId } })).stockQuantity).toBe(40);
  });

  it('a second run changes no level and adds no correction', async () => {
    const before = await db.inventoryTransfer.count({ where: { tenantId } });
    const sumBefore = (await db.stockLevel.aggregate({ _sum: { quantity: true }, where: { tenantId } }))._sum.quantity;
    expect((await migrateTenant(tenantId, { dryRun: false, defaultLocation: 'Logiswift' })).alreadyMigrated).toBe(true);
    expect(await db.inventoryTransfer.count({ where: { tenantId } })).toBe(before);
    expect((await db.stockLevel.aggregate({ _sum: { quantity: true }, where: { tenantId } }))._sum.quantity).toBe(sumBefore);
  });
});

describe('one tenant writes across every M4 route; the other tenant does not change', () => {
  let a: string;
  let b: string;
  const A: Record<string, any> = {};
  const B: Record<string, any> = {};

  const setup = async (tenantId: string, into: Record<string, any>, label: string) => {
    await seedTenantDefaults(tenantId);
    into.owner = await mkUser(tenantId, 'owner', 'super_admin');
    into.admin = await mkUser(tenantId, 'admin', 'admin');
    const swiftUser = await db.user.create({ data: { email: `m4tt-swift-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: `Swift${label}`, lastName: 'T', role: 'delivery_agent', kind: 'company', tenantId } });
    const agentUser = await db.user.create({ data: { email: `m4tt-agent-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: `Agent${label}`, lastName: 'T', role: 'delivery_agent', tenantId } });
    into.agentUser = agentUser.id;
    into.product = (await db.product.create({ data: { sku: `M4TT-${label}-${SUFFIX}`, name: `Copybook ${label}`, category: 'x', price: 50, cogs: 30, stockQuantity: 0, tenantId } })).id;
    into.swift = (await db.stockLocation.create({ data: { tenantId, name: `Swift ${label} ${SUFFIX}`, type: 'partner_3pl', userId: swiftUser.id } })).id;
    into.agent = (await db.stockLocation.create({ data: { tenantId, name: `Agent ${label} ${SUFFIX}`, type: 'agent', userId: agentUser.id } })).id;
    into.transit = (await db.stockLocation.create({ data: { tenantId, name: `In transit ${label}`, type: 'in_transit' } })).id;
    await stockUp(tenantId, into.product, 200, { locationId: into.swift });
    into.customer = (await makeCustomer(tenantId)).id;
  };
  const call = (who: { token: string }, method: 'get' | 'post' | 'patch', path: string, body?: Record<string, unknown>) =>
    request(app)[method](path).set(bearer(who.token)).send(body);

  /** Tenant A's M4 rows and the product cache, read raw. */
  const snapshot = async (tenantId: string) => JSON.stringify({
    locations: await db.stockLocation.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    levels: await db.stockLevel.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    counts: await db.stockCount.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    countLines: await db.stockCountLine.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    profiles: await db.deliveryPartnerProfile.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    attempts: await db.deliveryAttempt.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    transfers: await db.inventoryTransfer.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    shipments: await db.inventoryShipment.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    findings: await db.finding.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    entries: await db.journalEntry.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    products: await db.product.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    orders: await db.order.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
  });

  beforeAll(async () => {
    a = (await createTenant('M4 TT A', { currency: 'GHS' })).id;
    b = (await createTenant('M4 TT B', { currency: 'GHS' })).id;
    await setup(a, A, 'A');
    await setup(b, B, 'B');
    // Tenant A already holds one of everything: a count with a Finding, a received shipment, a partner, a failed attempt
    const count = await call(A.owner, 'post', '/api/inventory/counts', { locationId: A.swift, countDate: day(0), source: 'three_pl_dashboard', lines: [{ productId: A.product, countedQuantity: 190 }] });
    expect(count.status).toBe(201);
    const shipment = await call(A.owner, 'post', '/api/shipments', { productId: A.product, supplier: 'Print House', quantity: 30, unitCost: 10, shippingCost: 0, customsDuties: 0, otherCosts: 0 });
    expect(shipment.status).toBe(201);
    A.shipment = shipment.body.id;
    expect((await call(A.owner, 'post', `/api/shipments/${A.shipment}/receive`, { locationId: A.swift, receivedAt: day(1), quantityCounted: 28, countSource: 'own_count' })).status).toBe(200);
    const partner = await call(A.admin, 'post', '/api/delivery-partners', { kind: 'person', firstName: 'Kojo', lastName: 'A', email: `m4tt-kojo-a-${SUFFIX}@codadmin.test`, phoneNumber: '+233241112233' });
    expect(partner.status).toBe(201);
    A.partner = partner.body.partner.id;
    const orderData = (tenantId: string, customerId: number, agent: number) => ({ customerId, status: 'out_for_delivery', subtotal: 10, totalAmount: 10, codAmount: 10, deliveryAddress: '1 St', deliveryState: 'Ashanti', deliveryArea: 'Adum', tenantId, deliveryAgentId: agent } as any);
    A.order = (await db.order.create({ data: orderData(a, A.customer, A.agentUser) })).id;
    await runInTenant(a, () => transitionOrder(A.order, 'failed_delivery', actorOf({ id: A.admin.id, role: 'admin' } as any), { failureReason: 'not_reachable' }));
    B.orderData = orderData(b, B.customer, B.agentUser);
  }, 120_000);

  afterAll(async () => {
    await deleteTenantRows([a, b]);
    await db.$disconnect();
  });

  it('tenant A holds rows in every M4 model before tenant B writes', async () => {
    for (const [model, n] of [
      ['stockLocation', await db.stockLocation.count({ where: { tenantId: a } })], ['stockLevel', await db.stockLevel.count({ where: { tenantId: a } })],
      ['stockCount', await db.stockCount.count({ where: { tenantId: a } })], ['stockCountLine', await db.stockCountLine.count({ where: { tenantId: a } })],
      ['deliveryPartnerProfile', await db.deliveryPartnerProfile.count({ where: { tenantId: a } })], ['deliveryAttempt', await db.deliveryAttempt.count({ where: { tenantId: a } })],
    ] as const) expect([model, n > 0]).toEqual([model, true]);
  });

  it('tenant B transfers, receives, adjusts, counts, receives a shipment, adds a partner and fails an order: tenant A rows are identical', async () => {
    const before = await snapshot(a);

    const transfer = await call(B.owner, 'post', '/api/inventory/transfers', { type: 'allocation', productId: B.product, quantity: 20, fromLocationId: B.swift, toLocationId: B.agent });
    expect(transfer.status).toBe(201);
    expect((await call(B.owner, 'post', `/api/inventory/transfers/${transfer.body.transfer.id}/receive`, { quantity: 18, reason: 'short_in_package' })).status).toBe(200);
    expect((await call(B.owner, 'post', `/api/inventory/transfers/${transfer.body.transfer.id}/resolve`, { action: 'write_off', note: 'Lost' })).status).toBe(200);
    expect((await call(B.owner, 'post', '/api/inventory/adjust', { locationId: B.swift, productId: B.product, newQuantity: 150, reason: 'lost_or_stolen' })).status).toBe(200);
    const count = await call(B.owner, 'post', '/api/inventory/counts', { locationId: B.swift, countDate: day(0), source: 'three_pl_dashboard', lines: [{ productId: B.product, countedQuantity: 140 }] });
    expect(count.status).toBe(201);
    expect((await call(B.owner, 'post', `/api/inventory/counts/${count.body.count.id}/lines/${count.body.count.lines[0].id}/apply`, {})).status).toBe(200);
    const shipment = await call(B.owner, 'post', '/api/shipments', { productId: B.product, supplier: 'Print House', quantity: 30, unitCost: 10, shippingCost: 0, customsDuties: 0, otherCosts: 0 });
    expect(shipment.status).toBe(201);
    expect((await call(B.owner, 'post', `/api/shipments/${shipment.body.id}/receive`, { locationId: B.swift, receivedAt: day(1), quantityCounted: 28, countSource: 'own_count' })).status).toBe(200);
    expect((await call(B.owner, 'post', `/api/shipments/${shipment.body.id}/claim`, { action: 'write_off' })).status).toBe(200);
    expect((await call(B.admin, 'post', '/api/delivery-partners', { kind: 'company', firstName: 'Swift', lastName: 'B', email: `m4tt-swift-b2-${SUFFIX}@codadmin.test` })).status).toBe(201);
    const orderId = (await db.order.create({ data: B.orderData })).id;
    await runInTenant(b, () => transitionOrder(orderId, 'failed_delivery', actorOf({ id: B.admin.id, role: 'admin' } as any), { failureReason: 'refused' }));
    expect(await db.deliveryAttempt.count({ where: { tenantId: b } })).toBe(1);

    expect(await snapshot(a)).toBe(before);
  });

  it('tenant B asking for tenant A ids on every M4 write route gets 404 and tenant A rows are identical', async () => {
    const before = await snapshot(a);
    const aTransfer = await db.inventoryTransfer.findFirst({ where: { tenantId: a } });
    const aCount = await db.stockCount.findFirstOrThrow({ where: { tenantId: a }, include: { lines: true } });
    const aLine = aCount.lines[0].id;
    const attempts: Array<[string, 'get' | 'post' | 'patch', string, Record<string, unknown>?]> = [
      ['transfer from A location', 'post', '/api/inventory/transfers', { type: 'allocation', productId: B.product, quantity: 1, fromLocationId: A.swift, toLocationId: B.agent }],
      ['transfer of A product', 'post', '/api/inventory/transfers', { type: 'allocation', productId: A.product, quantity: 1, fromLocationId: B.swift, toLocationId: B.agent }],
      ['adjust A location', 'post', '/api/inventory/adjust', { locationId: A.swift, productId: B.product, newQuantity: 0, reason: 'lost_or_stolen' }],
      ['adjust A product', 'post', '/api/inventory/adjust', { locationId: B.swift, productId: A.product, newQuantity: 0, reason: 'lost_or_stolen' }],
      ['count at A location', 'post', '/api/inventory/counts', { locationId: A.swift, countDate: day(0), source: 'own_count', lines: [{ productId: B.product, countedQuantity: 1 }] }],
      ['count of A product', 'post', '/api/inventory/counts', { locationId: B.swift, countDate: day(0), source: 'own_count', lines: [{ productId: A.product, countedQuantity: 1 }] }],
      ['apply A count line', 'post', `/api/inventory/counts/${aCount.id}/lines/${aLine}/apply`, {}],
      ['read A count', 'get', `/api/inventory/counts/${aCount.id}`],
      ['receive A shipment', 'post', `/api/shipments/${A.shipment}/receive`, { locationId: B.swift, receivedAt: day(1), quantityCounted: 1, countSource: 'own_count' }],
      ['claim A shipment', 'post', `/api/shipments/${A.shipment}/claim`, { action: 'write_off' }],
      ['shipment of A product', 'post', '/api/shipments', { productId: A.product, supplier: 'x', quantity: 1, unitCost: 1, shippingCost: 0, customsDuties: 0, otherCosts: 0 }],
      ['read A partner', 'get', `/api/delivery-partners/${A.partner}`],
      ['change A partner', 'patch', `/api/delivery-partners/${A.partner}`, { daysToPay: 30 }],
      ['A partner availability', 'patch', `/api/delivery-partners/${A.partner}/availability`, { isAvailable: false }],
      ['proof of A order', 'get', `/api/deliveries/by-order/${A.order}`],
      ['proofs of A partner', 'get', `/api/delivery-partners/${A.agentUser}/order-proofs?orderIds=${A.order}`],
      ...(aTransfer ? [['resolve A transfer', 'post', `/api/inventory/transfers/${aTransfer.id}/resolve`, { action: 'write_off' }] as [string, 'post', string, Record<string, unknown>]] : []),
    ];
    for (const [label, method, path, body] of attempts) {
      const res = await call(B.owner, method, path, body);
      // The batched proofs of another tenant's partner answer an empty list; every other route refuses (404, or 400 for a body that names a foreign id)
      if (label === 'proofs of A partner') expect([label, [200, 404].includes(res.status), res.body.proofs ?? []]).toEqual([label, true, []]);
      else expect([label, [404, 400].includes(res.status)]).toEqual([label, true]);
    }
    expect(await snapshot(a)).toBe(before);
  });

  it('read routes asked about tenant A ids through filters return nothing of tenant A', async () => {
    const aNames = [`Swift A ${SUFFIX}`, `Agent A ${SUFFIX}`, 'Copybook A'];
    const paths = [
      `/api/inventory/overview?product=${A.product}`,
      `/api/inventory/levels?locationId=${A.swift}`,
      `/api/inventory/levels?productId=${A.product}`,
      `/api/inventory/transfers?locationId=${A.swift}&productId=${A.product}&limit=100`,
      `/api/inventory/counts?locationId=${A.swift}`,
      `/api/inventory/returns/summary?partner=${A.swift}`,
      `/api/delivery-partners/failure-reasons?from=2020-01-01&to=2100-01-01&partnerId=${A.agentUser}`,
      `/api/delivery-partners?from=2020-01-01&to=2100-01-01`,
      `/api/shipments`,
      `/api/products?tab=all&limit=100`,
    ];
    for (const path of paths) {
      const res = await call(B.owner, 'get', path);
      const body = JSON.stringify(res.body);
      expect([path, res.status < 500]).toEqual([path, true]);
      for (const name of aNames) expect([path, name, body.includes(name)]).toEqual([path, name, false]);
    }
  });
});
