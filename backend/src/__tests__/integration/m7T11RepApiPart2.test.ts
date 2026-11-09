/**
 * M7-T11 (COD-65): Rep API part 2 integration tests.
 *
 * Verifies:
 * - /api/rep/orders (my orders, search by id, phone, name; real OrderStatus filter; pagination; param validation)
 * - /api/rep/numbers (rates from teamReport: contract test; YYYY-MM period only; calls-per-day across store-local midnight)
 * - /api/rep/earnings (one owed rule from payoutService summarize(): contract test; openOrdersNote store currency; reversal line on return)
 * - /api/rep/reward-progress (M6 tiers via rewardService by roleId; target reached shows "Paid after month close"; no constant payout field)
 * - /api/rep/payouts (payout history from payoutService, no for field)
 * - "Delivered from confirmed" uses closed confirmed orders (R3)
 * - New rep with no data returns zeros, not errors
 * - Rep sees own rows only (two-rep test with 403 on cross-rep access)
 * - Fixture check: Adwoa earnings = 2,024 + 610 minus payouts in fixture (2,034 owed)
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { teamReport } from '../../services/teamReportService';
import payoutService from '../../services/payoutService';
import * as rewardService from '../../services/rewardService';
import { getCurrency } from '../../utils/currency';
import { clearPermissionsCache } from '../../middleware/auth';
import { currentMonth, getStoreTimeZone, localDate, monthRange, parseMonth, shiftYmd, startOfDay } from '../../services/kpi/dates';
import { runInTenant } from '../../utils/tenantContext';
import { CallOutcome, CallSource } from '@prisma/client';
import * as Money from '../../utils/money';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
const phone = (n: number) => `+23324${String(SUFFIX).slice(-6)}${String(n).padStart(2, '0')}`;
const bearer = (tok: string) => `Bearer ${tok}`;

const tenantIds: string[] = [];
let tenantId: string;
let adminToken: string;
let rep1Token: string;
let rep2Token: string;
let newRepToken: string;
let aiRepToken: string;
let adminId: number;
let rep1Id: number;
let rep2Id: number;
let newRepId: number;
let aiRepId: number;
let customer1Id: number;
let customer2Id: number;
let productId: number;

beforeAll(async () => {
  const tenant = await createTenant('T11 Rep API Part 2 Tenant');
  tenantId = tenant.id;
  tenantIds.push(tenantId);
  await seedTenantDefaults(tenantId);

  const admin = await prismaBase.user.create({
    data: {
      email: `admin-${SUFFIX}@t11.test`,
      password: 'x',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      tenantId,
    },
  });
  adminId = admin.id;
  adminToken = generateAccessToken({ id: admin.id, email: admin.email, role: 'admin', tenantId });

  const rep1 = await prismaBase.user.create({
    data: {
      email: `rep1-${SUFFIX}@t11.test`,
      password: 'x',
      firstName: 'Adwoa',
      lastName: 'Darko',
      role: 'sales_rep',
      kind: 'person',
      tenantId,
    },
  });
  rep1Id = rep1.id;
  rep1Token = generateAccessToken({ id: rep1.id, email: rep1.email, role: 'sales_rep', tenantId });

  const rep2 = await prismaBase.user.create({
    data: {
      email: `rep2-${SUFFIX}@t11.test`,
      password: 'x',
      firstName: 'Nana',
      lastName: 'Kyei',
      role: 'sales_rep',
      kind: 'person',
      tenantId,
    },
  });
  rep2Id = rep2.id;
  rep2Token = generateAccessToken({ id: rep2.id, email: rep2.email, role: 'sales_rep', tenantId });

  const newRep = await prismaBase.user.create({
    data: {
      email: `newrep-${SUFFIX}@t11.test`,
      password: 'x',
      firstName: 'Newbie',
      lastName: 'Rep',
      role: 'sales_rep',
      kind: 'person',
      tenantId,
    },
  });
  newRepId = newRep.id;
  newRepToken = generateAccessToken({ id: newRep.id, email: newRep.email, role: 'sales_rep', tenantId });

  const aiRep = await prismaBase.user.create({
    data: {
      email: `airep-${SUFFIX}@t11.test`,
      password: 'x',
      firstName: 'ConfirmAgent',
      lastName: 'Bot',
      role: 'sales_rep',
      kind: 'ai_agent',
      tenantId,
    },
  });
  aiRepId = aiRep.id;
  aiRepToken = generateAccessToken({ id: aiRep.id, email: aiRep.email, role: 'sales_rep', tenantId });

  const product = await prismaBase.product.create({
    data: {
      name: 'T11 Product',
      sku: `PROD-T11-${SUFFIX}`,
      category: 'General',
      productType: 'physical',
      price: 249,
      stockQuantity: 500,
      tenantId,
    },
  });
  productId = product.id;

  const customer1 = await prismaBase.customer.create({
    data: {
      firstName: 'Akosua',
      lastName: 'Agyei',
      phoneNumber: phone(1),
      alternatePhone: phone(2),
      address: 'House 12, Ring Road',
      state: 'Greater Accra',
      area: 'Airport Residential',
      tenantId,
    },
  });
  customer1Id = customer1.id;

  const customer2 = await prismaBase.customer.create({
    data: {
      firstName: 'Kwame',
      lastName: 'Boateng',
      phoneNumber: phone(3),
      alternatePhone: phone(4),
      address: 'Plot 4, High Street',
      state: 'Ashanti',
      area: 'Adum',
      tenantId,
    },
  });
  customer2Id = customer2.id;
});

afterAll(async () => {
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('1. /api/rep/orders (my orders, search by id, phone, name; real status filter)', () => {
  let order1: any;
  let order2: any;
  let order3: any;

  beforeAll(async () => {
    // Order 1: assigned to Rep 1, confirmed and delivered
    order1 = await prismaBase.order.create({
      data: {
        tenantId,
        customerId: customer1Id,
        customerRepId: rep1Id,
        confirmedById: rep1Id,
        status: 'delivered',
        deliveryDate: new Date(),
        subtotal: 249,
        totalAmount: 249,
        deliveryArea: 'Airport Residential',
        orderItems: {
          create: [{ productId, quantity: 1, unitPrice: 249, totalPrice: 249 }],
        },
      },
    });

    // Order 2: assigned to Rep 1, confirmed (open)
    order2 = await prismaBase.order.create({
      data: {
        tenantId,
        customerId: customer2Id,
        customerRepId: rep1Id,
        confirmedById: rep1Id,
        status: 'confirmed',
        subtotal: 449,
        totalAmount: 449,
        deliveryArea: 'Adum',
        orderItems: {
          create: [{ productId, quantity: 2, unitPrice: 224.5, totalPrice: 449 }],
        },
      },
    });

    // Order 3: assigned to Rep 2 only
    order3 = await prismaBase.order.create({
      data: {
        tenantId,
        customerId: customer1Id,
        customerRepId: rep2Id,
        confirmedById: rep2Id,
        status: 'cancelled',
        subtotal: 249,
        totalAmount: 249,
      },
    });
  });

  it('rep1 sees only their own orders at /api/rep/orders', async () => {
    const res = await request(app).get('/api/rep/orders').set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(2);
    const orderIds = res.body.orders.map((o: any) => o.id);
    expect(orderIds).toContain(order1.id);
    expect(orderIds).toContain(order2.id);
    expect(orderIds).not.toContain(order3.id);
  });

  it('does not return invented orderNumber (#id) or statusLabel (frontend formats both)', async () => {
    const res = await request(app).get('/api/rep/orders').set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    const o = res.body.orders[0];
    expect(o).toHaveProperty('id');
    expect(o).toHaveProperty('status');
    expect(o).not.toHaveProperty('orderNumber');
    expect(o).not.toHaveProperty('statusLabel');
  });

  it('searches by order ID (#id or raw id)', async () => {
    const resRaw = await request(app)
      .get(`/api/rep/orders?q=${order1.id}`)
      .set('Authorization', bearer(rep1Token));
    expect(resRaw.status).toBe(200);
    expect(resRaw.body.orders).toHaveLength(1);
    expect(resRaw.body.orders[0].id).toBe(order1.id);

    const resHash = await request(app)
      .get(`/api/rep/orders?q=%23${order1.id}`)
      .set('Authorization', bearer(rep1Token));
    expect(resHash.status).toBe(200);
    expect(resHash.body.orders).toHaveLength(1);
    expect(resHash.body.orders[0].id).toBe(order1.id);
  });

  it('searches by customer phone number', async () => {
    const res = await request(app)
      .get(`/api/rep/orders?q=${encodeURIComponent(phone(1))}`)
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].customer.phone).toBe(phone(1));
  });

  it('searches by customer name', async () => {
    const res = await request(app)
      .get('/api/rep/orders?q=Boateng')
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].customer.lastName).toBe('Boateng');
  });

  it('filters by real OrderStatus (delivered, confirmed, comma list)', async () => {
    const resDelivered = await request(app)
      .get('/api/rep/orders?status=delivered')
      .set('Authorization', bearer(rep1Token));
    expect(resDelivered.status).toBe(200);
    expect(resDelivered.body.orders).toHaveLength(1);
    expect(resDelivered.body.orders[0].id).toBe(order1.id);
    expect(resDelivered.body.orders[0].status).toBe('delivered');

    const resConfirmed = await request(app)
      .get('/api/rep/orders?status=confirmed')
      .set('Authorization', bearer(rep1Token));
    expect(resConfirmed.status).toBe(200);
    expect(resConfirmed.body.orders).toHaveLength(1);
    expect(resConfirmed.body.orders[0].id).toBe(order2.id);
    expect(resConfirmed.body.orders[0].status).toBe('confirmed');

    const resBoth = await request(app)
      .get('/api/rep/orders?status=confirmed,delivered')
      .set('Authorization', bearer(rep1Token));
    expect(resBoth.status).toBe(200);
    expect(resBoth.body.orders).toHaveLength(2);
  });

  it('bad status filter returns 400', async () => {
    const resInvalid = await request(app)
      .get('/api/rep/orders?status=invalid_status')
      .set('Authorization', bearer(rep1Token));
    expect(resInvalid.status).toBe(400);

    // Invented group names must be rejected with 400
    const resWaiting = await request(app)
      .get('/api/rep/orders?status=waiting_to_dispatch')
      .set('Authorization', bearer(rep1Token));
    expect(resWaiting.status).toBe(400);

    const resFailed = await request(app)
      .get('/api/rep/orders?status=failed')
      .set('Authorization', bearer(rep1Token));
    expect(resFailed.status).toBe(400);
  });

  it('validates pagination and repId query params (positive whole numbers return 400 on bad values)', async () => {
    const resBadPage = await request(app)
      .get('/api/rep/orders?page=0')
      .set('Authorization', bearer(rep1Token));
    expect(resBadPage.status).toBe(400);

    const resBadLimit = await request(app)
      .get('/api/rep/orders?limit=-1')
      .set('Authorization', bearer(rep1Token));
    expect(resBadLimit.status).toBe(400);

    const resBadRepId = await request(app)
      .get('/api/rep/orders?repId=abc')
      .set('Authorization', bearer(adminToken));
    expect(resBadRepId.status).toBe(400);
  });

  it('supports pagination', async () => {
    const res = await request(app)
      .get('/api/rep/orders?page=1&limit=1')
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('manager/admin can pass ?repId to view a specific rep orders', async () => {
    const resAdmin = await request(app)
      .get(`/api/rep/orders?repId=${rep2Id}`)
      .set('Authorization', bearer(adminToken));
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.orders).toHaveLength(1);
    expect(resAdmin.body.orders[0].id).toBe(order3.id);
  });
});

describe('2. /api/rep/numbers (rank and rates from teamReport: contract test, R3)', () => {
  beforeAll(async () => {
    // Log calls for rep1
    await prismaBase.call.createMany({
      data: [
        {
          tenantId,
          salesRepId: rep1Id,
          customerId: customer1Id,
          outcome: CallOutcome.confirmed,
          source: CallSource.manual,
        },
        {
          tenantId,
          salesRepId: rep1Id,
          customerId: customer2Id,
          outcome: CallOutcome.not_reachable,
          source: CallSource.manual,
        },
        {
          tenantId,
          salesRepId: rep1Id,
          customerId: customer2Id,
          outcome: CallOutcome.declined,
          source: CallSource.manual,
        },
      ],
    });
  });

  it('contract test: numbers rates equal the rep\'s teamReport row', async () => {
    const zone = getStoreTimeZone(tenantId);
    const range = monthRange(2026, 10, zone);

    const report = await teamReport(tenantId, range.from, range.to);
    const rep1Row = report.reps.find((r) => r.repId === rep1Id);

    const res = await request(app)
      .get('/api/rep/numbers?period=2026-10')
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);

    // Contract: rates must match teamReport row exactly
    expect(res.body.confirmationRate).toEqual(rep1Row?.confirmationRate.value ?? null);
    expect(res.body.deliveredFromConfirmedRate).toEqual(rep1Row?.deliveredFromConfirmedRate.value ?? null);
    expect(res.body.confirmationRateDetail).toEqual(rep1Row?.confirmationRate.detail);
    expect(res.body.deliveredFromConfirmedDetail).toEqual(rep1Row?.deliveredFromConfirmedRate.detail);
    expect(res.body.upsellRate).toEqual(rep1Row?.upsellRate ?? 0);
    expect(res.body.extraValueAdded).toEqual(rep1Row?.extraValue ?? '0.00');
    expect(res.body.timeToFirstCall).toEqual(rep1Row?.timeToFirstCallMinutes ?? null);
    expect(res.body.targetHit).toEqual(rep1Row?.targetHit ?? null);
  });

  it('validates period (400 on bad period)', async () => {
    const resBad = await request(app)
      .get('/api/rep/numbers?period=2026-13')
      .set('Authorization', bearer(rep1Token));
    expect(resBad.status).toBe(400);

    const resBadStr = await request(app)
      .get('/api/rep/numbers?period=invalid')
      .set('Authorization', bearer(rep1Token));
    expect(resBadStr.status).toBe(400);
  });

  it('R3: "Delivered from confirmed" uses closed confirmed orders', async () => {
    const res = await request(app)
      .get('/api/rep/numbers')
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.deliveredFromConfirmedDetail).toHaveProperty('delivered');
    expect(res.body.deliveredFromConfirmedDetail).toHaveProperty('failed');
    expect(res.body.deliveredFromConfirmedDetail).toHaveProperty('returned');
    expect(res.body.deliveredFromConfirmedDetail).toHaveProperty('closed');
    const d = res.body.deliveredFromConfirmedDetail;
    expect(d.closed).toBe(d.delivered + d.failed + d.returned);
  });

  it('returns calls metrics and breakdown', async () => {
    const res = await request(app)
      .get('/api/rep/numbers')
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveProperty('today');
    expect(res.body.calls).toHaveProperty('thisWeek');
    expect(res.body.calls).toHaveProperty('thisMonth');
    expect(res.body.calls).toHaveProperty('averagePerDay');
    expect(res.body.callOutcomes).toHaveProperty('confirmed');
    expect(res.body.callOutcomes).toHaveProperty('not_reachable');
    expect(res.body.callOutcomes).toHaveProperty('declined');
    expect(res.body.callsPerDay).toHaveLength(14);
  });

  it('calls-per-day count is right across a store-local midnight', async () => {
    const zone = getStoreTimeZone(tenantId);
    const now = new Date();
    const todayStr = localDate(now, zone);
    const yesterdayStr = shiftYmd(todayStr, -1);
    const midnight = startOfDay(todayStr, zone);

    // Call 1: 30 minutes before local midnight (yesterday)
    await prismaBase.call.create({
      data: {
        tenantId,
        salesRepId: rep2Id,
        customerId: customer1Id,
        outcome: CallOutcome.confirmed,
        source: CallSource.manual,
        createdAt: new Date(midnight.getTime() - 30 * 60 * 1000),
      },
    });

    // Call 2: 30 minutes after local midnight (today)
    await prismaBase.call.create({
      data: {
        tenantId,
        salesRepId: rep2Id,
        customerId: customer1Id,
        outcome: CallOutcome.confirmed,
        source: CallSource.manual,
        createdAt: new Date(midnight.getTime() + 30 * 60 * 1000),
      },
    });

    const res = await request(app).get('/api/rep/numbers').set('Authorization', bearer(rep2Token));
    expect(res.status).toBe(200);

    const yesterdayBucket = res.body.callsPerDay.find((d: any) => d.date === yesterdayStr);
    const todayBucket = res.body.callsPerDay.find((d: any) => d.date === todayStr);

    expect(yesterdayBucket).toBeDefined();
    expect(todayBucket).toBeDefined();
    expect(yesterdayBucket.count).toBeGreaterThanOrEqual(1);
    expect(todayBucket.count).toBeGreaterThanOrEqual(1);
  });
});

describe('3. /api/rep/earnings (lines per order, one owed rule, contract test)', () => {
  let deliveredOrder: any;
  let returnedOrder: any;

  beforeAll(async () => {
    // Order delivered with upsell
    deliveredOrder = await prismaBase.order.create({
      data: {
        tenantId,
        customerId: customer1Id,
        customerRepId: rep1Id,
        confirmedById: rep1Id,
        status: 'delivered',
        subtotal: 449,
        totalAmount: 449,
      },
    });

    await prismaBase.commissionEntry.createMany({
      data: [
        {
          tenantId,
          orderId: deliveredOrder.id,
          userId: rep1Id,
          kind: 'base',
          status: 'earned',
          amount: 8,
          earnedAt: new Date(),
        },
        {
          tenantId,
          orderId: deliveredOrder.id,
          userId: rep1Id,
          kind: 'upsell',
          status: 'earned',
          amount: 20,
          earnedAt: new Date(),
        },
      ],
    });

    // Returned order that had an entry voided
    returnedOrder = await prismaBase.order.create({
      data: {
        tenantId,
        customerId: customer2Id,
        customerRepId: rep1Id,
        confirmedById: rep1Id,
        status: 'returned',
        subtotal: 249,
        totalAmount: 249,
      },
    });

    await prismaBase.commissionEntry.create({
      data: {
        tenantId,
        orderId: returnedOrder.id,
        userId: rep1Id,
        kind: 'base',
        status: 'void',
        amount: 8,
        earnedAt: new Date(),
      },
    });
  });

  it('contract test: earnings owed equals payoutService.getOwed(rep).owed for the same rep', async () => {
    const owedFromPayoutService = await runInTenant(tenantId, () => payoutService.getOwed(rep1Id));

    const res = await request(app).get('/api/rep/earnings').set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.owed).toEqual(Money.toApi(owedFromPayoutService.owed));
    expect(res.body.commission).toEqual(Money.toApi(owedFromPayoutService.commission));
    expect(res.body.upsellReward).toEqual(Money.toApi(owedFromPayoutService.upsellReward));
    expect(res.body.earned).toEqual(Money.toApi(owedFromPayoutService.earned));
    expect(res.body.paid).toEqual(Money.toApi(owedFromPayoutService.paid));
  });

  it('computes commission, upsell reward, earned, paid, owed, and per-order lines without net or for', async () => {
    const res = await request(app).get('/api/rep/earnings').set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      commission: '8.00',
      upsellReward: '20.00',
      earned: '28.00',
      paid: '0.00',
      owed: '28.00',
      overpaid: null,
      isOverpaid: false,
    });

    // Lines per order: base, upsell, reversal, no net field
    expect(res.body.lines.length).toBeGreaterThanOrEqual(2);
    const deliveredLine = res.body.lines.find((l: any) => l.orderId === deliveredOrder.id);
    expect(deliveredLine).toMatchObject({
      base: '8.00',
      upsell: '20.00',
      earned: '28.00',
      paid: '0.00',
      isReversal: false,
      reversal: null,
    });
    expect(deliveredLine).not.toHaveProperty('net');

    // Returned order shows reversal line
    const returnedLine = res.body.lines.find((l: any) => l.orderId === returnedOrder.id);
    expect(returnedLine).toBeDefined();
    expect(returnedLine.isReversal).toBe(true);
    expect(returnedLine.status).toBe('returned');
    expect(returnedLine.reversal).toBe('8.00');
    expect(returnedLine).not.toHaveProperty('net');
  });

  it('openOrdersNote uses store currency and repPay settings (no hard-coded GH₵8)', async () => {
    const settings = await runInTenant(tenantId, () => rewardService.getRewardSettings());
    const currency = await runInTenant(tenantId, () => getCurrency());
    const formattedSign = Money.formatWithSign(settings.repPay.baseCommission, currency);

    const res = await request(app).get('/api/rep/earnings').set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.openOrdersNote).toContain(formattedSign);
  });

  it('payment history includes date, amount, status, notes without for field', async () => {
    const testPayout = await prismaBase.payout.create({
      data: {
        tenantId,
        payeeId: rep1Id,
        kind: 'rep',
        amount: 15,
        method: 'Mobile Money',
        status: 'completed',
        notes: 'Small advance',
      },
    });

    const res = await request(app).get('/api/rep/earnings').set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    const p = res.body.payouts.find((item: any) => item.id === testPayout.id);
    expect(p).toBeDefined();
    expect(p).toMatchObject({
      amount: '15.00',
      status: 'completed',
      notes: 'Small advance',
    });
    expect(p).toHaveProperty('date');
    expect(p).not.toHaveProperty('for');

    await prismaBase.payout.delete({ where: { id: testPayout.id } });
  });

  it('fixture check: Adwoa earnings = 2,024 + 610 minus payouts in the fixture (2,034 owed)', async () => {
    // Seed Adwoa's fixture entries in a dedicated fixture tenant
    const fixTenant = (await createTenant('T11 Fixture Check Tenant')).id;
    tenantIds.push(fixTenant);
    await seedTenantDefaults(fixTenant);

    const adwoa = await prismaBase.user.create({
      data: {
        email: `adwoa-fix-${SUFFIX}@test.local`,
        password: 'x',
        firstName: 'Adwoa',
        lastName: 'Darko',
        role: 'sales_rep',
        kind: 'person',
        tenantId: fixTenant,
      },
    });
    const adwoaToken = generateAccessToken({ id: adwoa.id, email: adwoa.email, role: 'sales_rep', tenantId: fixTenant });

    // Paid payout of 600
    const payout600 = await prismaBase.payout.create({
      data: {
        tenantId: fixTenant,
        payeeId: adwoa.id,
        kind: 'rep',
        amount: 600,
        method: 'Bank Transfer',
        status: 'completed',
        notes: 'Paid October commission',
      },
    });

    // Commission entries: 600 paid base + 1424 earned base = 2,024 base commission
    await prismaBase.commissionEntry.create({
      data: {
        tenantId: fixTenant,
        userId: adwoa.id,
        kind: 'base',
        status: 'paid',
        payoutId: payout600.id,
        amount: 600,
        earnedAt: new Date(),
      },
    });
    await prismaBase.commissionEntry.create({
      data: {
        tenantId: fixTenant,
        userId: adwoa.id,
        kind: 'base',
        status: 'earned',
        amount: 1424,
        earnedAt: new Date(),
      },
    });

    // 610 upsell reward
    await prismaBase.commissionEntry.create({
      data: {
        tenantId: fixTenant,
        userId: adwoa.id,
        kind: 'upsell',
        status: 'earned',
        amount: 610,
        earnedAt: new Date(),
      },
    });

    const res = await request(app).get('/api/rep/earnings').set('Authorization', bearer(adwoaToken));
    expect(res.status).toBe(200);
    // Adwoa earnings = 2,024 + 610 minus 600 payouts = 2,034
    expect(res.body).toMatchObject({
      commission: '2024.00',
      upsellReward: '610.00',
      earned: '2634.00',
      paid: '600.00',
      owed: '2034.00',
      overpaid: null,
      isOverpaid: false,
    });
    expect(res.body.payouts).toHaveLength(1);
    expect(res.body.payouts[0]).toMatchObject({
      amount: '600.00',
      method: 'Bank Transfer',
      notes: 'Paid October commission',
    });
    expect(res.body.payouts[0]).not.toHaveProperty('for');
  });
});

describe('4. /api/rep/reward-progress (M6 tiers via rewardService)', () => {
  let roleId: number;

  beforeAll(async () => {
    const role = await prismaBase.role.findFirstOrThrow({
      where: { tenantId, presetRole: 'sales_rep', isSystem: false },
    });
    roleId = role.id;

    // Assign rep1 and rep2 to Call rep role
    await prismaBase.roleAssignment.createMany({
      data: [
        { tenantId, holderId: rep1Id, roleId, fromDate: new Date('2026-01-01') },
        { tenantId, holderId: rep2Id, roleId, fromDate: new Date('2026-01-01') },
      ],
    });

    // Seed cash reward tiers: 100% -> 300, 120% -> 500 + day off
    await prismaBase.rewardTier.upsert({
      where: { tenantId_roleId_threshold: { tenantId, roleId, threshold: 100 } },
      create: { tenantId, roleId, threshold: 100, amount: 300, dayOff: false, payout: true },
      update: { amount: 300, dayOff: false, payout: true },
    });
    await prismaBase.rewardTier.upsert({
      where: { tenantId_roleId_threshold: { tenantId, roleId, threshold: 120 } },
      create: { tenantId, roleId, threshold: 120, amount: 500, dayOff: true, payout: true },
      update: { amount: 500, dayOff: true, payout: true },
    });
  });

  it('returns M6 tiers for rep roleId (tier100: 300, tier120: 500) without constant payout field', async () => {
    const res = await request(app).get('/api/rep/reward-progress').set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.tiers).toBeDefined();
    expect(res.body.tiers.tier100).toMatchObject({ amount: '300.00', dayOff: false, payout: true });
    expect(res.body.tiers.tier120).toMatchObject({ amount: '500.00', dayOff: true, payout: true });
    expect(res.body).not.toHaveProperty('payout');
  });

  it('target reached shows "Paid after month close"', async () => {
    // Set target of 1 for rep1, and rep1 has delivered 1 order
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

    await prismaBase.target.create({
      data: {
        tenantId,
        userId: rep1Id,
        roleId,
        periodStart,
        periodEnd,
        metric: 'confirmed_delivered',
        unit: 'orders',
        value: 1,
        source: 'manual',
        scope: 'person',
      },
    });

    const res = await request(app).get('/api/rep/reward-progress').set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.targetReached).toBe(true);
    expect(res.body.message).toContain('Paid after month close');
    expect(res.body.note).toBe('Paid after month close');
  });

  it('AI agent shows message No payout for AI agents', async () => {
    const res = await request(app).get('/api/rep/reward-progress').set('Authorization', bearer(aiRepToken));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('No payout for AI agents');
  });
});

describe('5. Pay ledger read (/api/rep/payouts)', () => {
  beforeAll(async () => {
    await prismaBase.payout.create({
      data: {
        tenantId,
        payeeId: rep2Id,
        kind: 'rep',
        amount: 350,
        method: 'Mobile Money',
        reference: `MM-PAY-${SUFFIX}`,
        status: 'completed',
        notes: 'September balance payment',
      },
    });
  });

  it('reads the rep payout history without for field', async () => {
    const res = await request(app).get('/api/rep/payouts').set('Authorization', bearer(rep2Token));
    expect(res.status).toBe(200);
    expect(res.body.payouts).toHaveLength(1);
    expect(res.body.payouts[0]).toMatchObject({
      amount: '350.00',
      method: 'Mobile Money',
      reference: `MM-PAY-${SUFFIX}`,
      notes: 'September balance payment',
    });
    expect(res.body.payouts[0]).toHaveProperty('date');
    expect(res.body.payouts[0]).not.toHaveProperty('for');
  });
});

describe('6. New rep with no data returns zeros, not errors', () => {
  it('/api/rep/orders returns empty list', async () => {
    const res = await request(app).get('/api/rep/orders').set('Authorization', bearer(newRepToken));
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('/api/rep/numbers returns zeros and nulls, no crash', async () => {
    const res = await request(app).get('/api/rep/numbers').set('Authorization', bearer(newRepToken));
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(0);
    expect(res.body.confirmationRate).toBeNull();
    expect(res.body.deliveredFromConfirmedRate).toBeNull();
    expect(res.body.extraValueAdded).toBe('0.00');
    expect(res.body.orderBreakdown).toEqual({
      confirmed: 0,
      delivered: 0,
      failedOrReturned: 0,
      stillOpen: 0,
    });
    expect(res.body.calls.thisMonth).toBe(0);
  });

  it('/api/rep/earnings returns zeros, no crash', async () => {
    const res = await request(app).get('/api/rep/earnings').set('Authorization', bearer(newRepToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      commission: '0.00',
      upsellReward: '0.00',
      earned: '0.00',
      paid: '0.00',
      owed: '0.00',
      overpaid: null,
      isOverpaid: false,
      lines: [],
      payouts: [],
    });
  });

  it('/api/rep/reward-progress returns "No target set", no crash', async () => {
    const res = await request(app).get('/api/rep/reward-progress').set('Authorization', bearer(newRepToken));
    expect(res.status).toBe(200);
    expect(res.body.target).toBeNull();
    expect(res.body.actual).toBe(0);
    expect(res.body.targetReached).toBe(false);
    expect(res.body.message).toBe('No target set');
  });

  it('/api/rep/payouts returns empty list, no crash', async () => {
    const res = await request(app).get('/api/rep/payouts').set('Authorization', bearer(newRepToken));
    expect(res.status).toBe(200);
    expect(res.body.payouts).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

describe('7. Two-rep test (Rep sees own rows only)', () => {
  it('rep 2 cannot view rep 1 orders by query param (returns 403)', async () => {
    const res = await request(app)
      .get(`/api/rep/orders?repId=${rep1Id}`)
      .set('Authorization', bearer(rep2Token));
    expect(res.status).toBe(403);
  });

  it('rep 1 cannot view rep 2 earnings by query param (returns 403)', async () => {
    const res = await request(app)
      .get(`/api/rep/earnings?repId=${rep2Id}`)
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(403);
  });

  it('rep 1 cannot view rep 2 numbers by query param (returns 403)', async () => {
    const res = await request(app)
      .get(`/api/rep/numbers?repId=${rep2Id}`)
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(403);
  });

  it('rep 1 cannot view rep 2 reward progress by query param (returns 403)', async () => {
    const res = await request(app)
      .get(`/api/rep/reward-progress?repId=${rep2Id}`)
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(403);
  });

  it('rep 1 cannot view rep 2 payouts by query param (returns 403)', async () => {
    const res = await request(app)
      .get(`/api/rep/payouts?repId=${rep2Id}`)
      .set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(403);
  });
});

describe('8. Security review fixes', () => {
  it('an order reassigned to another rep leaves My orders, even if this rep confirmed it', async () => {
    const moved = await prismaBase.order.create({
      data: { tenantId, customerId: customer1Id, customerRepId: rep2Id, confirmedById: rep1Id, status: 'confirmed', subtotal: 99, totalAmount: 99 },
    });
    const res = await request(app).get('/api/rep/orders?limit=100').set('Authorization', bearer(rep1Token));
    expect(res.status).toBe(200);
    expect(res.body.orders.map((o: { id: number }) => o.id)).not.toContain(moved.id);
  });

  it("a manager without payouts:view cannot see another rep's earnings or pay ledger", async () => {
    const manager = await prismaBase.user.create({
      data: { email: `mgr-${SUFFIX}@t11.test`, password: 'x', firstName: 'Mgr', lastName: 'NoPay', role: 'manager', tenantId },
    });
    const managerToken = generateAccessToken({ id: manager.id, email: manager.email, role: 'manager', tenantId });
    // The tenant's manager position role holds the grid the checks use. Take payouts:view out of it for this test.
    const managerRoles = await prismaBase.role.findMany({ where: { tenantId, presetRole: 'manager' } });
    for (const r of managerRoles) {
      const grid = { ...((r.permissions as Record<string, string[]>) ?? {}) };
      delete grid.payouts;
      await prismaBase.role.update({ where: { id: r.id }, data: { permissions: grid } });
    }
    expect(managerRoles.length).toBeGreaterThan(0);
    clearPermissionsCache();
    try {
      const earnings = await request(app).get(`/api/rep/earnings?repId=${rep1Id}`).set('Authorization', bearer(managerToken));
      expect(earnings.status).toBe(403);
      const payouts = await request(app).get(`/api/rep/payouts?repId=${rep1Id}`).set('Authorization', bearer(managerToken));
      expect(payouts.status).toBe(403);
      const own = await request(app).get('/api/rep/payouts').set('Authorization', bearer(managerToken));
      expect(own.status).toBe(200);
      const admin = await request(app).get(`/api/rep/earnings?repId=${rep1Id}`).set('Authorization', bearer(adminToken));
      expect(admin.status).toBe(200);
    } finally {
      for (const r of managerRoles) {
        await prismaBase.role.update({ where: { id: r.id }, data: { permissions: r.permissions ?? undefined } });
      }
      clearPermissionsCache();
    }
  });
});
