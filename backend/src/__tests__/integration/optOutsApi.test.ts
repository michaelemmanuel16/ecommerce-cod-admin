/** M9-T10 (COD-78): opt-out flags API, per-phone change, inbound STOP and START, unsubscribe page. */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { processInboundMessage } from '../../services/messaging/inbound';
import { runInTenant } from '../../utils/tenantContext';
import { whatsappCloudProvider } from '../../services/messaging/providers';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
const PHONE = `+23324${String(SUFFIX).slice(-7)}`;
let tenantA: string;
let tenantB: string;
let owner: { id: number; token: string };
let rep: { id: number; token: string };
let ownerB: { id: number; token: string };
let c1: number;
let c2: number;
let seq = 0;

const mkCustomer = (tenantId: string, extra: Record<string, unknown>) => prismaBase.customer.create({
  data: { firstName: 'Ama', lastName: 'M', address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId, ...extra } as any,
});

beforeAll(async () => {
  tenantA = (await createTenant('Opt A')).id;
  tenantB = (await createTenant('Opt B')).id;
  owner = await mkUser(tenantA, 'owner', 'super_admin');
  rep = await mkUser(tenantA, 'rep', 'sales_rep');
  ownerB = await mkUser(tenantB, 'ownerb', 'super_admin');
  c1 = (await mkCustomer(tenantA, { phoneNumber: PHONE, email: `a-${SUFFIX}@x.test` })).id;
  c2 = (await mkCustomer(tenantA, { phoneNumber: `+23355${String(SUFFIX).slice(-7)}`, alternatePhone: PHONE })).id;
});
afterAll(async () => {
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.$disconnect();
});
beforeEach(() => {
  jest.spyOn(whatsappCloudProvider, 'isEnabled').mockResolvedValue(true);
  jest.spyOn(whatsappCloudProvider, 'send').mockImplementation(async () => ({ accepted: true, providerMessageId: `wa-o-${SUFFIX}-${seq++}` }));
});

describe('/api/customers/:id/opt-outs', () => {
  it('PUT changes the flag of every customer with that phone and writes one staff event each, with the actor', async () => {
    const res = await request(app).put(`/api/customers/${c1}/opt-outs`).set(bearer(owner.token)).send({ channel: 'whatsapp', optedOut: true });
    expect(res.status).toBe(200);
    expect(res.body.flags).toEqual({ sms: false, whatsapp: true, email: false });
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: c2 } })).whatsappOptOut).toBe(true);
    const events = await prismaBase.optOutEvent.findMany({ where: { tenantId: tenantA, channel: 'whatsapp', reason: 'staff' } });
    expect(events.map((e) => e.customerId).sort()).toEqual([c1, c2].sort());
    expect(events.every((e) => e.actorId === owner.id && e.optedOut)).toBe(true);

    const get = await request(app).get(`/api/customers/${c1}/opt-outs`).set(bearer(rep.token));
    expect(get.status).toBe(200);
    expect(get.body.flags.whatsapp).toBe(true);
    expect(get.body.events[0]).toMatchObject({ channel: 'whatsapp', optedOut: true, reason: 'staff', actorId: owner.id });

    await request(app).put(`/api/customers/${c1}/opt-outs`).set(bearer(owner.token)).send({ channel: 'whatsapp', optedOut: false }).expect(200);
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: c2 } })).whatsappOptOut).toBe(false);
  });

  it('validates the body, and another tenant gets 404', async () => {
    expect((await request(app).put(`/api/customers/${c1}/opt-outs`).set(bearer(owner.token)).send({ channel: 'fax', optedOut: true })).status).toBe(400);
    expect((await request(app).get(`/api/customers/${c1}/opt-outs`).set(bearer(ownerB.token))).status).toBe(404);
    expect((await request(app).put(`/api/customers/${c1}/opt-outs`).set(bearer(ownerB.token)).send({ channel: 'sms', optedOut: true })).status).toBe(404);
  });
});

describe('inbound STOP and START go through the service', () => {
  const inbound = (text: string, n: number) => runInTenant(tenantA, () => processInboundMessage(tenantA, {
    providerMessageId: `wamid.opt.${SUFFIX}.${n}`, from: PHONE.replace('+', ''), type: 'text', text, occurredAt: new Date(), raw: {},
  } as any));

  it('STOP opts out both customers with stop_reply events; START brings them back with resubscribe events', async () => {
    await inbound('STOP', 1);
    expect((await prismaBase.customer.findMany({ where: { id: { in: [c1, c2] } } })).every((c) => c.whatsappOptOut)).toBe(true);
    expect(await prismaBase.optOutEvent.count({ where: { tenantId: tenantA, reason: 'stop_reply', optedOut: true } })).toBe(2);
    await inbound('start', 2);
    expect((await prismaBase.customer.findMany({ where: { id: { in: [c1, c2] } } })).every((c) => !c.whatsappOptOut)).toBe(true);
    expect(await prismaBase.optOutEvent.count({ where: { tenantId: tenantA, reason: 'resubscribe', optedOut: false } })).toBe(2);
  });

  it('a STOP from a number no customer has still writes an event with no customer', async () => {
    const unknown = `23326${String(SUFFIX).slice(-7)}`;
    await runInTenant(tenantA, () => processInboundMessage(tenantA, { providerMessageId: `wamid.opt.${SUFFIX}.9`, from: unknown, type: 'text', text: 'Stop', occurredAt: new Date(), raw: {} } as any));
    expect(await prismaBase.optOutEvent.count({ where: { tenantId: tenantA, customerId: null, phone: `+${unknown}`, reason: 'stop_reply' } })).toBe(1);
  });
});

describe('unsubscribe page', () => {
  it('a valid token opts out email with an unsubscribe_link event; the channel named in the link goes too', async () => {
    const token = `tok-${SUFFIX}-1`;
    const c = await mkCustomer(tenantA, { phoneNumber: `+23327${String(SUFFIX).slice(-7)}`, email: `u-${SUFFIX}@x.test`, unsubscribeToken: token });
    const res = await request(app).post(`/api/public/unsubscribe/${token}?channel=sms`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('You are unsubscribed');
    expect(await prismaBase.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ emailOptOut: true, smsOptOut: true, whatsappOptOut: false });
    const events = await prismaBase.optOutEvent.findMany({ where: { customerId: c.id } });
    expect(events.map((e) => e.channel).sort()).toEqual(['email', 'sms']);
    expect(events.every((e) => e.reason === 'unsubscribe_link')).toBe(true);
    // a repeat (a mail scanner, a second click) writes nothing new
    await request(app).post(`/api/public/unsubscribe/${token}?channel=sms`).expect(200);
    expect(await prismaBase.optOutEvent.count({ where: { customerId: c.id } })).toBe(2);
  });

  it('a token of a deleted customer and an unknown token show the same page and leak nothing', async () => {
    const token = `tok-${SUFFIX}-2`;
    const c = await mkCustomer(tenantA, { phoneNumber: `+23329${String(SUFFIX).slice(-7)}`, firstName: 'Zainab', lastName: 'Secretname', unsubscribeToken: token });
    const live = await request(app).post(`/api/public/unsubscribe/${token}`);
    await prismaBase.customer.delete({ where: { id: c.id } });
    const gone = await request(app).post(`/api/public/unsubscribe/${token}`);
    const unknown = await request(app).post(`/api/public/unsubscribe/never-issued-${SUFFIX}`);
    const goneGet = await request(app).get(`/api/public/unsubscribe/${token}`);
    for (const r of [gone, unknown, goneGet]) {
      expect(r.status).toBe(200);
      expect(r.text).toContain('You are unsubscribed');
      for (const secret of ['Zainab', 'Secretname', 'Opt A', c.phoneNumber, String(c.id)]) expect(r.text).not.toContain(secret);
    }
    expect(gone.text).toBe(unknown.text);
    expect(gone.text).toBe(live.text);
  });
});
