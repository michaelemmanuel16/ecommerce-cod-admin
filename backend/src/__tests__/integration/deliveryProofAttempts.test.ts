/**
 * M4-T20 (COD-42): delivery attempts written by the state machine, and the proof block with a signed photo link.
 * One throwaway tenant on the test DB.
 */
import { jest, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { transitionOrder, actorOf } from '../../services/orderStateMachine';
import { signedProofPhotoUrl, PROOF_LINK_TTL_SECONDS } from '../../services/deliveryProofService';
import { uploadDir } from '../../config/multer';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let tenantId: string;
let otherTenantId: string;
let customerId: number;
const U: Record<string, { id: number; email: string; token: string }> = {};
const files: string[] = [];

const mkUser = async (label: string, role: any) => {
  const u = await prismaBase.user.create({
    data: { email: `dpa-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'A', role, tenantId },
  });
  U[label] = { id: u.id, email: u.email, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId }) };
};
const mkOrder = async (status: string, agent: number | null = U.agent.id, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: {
      customerId, status, subtotal: 249, totalAmount: 249, codAmount: 249, tenantId,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
      ...(agent ? { deliveryAgentId: agent } : {}), ...extra,
    } as any,
  })).id;
const admin = () => actorOf({ id: U.admin.id, role: 'admin' } as any);
const move = (orderId: number, to: any, opts: Record<string, unknown> = {}, who = admin()) =>
  runInTenant(tenantId, () => transitionOrder(orderId, to, who, { skipLegacyStock: true, ...opts }));
const attempts = (orderId: number) => prismaBase.deliveryAttempt.findMany({ where: { orderId }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  tenantId = (await createTenant('Proof Attempts')).id;
  otherTenantId = (await createTenant('Proof Attempts Other')).id;
  await seedTenantDefaults(tenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  for (const [label, role] of [['admin', 'admin'], ['manager', 'manager'], ['acct', 'accountant'], ['stock', 'inventory_manager'], ['rep', 'sales_rep'], ['agent', 'delivery_agent'], ['agent2', 'delivery_agent']] as const) {
    await mkUser(label, role);
  }
}, 60_000);

afterEach(() => {
  delete process.env.R2_PUBLIC_URL;
});

afterAll(async () => {
  for (const f of files) fs.rmSync(f, { force: true });
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('DeliveryAttempt rows from the state machine (F-713)', () => {
  it('a move to failed_delivery writes exactly one attempt, with partner, reason, note and time', async () => {
    const orderId = await mkOrder('out_for_delivery');
    const delivery = await prismaBase.delivery.create({ data: { tenantId, orderId, agentId: U.agent.id } });
    const before = Date.now();
    const r = await move(orderId, 'failed_delivery', { failureReason: 'not_reachable', note: 'Phone off' });
    r.afterCommit?.();
    expect(r.changed).toBe(true);
    const rows = await attempts(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId, orderId, partnerUserId: U.agent.id, reason: 'not_reachable', note: 'Phone off' });
    expect(rows[0].attemptedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect((await prismaBase.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).deliveryAttempts).toBe(1);
  });

  it('a repeated call changes nothing and adds no second row', async () => {
    const orderId = await mkOrder('out_for_delivery');
    await move(orderId, 'failed_delivery', { failureReason: 'refused' });
    const again = await move(orderId, 'failed_delivery', { failureReason: 'refused' });
    expect(again.changed).toBe(false);
    expect(await attempts(orderId)).toHaveLength(1);
  });

  it('fail, send out again, fail again: two rows; then delivered adds none', async () => {
    const orderId = await mkOrder('out_for_delivery');
    await prismaBase.delivery.create({ data: { tenantId, orderId, agentId: U.agent.id } });
    await move(orderId, 'failed_delivery', { failureReason: 'not_reachable' });
    await move(orderId, 'out_for_delivery');
    await move(orderId, 'failed_delivery', { failureReason: 'rescheduled', note: 'Call back Friday' });
    expect((await attempts(orderId)).map((a) => a.reason)).toEqual(['not_reachable', 'rescheduled']);
    await move(orderId, 'out_for_delivery');
    await move(orderId, 'delivered', { paymentStatus: 'collected' });
    expect(await attempts(orderId)).toHaveLength(2);
    expect((await prismaBase.delivery.findUniqueOrThrow({ where: { orderId } })).deliveryAttempts).toBe(2);
  });

  it('an order with no partner has nobody to record against: no row, and the move still works', async () => {
    const orderId = await mkOrder('confirmed', null);
    const r = await move(orderId, 'failed_delivery', {}, { kind: 'integration' });
    expect(r.changed).toBe(true);
    expect(await attempts(orderId)).toHaveLength(0);
  });

  it('writes no row for other moves', async () => {
    const orderId = await mkOrder('out_for_delivery');
    await move(orderId, 'returned');
    expect(await attempts(orderId)).toHaveLength(0);
  });

  it('is part of the move transaction: a rollback leaves no row and no status change', async () => {
    const orderId = await mkOrder('out_for_delivery');
    await expect(runInTenant(tenantId, () => prisma.$transaction(async (tx) => {
      await transitionOrder(orderId, 'failed_delivery', admin(), { skipLegacyStock: true, failureReason: 'refused', tx });
      expect(await tx.deliveryAttempt.count({ where: { orderId } })).toBe(1);
      throw new Error('rollback');
    }))).rejects.toThrow('rollback');
    expect(await attempts(orderId)).toHaveLength(0);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('out_for_delivery');
  });

  it('through the order status route: one row', async () => {
    const orderId = await mkOrder('out_for_delivery');
    const res = await request(app).patch(`/api/orders/${orderId}/status`).set(bearer(U.admin.token))
      .send({ status: 'failed_delivery', failureReason: 'wrong_address', note: 'No such house' });
    expect(res.status).toBe(200);
    const rows = await attempts(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'wrong_address', note: 'No such house', partnerUserId: U.agent.id });
  });
});

describe('GET /api/deliveries/by-order/:orderId (F-711, F-713)', () => {
  const byOrder = (who: string, orderId: number) => request(app).get(`/api/deliveries/by-order/${orderId}`).set(bearer(U[who].token));
  let orderId: number;
  let deliveryId: number;
  let photo: string;

  beforeAll(async () => {
    orderId = await mkOrder('out_for_delivery');
    photo = `proof-${SUFFIX}.png`;
    const file = path.join(uploadDir, photo);
    fs.writeFileSync(file, Buffer.from('89504e470d0a1a0a', 'hex'));
    files.push(file);
    deliveryId = (await prismaBase.delivery.create({ data: { tenantId, orderId, agentId: U.agent.id } })).id;
    await move(orderId, 'failed_delivery', { failureReason: 'not_reachable' });
    await move(orderId, 'out_for_delivery');
    await move(orderId, 'failed_delivery', { failureReason: 'refused', note: 'Brother refused' });
    await move(orderId, 'out_for_delivery');
    await prismaBase.delivery.update({
      where: { id: deliveryId },
      data: { proofType: 'photo', proofImageUrl: `/uploads/${photo}`, recipientName: 'Yaw Boateng', recipientPhone: '+233200000000', actualDeliveryTime: new Date('2026-10-20T10:30:00Z') },
    });
    await prismaBase.transaction.create({
      data: { tenantId, orderId, type: 'cod_collection', amount: '249', paymentMethod: 'cash', status: 'collected' },
    });
  });

  it('admin roles get recipient, time, cash, a signed photo link and the attempts', async () => {
    for (const who of ['admin', 'manager', 'acct']) {
      const res = await byOrder(who, orderId);
      expect([who, res.status]).toEqual([who, 200]);
      expect(res.body.proof).toMatchObject({
        recorded: true, proofType: 'photo', recipientName: 'Yaw Boateng', recipientPhone: '+233200000000',
        time: '2026-10-20T10:30:00.000Z', cashCollected: '249.00',
      });
      expect(res.body.proof.photoUrl).toMatch(new RegExp(`^/api/deliveries/proof-photo/${deliveryId}\\?t=${tenantId}&exp=\\d+&sig=[0-9a-f]{64}$`));
      expect(res.body.delivery.proofImageUrl).toBeNull(); // the stored address is not sent to admin roles
      expect(JSON.stringify(res.body)).not.toContain(photo);
      expect(res.body.attempts.map((a: any) => [a.reason, a.note, a.partner.id])).toEqual([
        ['not_reachable', null, U.agent.id], ['refused', 'Brother refused', U.agent.id],
      ]);
    }
  });

  it('the link carries a ten minute expiry', async () => {
    const res = await byOrder('admin', orderId);
    const exp = Number(new URL(res.body.proof.photoUrl, 'http://x').searchParams.get('exp'));
    const left = exp - Math.floor(Date.now() / 1000);
    expect(PROOF_LINK_TTL_SECONDS).toBe(600);
    expect(left).toBeGreaterThan(590);
    expect(left).toBeLessThanOrEqual(600);
  });

  it('the photo loads over the link with no bearer token', async () => {
    const res = await byOrder('admin', orderId);
    const photoRes = await request(app).get(res.body.proof.photoUrl);
    expect(photoRes.status).toBe(200);
    expect(photoRes.headers['content-type']).toMatch(/image\/png/);
    expect(photoRes.headers['cache-control']).toContain('no-store');
  });

  it('an expired link is 403, a link that expires in the future is 200', async () => {
    const delivery = { id: deliveryId, tenantId };
    const old = signedProofPhotoUrl(delivery, Date.now() - (PROOF_LINK_TTL_SECONDS + 5) * 1000);
    expect((await request(app).get(old)).status).toBe(403);
    const almost = signedProofPhotoUrl(delivery, Date.now() - (PROOF_LINK_TTL_SECONDS - 30) * 1000);
    expect((await request(app).get(almost)).status).toBe(200);
  });

  it('a changed expiry, signature, delivery or tenant is 403', async () => {
    const url = new URL(signedProofPhotoUrl({ id: deliveryId, tenantId }), 'http://x');
    const get = (mutate: (u: URL) => void, id = deliveryId) => {
      const u = new URL(url.toString());
      mutate(u);
      return request(app).get(`/api/deliveries/proof-photo/${id}${u.search}`);
    };
    expect((await get(() => undefined)).status).toBe(200);
    expect((await get((u) => u.searchParams.set('exp', String(Number(u.searchParams.get('exp')) + 3600)))).status).toBe(403);
    expect((await get((u) => u.searchParams.set('sig', '0'.repeat(64)))).status).toBe(403);
    expect((await get((u) => u.searchParams.delete('sig'))).status).toBe(403);
    expect((await get((u) => u.searchParams.set('sig', 'zz'))).status).toBe(403);
    expect((await get((u) => u.searchParams.set('t', otherTenantId))).status).toBe(403);
    expect((await get(() => undefined, deliveryId + 1)).status).toBe(403);
    expect((await request(app).get(`/api/deliveries/proof-photo/abc${url.search}`)).status).toBe(403);
  });

  it('an object-storage address redirects only when it is on our storage host; anything else is 404', async () => {
    const link = () => signedProofPhotoUrl({ id: deliveryId, tenantId });
    process.env.R2_PUBLIC_URL = 'https://img.proof-test.example';
    await prismaBase.delivery.update({ where: { id: deliveryId }, data: { proofImageUrl: 'https://img.proof-test.example/products/x/proof.png' } });
    const ok = await request(app).get(link()).redirects(0);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe('https://img.proof-test.example/products/x/proof.png');
    await prismaBase.delivery.update({ where: { id: deliveryId }, data: { proofImageUrl: 'https://evil.example/x.png' } });
    expect((await request(app).get(link()).redirects(0)).status).toBe(404);
    await prismaBase.delivery.update({ where: { id: deliveryId }, data: { proofImageUrl: '/uploads/does-not-exist.png' } });
    expect((await request(app).get(link())).status).toBe(404);
    await prismaBase.delivery.update({ where: { id: deliveryId }, data: { proofImageUrl: null } });
    expect((await request(app).get(link())).status).toBe(404);
    await prismaBase.delivery.update({ where: { id: deliveryId }, data: { proofImageUrl: `/uploads/${photo}` } });
  });

  it('the assigned agent reads their own order; another agent gets 404', async () => {
    const own = await byOrder('agent', orderId);
    expect(own.status).toBe(200);
    expect(own.body.delivery.proofImageUrl).toBe(`/uploads/${photo}`); // the agent app keeps what it had
    expect(own.body.attempts).toHaveLength(2);
    expect((await byOrder('agent2', orderId)).status).toBe(404);
  });

  it('a sales rep and a stock keeper are refused; an order that does not exist is 404', async () => {
    expect((await byOrder('rep', orderId)).status).toBe(403);
    expect((await byOrder('stock', orderId)).status).toBe(403);
    expect((await byOrder('admin', 99999999)).status).toBe(404);
  });

  it('an order with no delivery row says "No proof recorded"', async () => {
    const bare = await mkOrder('confirmed');
    const res = await byOrder('admin', bare);
    expect(res.status).toBe(200);
    expect(res.body.proof).toEqual({
      recorded: false, proofType: null, recipientName: null, recipientPhone: null, time: null, cashCollected: null, photoUrl: null,
    });
    expect(res.body.attempts).toEqual([]);
  });
});

describe('dead delivery code is gone (M4-T20)', () => {
  const read = (file: string) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

  it('deliveryService has none of the four methods or getAgentRoute; the route is not mounted', () => {
    const service = read('services/deliveryService.ts');
    for (const name of ['markDeliveryFailed', 'createDelivery', 'autoAssignAgent', 'getAgentStats', 'getAgentRoute']) expect(service).not.toContain(name);
    expect(read('routes/deliveryRoutes.ts')).not.toContain('routes/:agentId');
    expect(read('controllers/deliveryController.ts')).not.toContain('getAgentRoute');
  });

  it('agentReconciliationController.getAgentStats is a different method and stays', () => {
    expect(read('controllers/agentReconciliationController.ts')).toContain('getAgentStats');
  });
});
