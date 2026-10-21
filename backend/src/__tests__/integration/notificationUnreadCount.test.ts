/**
 * M3-T27 (COD-22): GET /api/notifications/unread-count equals the unread rows of the signed-in user (per user, per tenant),
 * and the socket event `notification` reaches only that user's room.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io as connect, Socket } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { initializeSocket } from '../../sockets';
import { setSocketInstance } from '../../utils/socketInstance';
import { runInTenant } from '../../utils/tenantContext';
import { createNotification } from '../../services/notificationService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let server: http.Server;
let io: SocketServer;
let url: string;
const clients: Socket[] = [];
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const open = async (token: string): Promise<Socket> => {
  const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  clients.push(s);
  await new Promise<void>((resolve, reject) => {
    s.on('connect', () => resolve());
    s.on('connect_error', reject);
  });
  return s;
};
const collect = (s: Socket, event: string) => {
  const got: any[] = [];
  s.on(event, (d) => got.push(d));
  return got;
};
const until = async (cond: () => boolean) => {
  for (let waited = 0; !cond() && waited < 2000; waited += 5) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};
const settle = () => new Promise((r) => setTimeout(r, 150));
const count = async (token: string) => (await request(app).get('/api/notifications/unread-count').set(auth(token))).body;

beforeAll(async () => {
  pair = await createTwoTenants('unread');
  server = http.createServer();
  io = initializeSocket(server);
  setSocketInstance(io); // importing the app set its own server; createNotification must emit on this one
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
}, 30000);

afterAll(async () => {
  clients.forEach((c) => c.close());
  io.close();
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('GET /api/notifications/unread-count', () => {
  it('requires a sign-in', async () => {
    expect((await request(app).get('/api/notifications/unread-count')).status).toBe(401);
  });

  it('contract: 200 with an integer unreadCount', async () => {
    const res = await request(app).get('/api/notifications/unread-count').set(auth(pair.a.users.admin.token));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['unreadCount']);
    expect(Number.isInteger(res.body.unreadCount)).toBe(true);
  });

  it('equals the unread rows of the user, per user and per tenant', async () => {
    const { a, b } = pair;
    const rowsFor = (userId: number) => prismaBase.notification.count({ where: { userId, isRead: false } });
    for (const u of [a.users.admin, a.users.deliveryAgent, b.users.admin]) {
      expect((await count(u.token)).unreadCount).toBe(await rowsFor(u.id));
    }

    const before = (await count(a.users.admin.token)).unreadCount;
    await runInTenant(a.id, () => createNotification(String(a.users.admin.id), 'order', 'T1', 'one'));
    await runInTenant(a.id, () => createNotification(String(a.users.admin.id), 'order', 'T2', 'two'));
    expect((await count(a.users.admin.token)).unreadCount).toBe(before + 2);
    expect((await count(a.users.admin.token)).unreadCount).toBe(await rowsFor(a.users.admin.id));
    // other users, in the same and in the other tenant, did not change
    expect((await count(a.users.deliveryAgent.token)).unreadCount).toBe(await rowsFor(a.users.deliveryAgent.id));
    expect((await count(b.users.admin.token)).unreadCount).toBe(await rowsFor(b.users.admin.id));

    await request(app).patch('/api/notifications/read-all').set(auth(a.users.admin.token));
    expect((await count(a.users.admin.token)).unreadCount).toBe(0);
    expect(await rowsFor(a.users.admin.id)).toBe(0);
  });
});

describe('socket event notification', () => {
  it('reaches only the room of the user it is for', async () => {
    const { a, b } = pair;
    const aAdmin = await open(a.users.admin.token);
    const aAgent = await open(a.users.deliveryAgent.token);
    const bAdmin = await open(b.users.admin.token);
    const got = [aAdmin, aAgent, bAdmin].map((s) => collect(s, 'notification'));

    await runInTenant(a.id, () => createNotification(String(a.users.admin.id), 'order', 'Hello', 'for the A admin'));
    await until(() => got[0].length === 1);
    await settle();

    expect(got[0][0]).toMatchObject({ title: 'Hello', userId: a.users.admin.id, tenantId: a.id });
    expect(got[1]).toHaveLength(0);
    expect(got[2]).toHaveLength(0);
  });
});
