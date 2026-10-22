/**
 * M3-T14 (COD-23): POST /api/orders/upload/validate and /api/orders/upload (F-319).
 * 42-row file (40 ready, 2 bad): validate saves nothing, import saves 40; a delivered row posts revenue once;
 * 2,001 rows return the split message; limits, duplicates, audit row and two-tenant checks.
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
import { bearer } from './helpers/superAdminToken';

// The import limiter allows 10 requests in 5 minutes per IP; this suite sends more
jest.mock('../../middleware/bulkRateLimiter', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { bulkImportRateLimiter: pass, bulkOrderRateLimiter: pass };
});

jest.setTimeout(240_000);

const SUFFIX = Date.now();
const HEADER = 'customer_name,phone,address,region,product,quantity,price,status,date,assigned rep';
let tenantId: string;
let otherTenantId: string;
let productId: number;
const U: Record<string, { id: number; token: string }> = {};
let seq = 0;

const mkUser = async (label: string, role: any, first = label, last = 'Import') => {
  const u = await prismaBase.user.create({
    data: { email: `imp-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: first, lastName: last, role, tenantId },
  });
  U[label] = { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId }) };
};

/** A unique Ghana number per call: 024 + four digits of the run + three digits of the call. */
const phone = () => `024${String(SUFFIX).slice(-4)}${String(seq++).padStart(3, '0')}`;
const line = (over: Partial<Record<'name' | 'phone' | 'address' | 'region' | 'product' | 'qty' | 'price' | 'status' | 'date' | 'rep', string>> = {}) => {
  const n = over.phone ?? phone();
  const f = { name: `Buyer ${n}`, phone: n, address: `${n} Import Road`, region: 'Ashanti', product: 'Copybook Set', qty: '2', price: '50', status: 'pending_confirmation', date: '', rep: '', ...over };
  return [f.name, f.phone, f.address, f.region, f.product, f.qty, f.price, f.status, f.date, f.rep].join(',');
};
const file = (lines: string[]) => Buffer.from([HEADER, ...lines].join('\n') + '\n');
const validate = (who: string, buf: Buffer, name = 'orders.csv') =>
  request(app).post('/api/orders/upload/validate').set(bearer(U[who].token)).attach('file', buf, name);
const upload = (who: string, buf: Buffer, name = 'orders.csv') =>
  request(app).post('/api/orders/upload').set(bearer(U[who].token)).attach('file', buf, name);
const orderCount = () => prismaBase.order.count({ where: { tenantId } });

beforeAll(async () => {
  tenantId = (await createTenant('Orders Import')).id;
  otherTenantId = (await createTenant('Orders Import Other')).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(otherTenantId);
  productId = (await prismaBase.product.create({ data: { sku: `IMP-${SUFFIX}`, name: 'Copybook Set', category: 'x', price: 50, stockQuantity: 500, tenantId } })).id;
  await prismaBase.product.create({ data: { sku: `OTH-${SUFFIX}`, name: 'Other Only Product', category: 'x', price: 10, stockQuantity: 50, tenantId: otherTenantId } });
  await mkUser('owner', 'super_admin');
  await mkUser('rep', 'sales_rep', 'Adwoa', 'Darko');
  await mkUser('agent', 'delivery_agent', 'Kofi', 'Mensah');
  await mkUser('otherRep', 'sales_rep');
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('42-row file: 40 ready, 2 bad', () => {
  const lines = [
    ...Array.from({ length: 36 }, () => line()),
    line({ status: 'confirmed' }),
    line({ status: 'cancelled' }),
    line({ status: 'delivered', date: '03/10/2026', rep: 'Adwoa Darko' }),
    line({ status: 'out_for_delivery' }),
    line({ region: 'Ashante' }), // bad: near match
    line({ phone: '12345' }), // bad: phone too short
  ];
  const buf = file(lines);
  let deliveredPhone: string;
  deliveredPhone = lines[38].split(',')[1];

  it('validate gives the counts and the problems, and saves nothing', async () => {
    const before = { orders: await orderCount(), customers: await prismaBase.customer.count({ where: { tenantId } }) };
    const res = await validate('owner', buf);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fileName: 'orders.csv', total: 42, ready: 40, needFix: 2, duplicates: 0 });
    expect(res.body.readyRows).toHaveLength(40);
    expect(res.body.problems).toEqual([
      expect.objectContaining({ row: 42, problems: ['State "Ashante" is not in the list. Did you mean Ashanti?'] }),
      expect.objectContaining({ row: 43, problems: ['Phone must have 9 to 15 digits'] }),
    ]);
    expect(res.body.problemsCsv).toContain('problem');
    expect(res.body.problemsCsv).toContain('Did you mean Ashanti?');
    expect(await orderCount()).toBe(before.orders);
    expect(await prismaBase.customer.count({ where: { tenantId } })).toBe(before.customers);
    expect(await prismaBase.auditLog.count({ where: { tenantId, action: 'import_orders' } })).toBe(0);
  });

  it('import saves the 40 ready rows through the machine; the delivered row posts revenue once, even when the file is sent again', async () => {
    const before = await orderCount();
    const res = await upload('owner', buf);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 42, needFix: 2, results: { success: 40, failed: 0, duplicates: 0 } });
    expect(res.body.results.orderIds).toHaveLength(40);
    expect(res.body.problemsCsv).toContain('problem');
    expect(await orderCount()).toBe(before + 40);

    const delivered = await prismaBase.order.findFirstOrThrow({ where: { tenantId, customer: { phoneNumber: { endsWith: deliveredPhone.slice(1) } } }, include: { orderHistory: true } });
    expect(delivered).toMatchObject({ status: 'delivered', source: 'bulk_import', customerRepId: U.rep.id });
    expect(delivered.glJournalEntryId).not.toBeNull();
    expect(delivered.deliveryDate).toEqual(new Date(2026, 9, 3));
    expect(delivered.orderHistory.map((h) => h.status)).toEqual(expect.arrayContaining(['pending_confirmation', 'delivered']));
    expect(delivered.orderHistory.find((h) => h.status === 'delivered')).toMatchObject({ fromStatus: 'pending_confirmation', actorKind: 'integration', changedBy: U.owner.id });
    const revenue = () => prismaBase.journalEntry.count({ where: { tenantId, sourceType: 'order_delivery', sourceId: delivered.id } });
    expect(await revenue()).toBe(1);

    // the other statuses
    const statuses = await prismaBase.order.groupBy({ by: ['status'], where: { tenantId }, _count: true });
    const by = Object.fromEntries(statuses.map((s) => [s.status, s._count]));
    expect(by).toMatchObject({ pending_confirmation: 36, confirmed: 1, cancelled: 1, delivered: 1, out_for_delivery: 1 });

    // same file again: all 40 are duplicates, nothing new, revenue still once
    const again = await upload('owner', buf);
    expect(again.status).toBe(200);
    expect(again.body.results).toMatchObject({ success: 0, duplicates: 40 });
    expect(await orderCount()).toBe(before + 40);
    expect(await revenue()).toBe(1);

    // audit: one row per real import, with file name and counts
    const audits = await prismaBase.auditLog.findMany({ where: { tenantId, action: 'import_orders' }, orderBy: { id: 'asc' } });
    expect(audits[0]).toMatchObject({ userId: U.owner.id, resource: 'order' });
    expect(audits[0].metadata).toMatchObject({ fileName: 'orders.csv', rows: 42, ready: 40, needFix: 2, successful: 40, failed: 0 });
  });
});

describe('limits', () => {
  it('2,001 rows return the split message on validate and on import; saves nothing', async () => {
    const lines = Array.from({ length: 2001 }, (_, i) => `A B,0241${String(i).padStart(6, '0')},1 Road St,Ashanti,Copybook Set,1,10,,,`);
    const before = await orderCount();
    for (const send of [validate, upload]) {
      const res = await send('owner', file(lines));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('Split the file into parts of 2,000 rows.');
    }
    expect(await orderCount()).toBe(before);
  });

  it('a file over 10 MB is HTTP 413', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1024, 'a');
    expect((await validate('owner', big)).status).toBe(413);
    expect((await upload('owner', big)).status).toBe(413);
  });

  it('no file is 400; an unsupported type is 400', async () => {
    expect((await request(app).post('/api/orders/upload/validate').set(bearer(U.owner.token))).status).toBe(400);
    expect((await validate('owner', Buffer.from('x'), 'orders.txt')).status).toBe(400);
  });

  it('a user without orders:bulk_import gets 403 on both routes', async () => {
    expect((await validate('rep', file([line()]))).status).toBe(403);
    expect((await upload('rep', file([line()]))).status).toBe(403);
  });
});

describe('rejected rows and lookups', () => {
  it('payment_pending, payment_failed and digital_delivered rows are problems and are not imported', async () => {
    const buf = file(['payment_pending', 'payment_failed', 'digital_delivered'].map((status) => line({ status })));
    const before = await orderCount();
    const res = await upload('owner', buf);
    expect(res.status).toBe(400);
    expect(res.body.needFix).toBe(3);
    expect(res.body.problems.map((p: any) => p.problems[0])).toEqual([
      'Status payment_pending cannot be imported', 'Status payment_failed cannot be imported', 'Status digital_delivered cannot be imported',
    ]);
    expect(await orderCount()).toBe(before);
  });

  it('an unknown rep is a row problem; the other rows still import', async () => {
    const res = await upload('owner', file([line({ rep: 'Nobody Known' }), line({ rep: 'Adwoa Darko' })]));
    expect(res.status).toBe(200);
    expect(res.body.results.success).toBe(1);
    expect(res.body.problems).toEqual([expect.objectContaining({ problems: ['Call rep "Nobody Known" was not found'] })]);
  });

  it('a duplicate with a later status moves the existing order forward; one with the same status is skipped', async () => {
    const p = phone();
    const first = await upload('owner', file([line({ phone: p })]));
    expect(first.body.results.success).toBe(1);
    const id = first.body.results.orderIds[0];
    const before = await orderCount();

    const check = await validate('owner', file([line({ phone: p, status: 'confirmed' })]));
    expect(check.body.readyRows[0]).toMatchObject({ advancesOrderId: id });
    const advance = await upload('owner', file([line({ phone: p, status: 'confirmed' })]));
    expect(advance.body.results).toMatchObject({ success: 1, duplicates: 0, orderIds: [id] });
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).status).toBe('confirmed');

    const same = await validate('owner', file([line({ phone: p, status: 'confirmed' })]));
    expect(same.body).toMatchObject({ ready: 0, duplicates: 1 });
    expect(await orderCount()).toBe(before);
  });

  it('the same row twice in one file counts as one order and one duplicate', async () => {
    const l = line();
    const res = await validate('owner', file([l, l]));
    expect(res.body).toMatchObject({ total: 2, ready: 1, duplicates: 1 });
  });
});

describe('two tenants', () => {
  it('another tenant\'s product is not matched, and its order is not a duplicate', async () => {
    const p = phone();
    const otherCustomer = await prismaBase.customer.create({
      data: { firstName: 'Kofi', lastName: 'Other', phoneNumber: `+233${p.slice(1)}`, address: 'x', state: 'Ashanti', area: 'x', tenantId: otherTenantId },
    });
    await prismaBase.order.create({
      data: { customerId: otherCustomer.id, status: 'pending_confirmation', subtotal: 100, totalAmount: 100, codAmount: 100, tenantId: otherTenantId, deliveryAddress: `${p} Import Road` },
    });

    const res = await validate('owner', file([line({ phone: p }), line({ product: 'Other Only Product' })]));
    expect(res.body).toMatchObject({ total: 2, ready: 1, duplicates: 0, needFix: 1 });
    expect(res.body.problems[0].problems).toEqual(['Product "Other Only Product" was not found']);
  });
});
