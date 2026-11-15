/** M9-T35 (COD-83): GET and PUT /api/messages/opt-outs, the list behind the Opt-outs tab. */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = String(Date.now()).slice(-7);
let tenantA: string;
let tenantB: string;
let owner: { id: number; token: string };
let manager: { id: number; token: string };
let rep: { id: number; token: string };
let ownerB: { id: number; token: string };
let ama: number;
let kofi: number;
const AMA_PHONE = `+23324${SUFFIX}`;
const KOFI_PHONE = `+23355${SUFFIX}`;
const BARE_PHONE = `+23327${SUFFIX}`;

const mkCustomer = (tenantId: string, extra: Record<string, unknown>) => prismaBase.customer.create({
  data: { lastName: 'Test', address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId, ...extra } as any,
});

beforeAll(async () => {
  tenantA = (await createTenant('OptList A')).id;
  tenantB = (await createTenant('OptList B')).id;
  owner = await mkUser(tenantA, 'ownerl', 'super_admin');
  manager = await mkUser(tenantA, 'managerl', 'manager');
  rep = await mkUser(tenantA, 'repl', 'sales_rep');
  ownerB = await mkUser(tenantB, 'ownerlb', 'super_admin');
  ama = (await mkCustomer(tenantA, { firstName: 'Ama', phoneNumber: AMA_PHONE, smsOptOut: true })).id;
  kofi = (await mkCustomer(tenantA, { firstName: 'Kofi', phoneNumber: KOFI_PHONE, whatsappOptOut: true, emailOptOut: true, email: `kofi-${SUFFIX}@x.test` })).id;
  await mkCustomer(tenantA, { firstName: 'Yaa', phoneNumber: `+23320${SUFFIX}` });
  await mkCustomer(tenantB, { firstName: 'Other', phoneNumber: `+23326${SUFFIX}`, smsOptOut: true });
});
afterAll(async () => {
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.$disconnect();
});

const get = (token: string, query = '') => request(app).get(`/api/messages/opt-outs${query}`).set(bearer(token));
const put = (token: string, body: object) => request(app).put('/api/messages/opt-outs').set(bearer(token)).send(body);

describe('GET /api/messages/opt-outs', () => {
  it('lists one row for each customer and channel they are opted out of, only for this tenant', async () => {
    const res = await get(owner.token);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const pairs = res.body.items.map((r: any) => `${r.name}:${r.channel}`).sort();
    expect(pairs).toEqual(['Ama Test:sms', 'Kofi Test:email', 'Kofi Test:whatsapp']);
  });

  it('filters by channel and searches by name or phone digits', async () => {
    expect((await get(owner.token, '?channel=whatsapp')).body.items.map((r: any) => r.name)).toEqual(['Kofi Test']);
    expect((await get(owner.token, '?q=ama')).body.total).toBe(1);
    expect((await get(owner.token, `?q=${AMA_PHONE.slice(-6)}`)).body.items[0].customerId).toBe(ama);
    // typed the local way
    expect((await get(owner.token, `?q=0${AMA_PHONE.slice(4)}`)).body.items[0].customerId).toBe(ama);
  });

  it('a manager can read, a rep cannot', async () => {
    expect((await get(manager.token)).status).toBe(200);
    expect((await get(rep.token)).status).toBe(403);
  });
});

describe('PUT /api/messages/opt-outs', () => {
  it('adds a phone nobody has: it is listed, with an event that names the actor', async () => {
    const res = await put(owner.token, { channel: 'sms', optedOut: true, phone: `0${BARE_PHONE.slice(4)}` });
    expect(res.status).toBe(200);
    expect(res.body.customers).toBe(0);
    const row = (await get(owner.token, '?channel=sms')).body.items.find((r: any) => r.phone === BARE_PHONE);
    expect(row).toMatchObject({ customerId: null, name: null, reason: 'staff' });
    const ev = await prismaBase.optOutEvent.findFirstOrThrow({ where: { tenantId: tenantA, phone: BARE_PHONE } });
    expect(ev).toMatchObject({ channel: 'sms', optedOut: true, reason: 'staff', actorId: owner.id, customerId: null });
  });

  it('removes a phone-only opt-out: it leaves the list and a resubscribe event is written', async () => {
    const res = await put(owner.token, { channel: 'sms', optedOut: false, phone: BARE_PHONE });
    expect(res.status).toBe(200);
    expect((await get(owner.token, '?channel=sms')).body.items.some((r: any) => r.phone === BARE_PHONE)).toBe(false);
    expect(await prismaBase.optOutEvent.count({ where: { tenantId: tenantA, phone: BARE_PHONE } })).toBe(2);
  });

  it('removes a customer opt-out: the flag clears and the event is written', async () => {
    const res = await put(owner.token, { channel: 'sms', optedOut: false, phone: AMA_PHONE });
    expect(res.body.customers).toBe(1);
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: ama } })).smsOptOut).toBe(false);
    expect(await prismaBase.optOutEvent.count({ where: { tenantId: tenantA, customerId: ama, optedOut: false, reason: 'staff' } })).toBe(1);
    expect((await get(owner.token)).body.total).toBe(2);
  });

  it('removes an email opt-out by address', async () => {
    const res = await put(owner.token, { channel: 'email', optedOut: false, email: `kofi-${SUFFIX}@x.test` });
    expect(res.status).toBe(200);
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: kofi } })).emailOptOut).toBe(false);
  });

  it('answers a bad phone with a plain sentence, and refuses a manager and another tenant', async () => {
    const bad = await put(owner.token, { channel: 'sms', optedOut: true, phone: '12' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('phone number is not valid');
    expect((await put(manager.token, { channel: 'sms', optedOut: true, phone: AMA_PHONE })).status).toBe(403);
    // tenant B's own list never shows tenant A rows
    expect((await get(ownerB.token)).body.items.map((r: any) => r.name)).toEqual(['Other Test']);
  });
});
