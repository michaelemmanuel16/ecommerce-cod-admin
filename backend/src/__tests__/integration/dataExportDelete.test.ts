/**
 * M3-T24 (COD-24): export my data (ZIP of CSV files) and delete account hardening.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import bcrypt from 'bcrypt';
import zlib from 'zlib';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { auditService } from '../../services/auditService';
import { createTwoTenants, createTenant, deleteTenantRows, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const PASSWORD = 'Passw0rd!del';
let pair: TwoTenants;
let ownerA: { id: number; token: string };
let ownerB: { id: number; token: string };
let myOrderId: number;
let otherOrderId: number;
const extraTenantIds: string[] = [];

/** Reads a ZIP buffer: central directory, then each entry inflated. Enough for archiver output. */
function unzip(buf: Buffer): Record<string, string> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const download = async (token: string) => {
  const res = await request(app).get('/api/users/me/export').set(bearer(token))
    .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
  return { res, files: res.status === 200 ? unzip(res.body as Buffer) : {} };
};

async function mkOwner(tenantId: string, label: string) {
  const u = await prismaBase.user.create({
    data: { email: `exp-${label}-${SUFFIX}@codadmin.test`, password: await bcrypt.hash(PASSWORD, 4), firstName: `Owner${label}`, lastName: 'T', role: 'super_admin', tenantId },
  });
  return { id: u.id, email: u.email, token: generateAccessToken({ id: u.id, email: u.email, role: 'super_admin', tenantId }) };
}

beforeAll(async () => {
  pair = await createTwoTenants('expdel');
  ownerA = await mkOwner(pair.a.id, 'a');
  ownerB = await mkOwner(pair.b.id, 'b');
  const mkOrder = (createdById: number, tenantId: string, customerId: number, note: string) =>
    prismaBase.order.create({
      data: { customerId, createdById, status: 'pending_confirmation', subtotal: '10', shippingCost: 0, totalAmount: '10', codAmount: '10', deliveryAddress: 'x', deliveryState: 'x', deliveryArea: 'x', notes: note, tenantId },
    });
  const custA = await prismaBase.customer.findFirstOrThrow({ where: { tenantId: pair.a.id } });
  const custB = await prismaBase.customer.findFirstOrThrow({ where: { tenantId: pair.b.id } });
  myOrderId = (await mkOrder(pair.a.users.salesRep.id, pair.a.id, custA.id, `mine-${SUFFIX}`)).id;
  otherOrderId = (await mkOrder(ownerA.id, pair.a.id, custA.id, `other-${SUFFIX}`)).id;
  await mkOrder(pair.b.users.salesRep.id, pair.b.id, custB.id, `b-${SUFFIX}`);
}, 120_000);

afterAll(async () => {
  await prismaBase.order.deleteMany({ where: { notes: { in: [`mine-${SUFFIX}`, `other-${SUFFIX}`, `b-${SUFFIX}`] } } });
  await prismaBase.user.deleteMany({ where: { email: { startsWith: 'exp-' }, tenantId: { in: [pair.a.id, pair.b.id, ...extraTenantIds] } } });
  await prismaBase.plan.deleteMany({ where: { name: `paid-${SUFFIX}` } }).catch(() => undefined);
  await pair.cleanup();
  if (extraTenantIds.length) await deleteTenantRows(extraTenantIds);
  await prismaBase.$disconnect();
});

describe('GET /api/users/me/export', () => {
  it('a sales rep gets only their own files and rows, no business tables, nothing of the other tenant', async () => {
    const { res, files } = await download(pair.a.users.salesRep.token);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(Object.keys(files).sort()).toEqual(['calls.csv', 'notifications.csv', 'orders-created.csv', 'payouts.csv', 'profile.csv', 'sessions.csv']);

    expect(files['profile.csv']).toContain(pair.a.users.salesRep.email);
    expect(files['profile.csv']).not.toContain(pair.a.users.admin.email);
    expect(files['payouts.csv']).toContain('20.00');
    expect(files['calls.csv']).toContain('confirmed');
    // only the orders this person created
    const orders = files['orders-created.csv'].trim().split('\r\n');
    expect(orders).toHaveLength(2);
    expect(orders[1].split(',')[0]).toBe(String(myOrderId));
    expect(files['orders-created.csv']).not.toContain(`${otherOrderId},`);

    const all = Object.values(files).join('\n');
    expect(all).not.toContain(pair.b.marker);
    expect(all).not.toContain(pair.a.users.deliveryAgent.email);
    expect(all).not.toContain('password');
  });

  it('the owner also gets the business tables, tenant A rows only (two-tenant)', async () => {
    const { res, files } = await download(ownerA.token);
    expect(res.status).toBe(200);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'profile.csv', 'business/orders.csv', 'business/customers.csv', 'business/products.csv', 'business/expenses.csv', 'business/journal-entries.csv',
    ]));
    expect(files['business/customers.csv']).toContain(`Cust${pair.a.marker}`);
    expect(files['business/products.csv']).toContain(`SKU-${pair.a.marker}`);
    expect(files['business/orders.csv']).toContain(`${myOrderId},`);
    expect(files['business/journal-entries.csv']).toContain(`Sale ${pair.a.marker}`);
    const all = Object.values(files).join('\n');
    expect(all).not.toContain(pair.b.marker);
    expect(all).not.toContain(pair.b.users.admin.email);

    const b = await download(ownerB.token);
    const allB = Object.values(b.files).join('\n');
    expect(b.files['business/customers.csv']).toContain(`Cust${pair.b.marker}`);
    expect(allB).not.toContain(pair.a.marker);
    expect(b.files['business/orders.csv']).not.toContain(`${myOrderId},`);
  });

  it('an admin (not the owner) does not get business tables', async () => {
    const { files } = await download(pair.a.users.admin.token);
    expect(Object.keys(files).some((f) => f.startsWith('business/'))).toBe(false);
  });

  it('writes an audit row and needs a signed-in user', async () => {
    await download(ownerA.token);
    const rows = await prismaBase.auditLog.findMany({ where: { userId: ownerA.id, action: 'export_my_data' } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].tenantId).toBe(pair.a.id);
    expect((rows[0].metadata as any).scope).toBe('owner');
    expect((await request(app).get('/api/users/me/export')).status).toBe(401);
  });
});

describe('DELETE /api/auth/delete-account', () => {
  const del = (token: string, body: object) => request(app).delete('/api/auth/delete-account').set(bearer(token)).send(body);
  const tenantExists = async (id: string) => (await prismaBase.tenant.count({ where: { id } })) === 1;

  it('without the word DELETE (or with the wrong case) gives 400 and deletes nothing', async () => {
    const owner = await mkOwner(pair.a.id, 'del1');
    expect((await del(owner.token, { password: PASSWORD })).status).toBe(400);
    expect((await del(owner.token, { password: PASSWORD, confirm: 'delete' })).status).toBe(400);
    expect((await del(owner.token, { confirm: 'DELETE' })).status).toBe(400);
    expect(await tenantExists(pair.a.id)).toBe(true);
  });

  it('a wrong password gives 401, and the 6th failed try gives 429', async () => {
    const owner = await mkOwner(pair.a.id, 'del2');
    for (let i = 0; i < 5; i++) expect((await del(owner.token, { password: 'wrong-Pass1!', confirm: 'DELETE' })).status).toBe(401);
    expect((await del(owner.token, { password: PASSWORD, confirm: 'DELETE' })).status).toBe(429);
    expect(await tenantExists(pair.a.id)).toBe(true);
  });

  it('only the owner can delete', async () => {
    expect((await del(pair.a.users.admin.token, { password: PASSWORD, confirm: 'DELETE' })).status).toBe(403);
  });

  it('an active paid subscription blocks it', async () => {
    const plan = await prismaBase.plan.create({ data: { name: `paid-${SUFFIX}`, displayName: 'Paid', priceGHS: '100' } });
    const t = await createTenant('DelPaid');
    extraTenantIds.push(t.id);
    await prismaBase.tenant.update({ where: { id: t.id }, data: { currentPlanId: plan.id, subscriptionStatus: 'active' } });
    const owner = await mkOwner(t.id, 'paid');
    const res = await del(owner.token, { password: PASSWORD, confirm: 'DELETE' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SUBSCRIPTION_ACTIVE');
    expect(await tenantExists(t.id)).toBe(true);

    // once cancelled it goes through
    await prismaBase.tenant.update({ where: { id: t.id }, data: { subscriptionStatus: 'cancelled' } });
    expect((await del(owner.token, { password: PASSWORD, confirm: 'DELETE' })).status).toBe(200);
    expect(await tenantExists(t.id)).toBe(false);
  });

  it('writes the audit row first, then removes only this tenant\'s rows', async () => {
    const t = await createTenant('DelOk');
    extraTenantIds.push(t.id);
    const owner = await mkOwner(t.id, 'ok');
    await prismaBase.customer.create({ data: { firstName: 'Del', lastName: 'Me', phoneNumber: '+233245550199', address: 'x', state: 'x', area: 'x', tenantId: t.id } });
    const before = {
      customersA: await prismaBase.customer.count({ where: { tenantId: pair.a.id } }),
      usersB: await prismaBase.user.count({ where: { tenantId: pair.b.id } }),
    };

    const original = auditService.record.bind(auditService);
    let tenantExistedAtAudit: boolean | undefined;
    let action: string | undefined;
    jest.spyOn(auditService, 'record').mockImplementation(async (p: any) => {
      action = p.action;
      tenantExistedAtAudit = await tenantExists(t.id);
      return original(p);
    });

    const res = await del(owner.token, { password: PASSWORD, confirm: 'DELETE' });
    expect(res.status).toBe(200);
    expect(action).toBe('delete_account');
    expect(tenantExistedAtAudit).toBe(true); // audit came before the delete

    expect(await tenantExists(t.id)).toBe(false);
    expect(await prismaBase.user.count({ where: { id: owner.id } })).toBe(0);
    expect(await prismaBase.customer.count({ where: { tenantId: pair.a.id } })).toBe(before.customersA);
    expect(await prismaBase.user.count({ where: { tenantId: pair.b.id } })).toBe(before.usersB);
  });

  it('if the audit row cannot be written, nothing is deleted', async () => {
    const t = await createTenant('DelAuditFail');
    extraTenantIds.push(t.id);
    const owner = await mkOwner(t.id, 'af');
    jest.spyOn(auditService, 'record').mockRejectedValue(new Error('audit down'));
    const res = await del(owner.token, { password: PASSWORD, confirm: 'DELETE' });
    expect(res.status).toBe(500);
    expect(await tenantExists(t.id)).toBe(true);
  });
});
