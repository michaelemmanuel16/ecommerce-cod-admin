/**
 * M5-T17 (COD-49): CSV connector for partners (F-712): preview writes nothing, apply writes only the previewed rows through
 * the order status service, a row for another partner's order is flagged and not applied, bad rows give line numbers.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
let tenantId: string;
let otherTenantId: string;
let owner: { id: number; token: string };
let manager: { id: number; token: string };
let rep: { id: number; token: string };
let kofiId: number;
let esiId: number;
let customerId: number;
let phoneCustomerId: number;
const PHONE = `+2332${String(SUFFIX + 3).slice(-8)}`;

const mkOrder = async (partnerId: number | null, status: any, cust = customerId, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: { customerId: cust, status, subtotal: 200, totalAmount: 200, codAmount: 200, deliveryAgentId: partnerId, tenantId, ...extra } as any,
  })).id;
const orderOf = (id: number) => prismaBase.order.findUniqueOrThrow({ where: { id } });
const post = (token: string, partnerId: number, action: 'preview' | 'apply', body: Record<string, unknown>) =>
  request(app).post(`/api/delivery-partners/${partnerId}/csv/${action}`).set(bearer(token)).send(body);
const counts = async () => ({
  history: await prismaBase.orderHistory.count({ where: { order: { tenantId } } }),
  entries: await prismaBase.journalEntry.count({ where: { tenantId } }),
});

beforeAll(async () => {
  tenantId = (await createTenant('Partner Csv')).id;
  otherTenantId = (await createTenant('Partner Csv Other')).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(otherTenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  phoneCustomerId = (await prismaBase.customer.create({
    data: { firstName: 'Kojo', lastName: 'Asare', phoneNumber: PHONE, address: '4 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  owner = await mkUser(tenantId, 'cowner', 'super_admin');
  manager = await mkUser(tenantId, 'cmanager', 'manager');
  rep = await mkUser(tenantId, 'crep', 'sales_rep');
  kofiId = (await mkUser(tenantId, 'ckofi', 'delivery_agent', { kind: 'person' })).id;
  esiId = (await mkUser(tenantId, 'cesi', 'delivery_agent', { kind: 'person' })).id;
  await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: kofiId, outcome: 'delivered', amount: 25, validFrom: new Date('2026-01-01') } });
  await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: kofiId, outcome: 'failed', amount: 5, validFrom: new Date('2026-01-01') } });
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('preview and apply', () => {
  let a: number; let b: number; let c: number; let d: number; let e: number; let f: number; let foreign: number;
  let csv: string;
  let fileHash: string;

  beforeAll(async () => {
    [a, b, c] = [await mkOrder(kofiId, 'out_for_delivery'), await mkOrder(kofiId, 'out_for_delivery'), await mkOrder(kofiId, 'out_for_delivery', phoneCustomerId)];
    d = await mkOrder(esiId, 'out_for_delivery');
    e = await mkOrder(kofiId, 'delivered', customerId, { deliveryDate: new Date('2026-10-10T00:00:00Z') });
    f = await mkOrder(kofiId, 'confirmed');
    const other = (await prismaBase.customer.create({ data: { firstName: 'B', lastName: 'B', phoneNumber: `+2332${String(SUFFIX + 9).slice(-8)}`, address: 'x', state: 'x', area: 'x', tenantId: otherTenantId } })).id;
    foreign = (await prismaBase.order.create({ data: { customerId: other, status: 'out_for_delivery', subtotal: 200, totalAmount: 200, codAmount: 200, tenantId: otherTenantId } as any })).id;
    csv = [
      'Order Number,Phone,Status,Date,Reason,Cash collected',
      `#${a},,Delivered,2026-10-20,,200`,          // line 2: changes
      `${b},,Failed,,Not reachable,`,                // line 3: changes
      `,${PHONE},delivered,21/10/2026,,150`,         // line 4: by phone, changes, cash differs
      `${d},,delivered,2026-10-20,,`,                // line 5: another partner's order, flagged
      `${e},,delivered,2026-10-10,,`,                // line 6: already delivered, unchanged
      `${f},,delivered,2026-10-20,,`,                // line 7: confirmed cannot be delivered, rejected
      `${foreign},,delivered,2026-10-20,,`,          // line 8: other tenant, not found
      `${a},,delivered,2026-10-20,,`,                // line 9: order listed twice, rejected
      '777777,,shipped,,,',                          // line 10: bad status
    ].join('\n');
  });

  it('preview shows matched, changed, flagged and rejected rows, with line numbers, and writes nothing', async () => {
    const before = await counts();
    const res = await post(owner.token, kofiId, 'preview', { csv });
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ rows: 9, matched: 4, changed: 3, unchanged: 1, flagged: 1, rejected: 4 });
    const byLine = Object.fromEntries(res.body.rows.map((r: any) => [r.line, r]));
    expect(byLine[2]).toMatchObject({ result: 'changed', orderId: a, currentStatus: 'out_for_delivery', status: 'delivered', date: '2026-10-20' });
    expect(byLine[3]).toMatchObject({ result: 'changed', orderId: b, status: 'failed_delivery' });
    expect(byLine[4]).toMatchObject({ result: 'changed', orderId: c, date: '2026-10-21' });
    expect(byLine[4].warnings).toEqual(['Cash collected 150.00 differs from the order amount 200.00']);
    expect(byLine[5]).toMatchObject({ result: 'flagged', message: 'This order is assigned to another delivery partner' });
    expect(byLine[6]).toMatchObject({ result: 'unchanged', orderId: e });
    expect(byLine[7]).toMatchObject({ result: 'rejected', orderId: f });
    expect(byLine[7].message).toMatch(/confirmed and cannot move to delivered/);
    expect(byLine[8]).toMatchObject({ result: 'rejected', message: `Order ${foreign} was not found` });
    expect(byLine[9]).toMatchObject({ result: 'rejected', message: `#${a} is also on line 2` });
    expect(byLine[10]).toMatchObject({ result: 'rejected', message: expect.stringContaining('"shipped"') });
    fileHash = res.body.fileHash;

    // no write
    expect(await counts()).toEqual(before);
    expect((await orderOf(a)).status).toBe('out_for_delivery');
  });

  it('apply refuses a file that was not previewed or changed after the preview', async () => {
    expect((await post(owner.token, kofiId, 'apply', { csv })).status).toBe(409);
    expect((await post(owner.token, kofiId, 'apply', { csv, fileHash: 'abc' })).status).toBe(409);
    expect((await post(owner.token, kofiId, 'apply', { csv: `${csv}\n${c},,delivered,,,`, fileHash })).status).toBe(409);
    expect((await orderOf(a)).status).toBe('out_for_delivery');
  });

  it('apply writes only the changed rows, through the order status service', async () => {
    const res = await post(owner.token, kofiId, 'apply', { csv, fileHash });
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ rows: 9, applied: 3, skipped: 6, failed: 0 });
    expect(res.body.applied.map((r: any) => r.orderId)).toEqual([a, b, c]);

    const [oa, ob, oc] = [await orderOf(a), await orderOf(b), await orderOf(c)];
    expect(oa.status).toBe('delivered');
    expect(oa.deliveryDate?.toISOString().slice(0, 10)).toBe('2026-10-20');
    expect(Number(oa.deliveryFee)).toBe(25); // stamped by the state machine: fees follow the normal path
    expect(ob).toMatchObject({ status: 'failed_delivery', failureReason: 'not_reachable' });
    expect(Number(ob.deliveryFee)).toBe(5);
    expect(oc.status).toBe('delivered');
    expect(oc.deliveryDate?.toISOString().slice(0, 10)).toBe('2026-10-21');
    // revenue and the fee are in the ledger
    expect(await prismaBase.journalEntry.count({ where: { tenantId, sourceType: 'order_delivery', sourceId: a } })).toBe(1);
    expect(await prismaBase.journalEntry.count({ where: { tenantId, sourceType: 'delivery_fee', sourceId: a } })).toBe(1);

    // the other partner's order, the confirmed order and the other tenant's order were not touched
    expect((await orderOf(d)).status).toBe('out_for_delivery');
    expect((await orderOf(f)).status).toBe('confirmed');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: foreign } })).status).toBe('out_for_delivery');

    // failures: flagged and rejected rows with their line numbers
    const lines = res.body.failuresCsv.split('\n');
    expect(lines[0]).toBe('line,order,phone,status,error');
    expect(lines.slice(1).map((l: string) => l.split(',')[0])).toEqual(['5', '7', '8', '9', '10']);
  });

  it('applying the same file again changes nothing', async () => {
    const before = await counts();
    const res = await post(owner.token, kofiId, 'apply', { csv, fileHash });
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ applied: 0, failed: 0 });
    expect(await counts()).toEqual(before);
  });

  it('an order that moved after the preview is skipped, not forced', async () => {
    const x = await mkOrder(kofiId, 'out_for_delivery');
    const text = `order,status\n${x},delivered`;
    const preview = await post(owner.token, kofiId, 'preview', { csv: text });
    expect(preview.body.totals.changed).toBe(1);
    await prismaBase.order.update({ where: { id: x }, data: { status: 'returned' } });
    const res = await post(owner.token, kofiId, 'apply', { csv: text, fileHash: preview.body.fileHash });
    expect(res.body.totals).toMatchObject({ applied: 0, skipped: 1 });
    expect((await orderOf(x)).status).toBe('returned');
  });
});

describe('limits, files and access', () => {
  it('rejects a file over 2,000 rows, an empty file and a file with no status column', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => `${i + 1},delivered`).join('\n');
    const big = await post(owner.token, kofiId, 'preview', { csv: `order,status\n${rows}` });
    expect(big.status).toBe(400);
    expect(big.body.error).toMatch(/limit is 2000/);
    expect((await post(owner.token, kofiId, 'preview', { csv: '' })).status).toBe(400);
    const noStatus = await post(owner.token, kofiId, 'preview', { csv: 'order,date\n1,2026-10-20' });
    expect(noStatus.status).toBe(400);
    expect(noStatus.body.error).toMatch(/"status" column/);
  });

  it('is for owner, admin and manager, and for a partner of this tenant', async () => {
    const csv = 'order,status\n1,delivered';
    expect((await post(manager.token, kofiId, 'preview', { csv })).status).toBe(200);
    expect((await post(rep.token, kofiId, 'preview', { csv })).status).toBe(403);
    expect((await post(rep.token, kofiId, 'apply', { csv, fileHash: 'x' })).status).toBe(403);
    expect((await post(owner.token, rep.id, 'preview', { csv })).status).toBe(404);
    expect((await request(app).post(`/api/delivery-partners/${kofiId}/csv/preview`).send({ csv })).status).toBe(401);
  });
});
