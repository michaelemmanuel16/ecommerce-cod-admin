/**
 * M0-T16 (COD-4): two-client socket test. An emit in tenant A never reaches a
 * tenant B client. join:order checks tenant and ownership. Platform admins only
 * join platform rooms. An expired token is rejected with TOKEN_EXPIRED.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import { AddressInfo } from 'net';
import * as jwt from 'jsonwebtoken';
import { io as connect, Socket } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
import { prismaBase } from '../../utils/prisma';
import { tenantStorage } from '../../utils/tenantContext';
import { generateAccessToken } from '../../utils/jwt';
import {
  initializeSocket, emitOrderCreated, emitOrderUpdated, emitNotification, emitToTenant,
} from '../../sockets';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();
let server: http.Server;
let io: SocketServer;
let url: string;
let tenantA: string;
let tenantB: string;
let platformUserId: number;
let orderA: number;
const clients: Socket[] = [];

const tokenFor = (id: number, role: string, tenantId: string | null) =>
  generateAccessToken({ id, email: `s${id}@t.test`, role: role as any, tenantId });

const open = async (token: string): Promise<Socket> => {
  const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  clients.push(s);
  await new Promise<void>((resolve, reject) => {
    s.on('connect', () => resolve());
    s.on('connect_error', reject);
  });
  return s;
};

/** Collects events of one name; `quiet` waits and returns what arrived. */
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

  tenantA = (await prismaBase.tenant.create({ data: { name: `Sock A ${SUFFIX}`, slug: `sock-a-${SUFFIX}` } })).id;
  tenantB = (await prismaBase.tenant.create({ data: { name: `Sock B ${SUFFIX}`, slug: `sock-b-${SUFFIX}` } })).id;
  platformUserId = (await prismaBase.user.create({
    data: { email: `sock-platform-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'P', lastName: 'A', role: 'super_admin', isPlatformAdmin: true, tenantId: null },
  })).id;
  orderA = await tenantStorage.run({ tenantId: tenantA }, async () => {
    const customer = await prismaBase.customer.create({
      data: { firstName: 'C', lastName: 'A', phoneNumber: `0${SUFFIX}`, address: 'x', state: 's', area: 'a', tenantId: tenantA },
    });
    const order = await prismaBase.order.create({
      data: {
        customerId: customer.id, totalAmount: 10, subtotal: 10, shippingCost: 0,
        deliveryAddress: 'x', deliveryState: 's', deliveryArea: 'a', tenantId: tenantA,
      },
    });
    return order.id;
  });
});

afterAll(async () => {
  clients.forEach((c) => c.close());
  io.close();
  await prismaBase.order.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prismaBase.user.deleteMany({ where: { id: platformUserId } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prismaBase.$disconnect();
});

describe('tenant-scoped socket rooms', () => {
  it('an emit in tenant A reaches the A client and not the B client or a platform admin', async () => {
    const a = await open(tokenFor(1, 'admin', tenantA));
    const b = await open(tokenFor(2, 'admin', tenantB));
    const p = await open(tokenFor(platformUserId, 'super_admin', null));
    const gotA = collect(a, 'order:created');
    const gotB = collect(b, 'order:created');
    const gotP = collect(p, 'order:created');

    emitOrderCreated(io, { id: 99, orderNumber: 'X', tenantId: tenantA });
    await settle();

    expect(gotA).toHaveLength(1);
    expect(gotB).toHaveLength(0);
    expect(gotP).toHaveLength(0);
  });

  it('user and tenant-wide emits stay inside the tenant, even for the same user id', async () => {
    const a = await open(tokenFor(5, 'sales_rep', tenantA));
    const b = await open(tokenFor(5, 'sales_rep', tenantB));
    const noteA = collect(a, 'notification');
    const noteB = collect(b, 'notification');
    const wideA = collect(a, 'workflow:execution_started');
    const wideB = collect(b, 'workflow:execution_started');

    emitNotification(io, '5', { title: 'hi', tenantId: tenantA });
    emitToTenant(io, 'workflow:execution_started', { workflowId: 1 }, tenantA);
    await settle();

    expect(noteA).toHaveLength(1);
    expect(noteB).toHaveLength(0);
    expect(wideA).toHaveLength(1);
    expect(wideB).toHaveLength(0);
  });

  it('an emit with no tenant in the data or the context is dropped', async () => {
    const a = await open(tokenFor(6, 'admin', tenantA));
    const got = collect(a, 'order:created');
    emitOrderCreated(io, { id: 1 });
    await settle();
    expect(got).toHaveLength(0);
  });

  it('the tenant context is used when the row carries no tenantId', async () => {
    const a = await open(tokenFor(7, 'admin', tenantA));
    const got = collect(a, 'order:created');
    tenantStorage.run({ tenantId: tenantA }, () => emitOrderCreated(io, { id: 2 }));
    await settle();
    expect(got).toHaveLength(1);
  });

  it('join:order is refused for another tenant and for a rep who does not own the order', async () => {
    const b = await open(tokenFor(2, 'admin', tenantB));
    const rep = await open(tokenFor(8, 'sales_rep', tenantA));
    const admin = await open(tokenFor(1, 'admin', tenantA));
    const gotB = collect(b, 'order:updated');
    const gotRep = collect(rep, 'order:updated');
    const gotAdmin = collect(admin, 'order:updated');

    b.emit('join:order', String(orderA));
    rep.emit('join:order', String(orderA));
    admin.emit('join:order', String(orderA));
    await settle();
    emitOrderUpdated(io, { id: orderA, tenantId: tenantA });
    await settle();

    expect(gotB).toHaveLength(0);
    expect(gotRep).toHaveLength(0);
    expect(gotAdmin).toHaveLength(1);
  });

  it('a tenant-less token that is not a platform admin is rejected', async () => {
    await expect(open(tokenFor(987654321, 'admin', null))).rejects.toThrow('Authentication error');
  });

  it('an expired token is rejected with TOKEN_EXPIRED', async () => {
    const expired = jwt.sign({ id: 1, email: 'e@t.test', role: 'admin', tenantId: tenantA }, process.env.JWT_SECRET as string, { expiresIn: -10 });
    await expect(open(expired)).rejects.toThrow('TOKEN_EXPIRED');
  });
});
