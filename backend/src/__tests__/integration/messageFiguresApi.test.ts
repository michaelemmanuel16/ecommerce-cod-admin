/** M9-T08 (COD-78): overview figures and message log API. The tiles equal the log rows under the same filters. */
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

const SUFFIX = Date.now();
let tenantA: string;
let tenantB: string;
let owner: { id: number; token: string };
let manager: { id: number; token: string };
let rep: { id: number; token: string };
let otherRep: { id: number; token: string };
let ownerB: { id: number; token: string };
let customerId: number;
let repOrderId: number;
let testOrderId: number;
let seq = 0;

const STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'replied'] as const;
const mkMsg = (data: Record<string, unknown>) => prismaBase.messageLog.create({
  data: { tenantId: tenantA, channel: 'whatsapp', direction: 'outbound', messageBody: 'x', status: 'sent', provider: 'x', providerMessageId: `fig-${SUFFIX}-${seq++}`, metadata: { to: `+233240000${String(seq).padStart(3, '0')}` }, ...data } as any,
});
const mkOrder = (data: Record<string, unknown> = {}) => prismaBase.order.create({
  data: { customerId, subtotal: 10, shippingCost: 0, totalAmount: 10, deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: tenantA, ...data } as any,
});

beforeAll(async () => {
  tenantA = (await createTenant('Fig A')).id;
  tenantB = (await createTenant('Fig B')).id;
  owner = await mkUser(tenantA, 'owner', 'super_admin');
  manager = await mkUser(tenantA, 'mgr', 'manager');
  rep = await mkUser(tenantA, 'rep', 'sales_rep');
  otherRep = await mkUser(tenantA, 'rep2', 'sales_rep');
  ownerB = await mkUser(tenantB, 'ownerb', 'super_admin');
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+23355${String(SUFFIX).slice(-7)}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId: tenantA },
  })).id;
  repOrderId = (await mkOrder({ customerRepId: rep.id })).id;
  testOrderId = (await mkOrder({ isTest: true })).id;

  // Fixture: 1 to 3 messages for every status on each of the three channels
  for (const channel of ['whatsapp', 'sms', 'email'] as const) {
    for (const [i, status] of STATUSES.entries()) {
      for (let n = 0; n <= i % 3; n++) await mkMsg({ channel, status, customerId });
    }
  }
  await mkMsg({ status: 'delivered', orderId: repOrderId, customerId });
  await mkMsg({ status: 'delivered', orderId: testOrderId, customerId }); // test order: in no figure
  await mkMsg({ status: 'delivered', direction: 'inbound' }); // inbound: in no figure
  await prismaBase.messageLog.create({ data: { tenantId: tenantB, channel: 'sms', direction: 'outbound', messageBody: 'b', status: 'sent', providerMessageId: `fig-b-${SUFFIX}` } });
});

afterAll(async () => {
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.$disconnect();
});

const FIGURES = ['sent', 'delivered', 'read', 'failed', 'replied', 'skipped'] as const;

describe('contract: tiles equal the log rows under the same filters', () => {
  const logCount = async (token: string, query: string): Promise<number> => {
    let total = 0;
    let cursor: string | null = null;
    do {
      const res: any = await request(app).get(`/api/messages/log?limit=100${query}${cursor ? `&cursor=${cursor}` : ''}`).set(bearer(token));
      expect(res.status).toBe(200);
      total += res.body.items.length;
      cursor = res.body.nextCursor;
    } while (cursor);
    return total;
  };

  it.each(['whatsapp', 'sms', 'email'])('every tile of %s equals its log count', async (channel) => {
    const ov = await request(app).get(`/api/messages/overview?channel=${channel}`).set(bearer(owner.token));
    expect(ov.status).toBe(200);
    const tiles = ov.body.channels[channel];
    for (const figure of FIGURES) {
      expect(tiles[figure]).toBe(await logCount(owner.token, `&channel=${channel}&status=${figure}`));
    }
  });

  it('with a date range and as a rep', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const ov = await request(app).get(`/api/messages/overview?from=${day}&to=${day}`).set(bearer(rep.token));
    for (const channel of Object.keys(ov.body.channels)) {
      for (const figure of FIGURES) {
        expect(ov.body.channels[channel][figure]).toBe(await logCount(rep.token, `&channel=${channel}&status=${figure}&from=${day}&to=${day}`));
      }
    }
  });

  it('the log total is the tile of the same filters, whatever the page size', async () => {
    const ov = await request(app).get('/api/messages/overview?channel=whatsapp').set(bearer(owner.token));
    for (const figure of FIGURES) {
      const res = await request(app).get(`/api/messages/log?limit=1&channel=whatsapp&status=${figure}`).set(bearer(owner.token));
      expect(res.body.total).toBe(ov.body.channels.whatsapp[figure]);
    }
  });

  it('the overview total (all channels) equals the log total of each figure', async () => {
    const ov = await request(app).get('/api/messages/overview').set(bearer(owner.token));
    expect(ov.body.channels.whatsapp.sent + ov.body.channels.sms.sent + ov.body.channels.email.sent).toBe(ov.body.total.sent);
    for (const figure of FIGURES) {
      const res = await request(app).get(`/api/messages/log?limit=1&status=${figure}`).set(bearer(owner.token));
      expect(res.body.total).toBe(ov.body.total[figure]);
    }
  });

  it('excludes test orders and inbound rows from both', async () => {
    const all = await request(app).get('/api/messages/log?limit=100').set(bearer(owner.token));
    expect(all.body.items.find((i: any) => i.order?.id === testOrderId)).toBeUndefined();
    const ov = await request(app).get('/api/messages/overview').set(bearer(owner.token));
    expect(ov.body.channels.whatsapp.delivered).toBe(await logCount(owner.token, '&channel=whatsapp&status=delivered'));
  });
});

describe('overview', () => {
  it('counts per channel and gives a null rate when nothing was sent', async () => {
    const empty = await request(app).get('/api/messages/overview').set(bearer(ownerB.token));
    expect(empty.body.channels.sms).toMatchObject({ sent: 1, deliveredRate: 0 });
    expect(empty.body.channels.email).toMatchObject({ sent: 0, deliveredRate: null, readRate: null, failedRate: null, replyRate: null });
  });

  it('rejects a bad date', async () => {
    expect((await request(app).get('/api/messages/overview?from=nope').set(bearer(owner.token))).status).toBe(400);
  });
});

describe('log', () => {
  it('filters by channel, status, recipient and customer name; newest first', async () => {
    const res = await request(app).get('/api/messages/log?channel=sms&status=failed').set(bearer(manager.token));
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((i: any) => i.channel === 'sms' && i.status === 'failed')).toBe(true);

    const row = res.body.items[0];
    const byPhone = await request(app).get(`/api/messages/log?recipient=${encodeURIComponent(row.recipient)}`).set(bearer(owner.token));
    expect(byPhone.body.items.map((i: any) => i.id)).toContain(row.id);
    const byName = await request(app).get('/api/messages/log?recipient=mensah&limit=5').set(bearer(owner.token));
    expect(byName.body.items[0].customer).toMatchObject({ id: customerId, name: 'Ama Mensah' });

    const page1 = await request(app).get('/api/messages/log?limit=3').set(bearer(owner.token));
    const times = page1.body.items.map((i: any) => i.id);
    expect(times).toEqual([...times].sort((a: number, b: number) => b - a));
    const page2 = await request(app).get(`/api/messages/log?limit=3&cursor=${page1.body.nextCursor}`).set(bearer(owner.token));
    expect(page2.body.items.map((i: any) => i.id).every((id: number) => id < times[2])).toBe(true);
  });

  it('a message to a deleted customer shows the stored phone and no customer link', async () => {
    const gone = await prismaBase.customer.create({
      data: { firstName: 'Gone', lastName: 'Person', phoneNumber: `+23356${String(SUFFIX).slice(-7)}`, address: '2 St', state: 'Greater Accra', area: 'Accra', tenantId: tenantA },
    });
    const msg = await mkMsg({ customerId: gone.id, metadata: { to: '+233561234567' } });
    await prismaBase.customer.update({ where: { id: gone.id }, data: { isActive: false } });
    const res = await request(app).get('/api/messages/log?recipient=233561234567').set(bearer(owner.token));
    expect(res.body.items.find((i: any) => i.id === msg.id)).toMatchObject({ recipient: '+233561234567', customer: null });
  });

  it('a rep sees only messages on their own orders', async () => {
    const mine = await request(app).get('/api/messages/log').set(bearer(rep.token));
    expect(mine.body.items.length).toBe(1);
    expect(mine.body.items[0].order.id).toBe(repOrderId);
    const other = await request(app).get('/api/messages/log').set(bearer(otherRep.token));
    expect(other.body.items).toEqual([]);
  });

  it('tenant B never sees tenant A messages', async () => {
    const res = await request(app).get('/api/messages/log?limit=100').set(bearer(ownerB.token));
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].channel).toBe('sms');
  });
});
