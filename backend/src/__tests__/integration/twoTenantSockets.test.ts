/**
 * M0-T29 (COD-7), socket part, on the two-tenant helper: an emit in tenant A is never
 * received by a tenant B client, whichever way it is addressed (order, user, tenant-wide).
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import { AddressInfo } from 'net';
import { io as connect, Socket } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
import { prismaBase } from '../../utils/prisma';
import {
  initializeSocket, emitOrderCreated, emitOrderUpdated, emitNotification, emitToTenant,
} from '../../sockets';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let server: http.Server;
let io: SocketServer;
let url: string;
let pair: TwoTenants;
const clients: Socket[] = [];

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
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeAll(async () => {
  server = http.createServer();
  io = initializeSocket(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
  pair = await createTwoTenants('sockets');
}, 30000);

afterAll(async () => {
  clients.forEach((c) => c.close());
  io.close();
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('socket rooms with two tenants', () => {
  it('order events of tenant A reach the A admin and no B client', async () => {
    const { a, b } = pair;
    const aAdmin = await open(a.users.admin.token);
    const aAgent = await open(a.users.deliveryAgent.token);
    const bAdmin = await open(b.users.admin.token);
    const bAgent = await open(b.users.deliveryAgent.token);
    const created = [aAdmin, aAgent, bAdmin, bAgent].map((s) => collect(s, 'order:created'));

    emitOrderCreated(io, { id: a.ids.order, orderNumber: 'A-1', tenantId: a.id });
    await settle();

    expect(created[0]).toHaveLength(1);
    expect(created[2]).toHaveLength(0);
    expect(created[3]).toHaveLength(0);
  });

  it('a B client that joins the A order room is refused and hears no A update', async () => {
    const { a, b } = pair;
    const aAdmin = await open(a.users.admin.token);
    const bAdmin = await open(b.users.admin.token);
    const gotA = collect(aAdmin, 'order:updated');
    const gotB = collect(bAdmin, 'order:updated');

    aAdmin.emit('join:order', String(a.ids.order));
    bAdmin.emit('join:order', String(a.ids.order));
    await settle();
    emitOrderUpdated(io, { id: a.ids.order, tenantId: a.id });
    await settle();

    expect(gotA).toHaveLength(1);
    expect(gotB).toHaveLength(0);
  });

  it('a user notification and a tenant-wide event of A stay out of B, for the same user id', async () => {
    const { a, b } = pair;
    const aAdmin = await open(a.users.admin.token);
    const bAdmin = await open(b.users.admin.token);
    const noteA = collect(aAdmin, 'notification');
    const noteB = collect(bAdmin, 'notification');
    const wideA = collect(aAdmin, 'workflow:execution_started');
    const wideB = collect(bAdmin, 'workflow:execution_started');

    emitNotification(io, String(a.users.admin.id), { title: 'for A', tenantId: a.id });
    // B user id addressed from tenant A: still no delivery to B
    emitNotification(io, String(b.users.admin.id), { title: 'wrong tenant', tenantId: a.id });
    emitToTenant(io, 'workflow:execution_started', { workflowId: a.ids.workflow }, a.id);
    await settle();

    expect(noteA).toHaveLength(1);
    expect(noteB).toHaveLength(0);
    expect(wideA).toHaveLength(1);
    expect(wideB).toHaveLength(0);
  });
});
