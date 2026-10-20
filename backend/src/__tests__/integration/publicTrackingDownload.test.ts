/**
 * M0-T30 (COD-7): public order tracking and digital download.
 * - the 31st request in 15 minutes gets 429 (production limits, loaded in an isolated module registry)
 * - tracking returns the status and the partner name, never a phone or an address
 * - a wrong phone gets the same "not found" as an unknown order
 * - an expired, revoked or used-up download token gets 410, an unknown token 404
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let pair: TwoTenants;
let digitalOrderId: number;
const FILE_URL = 'https://files.example.com/guide.pdf';
const hex = (n: string) => `${n}-${Math.random().toString(16).slice(2)}${Date.now()}`;

const track = (orderId: number, phoneNumber: string) =>
  request(app).post('/api/public/orders/track').send({ orderId: String(orderId), phoneNumber });

beforeAll(async () => {
  pair = await createTwoTenants('pubtrack');
  const { a } = pair;
  const product = await prismaBase.product.create({
    data: {
      name: `Guide ${a.marker}`, sku: `DIG-${a.marker}`, category: 'test', price: 10, stockQuantity: 1, tenantId: a.id,
      productType: 'digital', digitalFileUrl: FILE_URL,
    },
  });
  const order = await prismaBase.order.create({
    data: {
      customerId: a.ids.customer, subtotal: 10, shippingCost: 0, totalAmount: 10, orderType: 'digital', tenantId: a.id,
      orderItems: { create: [{ productId: product.id, quantity: 1, unitPrice: 10, totalPrice: 10 }] },
    },
  });
  digitalOrderId = order.id;
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const mkToken = (data: { expiresAt?: Date; downloadCount?: number; maxDownloads?: number; isRevoked?: boolean }) => {
  const token = hex('dl');
  return prismaBase.downloadToken
    .create({ data: { orderId: digitalOrderId, token, expiresAt: new Date(Date.now() + 3_600_000), tenantId: pair.a.id, ...data } })
    .then(() => token);
};
const download = (token: string) => request(app).get(`/api/public/download/${token}`).redirects(0);

describe('public tracking', () => {
  it('returns the status and the partner name, and no phone or address anywhere', async () => {
    const { a } = pair;
    const res = await track(a.ids.order, a.phone);

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('out_for_delivery');
    expect(res.body.order.partnerName).toBe(`agent${a.marker} Last${a.marker}`);

    const text = JSON.stringify(res.body);
    const keys = new Set<string>();
    const walk = (v: any) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { keys.add(k); walk(x); });
    };
    walk(res.body);
    expect([...keys].filter((k) => /phone|address|email/i.test(k))).toEqual([]);
    expect(text).not.toContain(a.phone);
    expect(text).not.toContain(`1 ${a.marker} Street`);
    expect(text).not.toContain(a.users.admin.email);
    expect(text).not.toContain(a.users.deliveryAgent.email);
  });

  it('a wrong phone gets the same not-found answer as an unknown order', async () => {
    const { a, b } = pair;
    const wrongPhone = await track(a.ids.order, b.phone);
    const unknownOrder = await track(999_999_999, a.phone);

    expect(wrongPhone.status).toBe(404);
    expect(wrongPhone.body).toEqual({ error: 'Order not found' });
    expect(unknownOrder.status).toBe(404);
    expect(unknownOrder.body).toEqual(wrongPhone.body);
  });

  it("another tenant's order id with the right phone of tenant A is not found", async () => {
    const { a, b } = pair;
    const res = await track(b.ids.order, a.phone);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(b.marker);
  });
});

describe('public download', () => {
  it('a valid token redirects to the file and counts the download', async () => {
    const token = await mkToken({});
    const res = await download(token);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(FILE_URL);
    const row = await prismaBase.downloadToken.findUniqueOrThrow({ where: { token } });
    expect(row.downloadCount).toBe(1);
  });

  it('an expired token is 410 and is not counted', async () => {
    const token = await mkToken({ expiresAt: new Date(Date.now() - 60_000) });
    const res = await download(token);
    expect(res.status).toBe(410);
    expect(res.headers.location).toBeUndefined();
    expect((await prismaBase.downloadToken.findUniqueOrThrow({ where: { token } })).downloadCount).toBe(0);
  });

  it('a used-up token is 410: the last allowed download works, the next one does not', async () => {
    const token = await mkToken({ maxDownloads: 2 });
    expect((await download(token)).status).toBe(302);
    expect((await download(token)).status).toBe(302);
    expect((await download(token)).status).toBe(410);
    expect((await prismaBase.downloadToken.findUniqueOrThrow({ where: { token } })).downloadCount).toBe(2);
  });

  it('a revoked token is 410', async () => {
    const token = await mkToken({ isRevoked: true });
    expect((await download(token)).status).toBe(410);
  });

  it('an unknown token is 404', async () => {
    const res = await download(hex('nope'));
    expect(res.status).toBe(404);
  });
});

describe('rate limits at production values', () => {
  /** The real public router, loaded with NODE_ENV=production so the limiter reads its production caps. */
  const productionRouterApp = () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let router: any;
    try {
      jest.isolateModules(() => {
        router = require('../../routes/publicOrderRoutes').default;
      });
    } finally {
      process.env.NODE_ENV = previous;
    }
    const mini = express();
    mini.use(express.json());
    mini.use('/api/public', router);
    return mini;
  };

  it('tracking: requests 1 to 30 pass, the 31st gets 429', async () => {
    const mini = productionRouterApp();
    const hit = () => request(mini).post('/api/public/orders/track').send({ orderId: '999999999', phoneNumber: '+233241234567' });
    for (let i = 1; i <= 30; i += 1) {
      const res = await hit();
      expect({ i, status: res.status }).toEqual({ i, status: 404 });
    }
    const limited = await hit();
    expect(limited.status).toBe(429);
  });

  it('download: requests 1 to 30 pass, the 31st gets 429', async () => {
    const mini = productionRouterApp();
    const hit = () => request(mini).get('/api/public/download/not-a-real-token').redirects(0);
    for (let i = 1; i <= 30; i += 1) {
      const res = await hit();
      expect({ i, status: res.status }).toEqual({ i, status: 404 });
    }
    const limited = await hit();
    expect(limited.status).toBe(429);
  });
});
