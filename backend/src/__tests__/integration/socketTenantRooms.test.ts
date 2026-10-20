/**
 * M0-T16 (COD-4): two-client socket test. An emit in tenant A never reaches a
 * tenant B client. join:order checks tenant and ownership. Platform admins only
 * join platform rooms. An expired token is rejected with TOKEN_EXPIRED.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import http from 'http';
import { AddressInfo } from 'net';
import * as jwt from 'jsonwebtoken';
import { io as connect, Socket } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
import { prismaBase } from '../../utils/prisma';
import { tenantStorage } from '../../utils/tenantContext';
import { generateAccessToken } from '../../utils/jwt';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import {
  initializeSocket, emitOrderCreated, emitOrderUpdated, emitNotification, emitToTenant,
} from '../../sockets';

const SUFFIX = Date.now();
let server: http.Server;
let io: SocketServer;
let url: string;
let tenantA: string;
let tenantB: string;
let platformUserId: number;
let orderA: number;
let pair: TwoTenants;
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

  pair = await createTwoTenants('sockrooms');
  tenantA = pair.a.id;
  tenantB = pair.b.id;
  orderA = pair.a.ids.order;
  platformUserId = (await prismaBase.user.create({
    data: { email: `sock-platform-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'P', lastName: 'A', role: 'super_admin', isPlatformAdmin: true, tenantId: null },
  })).id;
}, 30000);

afterAll(async () => {
  clients.forEach((c) => c.close());
  io.close();
  await pair.cleanup();
  await prismaBase.user.deleteMany({ where: { id: platformUserId } });
  await prismaBase.$disconnect();
});

describe('tenant-scoped socket rooms', () => {
  it('an emit in tenant A reaches the A client and not the B client or a platform admin', async () => {
    const a = await open(pair.a.users.admin.token);
    const b = await open(pair.b.users.admin.token);
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
    const a = await open(pair.a.users.salesRep.token);
    // the same user id, signed into tenant B
    const b = await open(tokenFor(pair.a.users.salesRep.id, 'sales_rep', tenantB));
    const noteA = collect(a, 'notification');
    const noteB = collect(b, 'notification');
    const wideA = collect(a, 'workflow:execution_started');
    const wideB = collect(b, 'workflow:execution_started');

    emitNotification(io, String(pair.a.users.salesRep.id), { title: 'hi', tenantId: tenantA });
    emitToTenant(io, 'workflow:execution_started', { workflowId: 1 }, tenantA);
    await settle();

    expect(noteA).toHaveLength(1);
    expect(noteB).toHaveLength(0);
    expect(wideA).toHaveLength(1);
    expect(wideB).toHaveLength(0);
  });

  it('an emit with no tenant in the data or the context is dropped', async () => {
    const a = await open(pair.a.users.admin.token);
    const got = collect(a, 'order:created');
    emitOrderCreated(io, { id: 1 });
    await settle();
    expect(got).toHaveLength(0);
  });

  it('the tenant context is used when the row carries no tenantId', async () => {
    const a = await open(pair.a.users.admin.token);
    const got = collect(a, 'order:created');
    tenantStorage.run({ tenantId: tenantA }, () => emitOrderCreated(io, { id: 2 }));
    await settle();
    expect(got).toHaveLength(1);
  });

  it('join:order is refused for another tenant and for a rep who does not own the order', async () => {
    const b = await open(pair.b.users.admin.token);
    // the real A rep owns the helper order, so sign in a rep id that does not
    const rep = await open(tokenFor(pair.a.users.salesRep.id + 1_000_000, 'sales_rep', tenantA));
    const admin = await open(pair.a.users.admin.token);
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
    const expired = jwt.sign({ id: pair.a.users.admin.id, email: 'e@t.test', role: 'admin', tenantId: tenantA }, process.env.JWT_SECRET as string, { expiresIn: -10 });
    await expect(open(expired)).rejects.toThrow('TOKEN_EXPIRED');
  });
});
