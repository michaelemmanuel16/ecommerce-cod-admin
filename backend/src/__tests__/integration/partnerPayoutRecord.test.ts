/**
 * M5-T10 (COD-49): record partner payout, the one generic action (F-906): API `POST /api/partner-settlements` and the MCP
 * tool `partner_payout_record`. Validation, storage, idempotency by (partner, reference), permission, tenant, audit.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runTool } from '../../tools/registry';
import '../../tools';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { toolActorContext, toolAuditRows } from './helpers/callTool';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

let tenantId: string;
let otherTenantId: string;
let owner: { id: number; token: string };
let admin: { id: number; token: string };
let kofiId: number;
let esiId: number;
let otherPartnerId: number;

const payload = (reference: string, extra: Record<string, unknown> = {}) => ({
  partnerId: kofiId,
  payoutDate: '2026-10-20',
  payoutAmount: 335,
  reference,
  lines: [
    { externalOrderRef: '#9001', orderId: 9001, expAmount: 200, charge: 25 },
    { externalOrderRef: '9002', expAmount: 200, charge: 40 },
  ],
  ...extra,
});
const post = (token: string, body: unknown) => request(app).post('/api/partner-settlements').set(bearer(token)).send(body as object);
const settlementCount = () => prismaBase.partnerSettlement.count({ where: { tenantId } });

beforeAll(async () => {
  tenantId = (await createTenant('Payout Record')).id;
  otherTenantId = (await createTenant('Payout Record Other')).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(otherTenantId);
  owner = await mkUser(tenantId, 'powner', 'super_admin');
  admin = await mkUser(tenantId, 'padmin', 'admin');
  kofiId = (await mkUser(tenantId, 'pkofi', 'delivery_agent', { kind: 'person' })).id;
  esiId = (await mkUser(tenantId, 'pesi', 'delivery_agent', { kind: 'company' })).id;
  otherPartnerId = (await mkUser(otherTenantId, 'pother', 'delivery_agent', { kind: 'person' })).id;
  await prismaBase.systemConfig.upsert({
    where: { tenantId },
    update: { rolePermissions: { admin: { payouts: ['view', 'create'] } } },
    create: { tenantId, rolePermissions: { admin: { payouts: ['view', 'create'] } } } as any,
  });
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('POST /api/partner-settlements', () => {
  it('a valid call creates one settlement with its lines and answers 201', async () => {
    const res = await post(owner.token, payload('REF-A1', { notes: 'October week 2' }));
    expect(res.status).toBe(201);
    const s = res.body.settlement;
    expect(s).toMatchObject({ partnerId: kofiId, reference: 'REF-A1', payoutDate: '2026-10-20', payoutAmount: '335.00', replayed: false });
    expect(s.lines).toHaveLength(2);
    expect(s.lines.map((l: any) => [l.externalOrderRef, l.expAmount, l.charge])).toEqual([['#9001', '200.00', '25.00'], ['9002', '200.00', '40.00']]);
    const row = await prismaBase.partnerSettlement.findUniqueOrThrow({ where: { id: s.id }, include: { lines: true } });
    expect(row.tenantId).toBe(tenantId);
    expect(row.recordedById).toBe(owner.id);
    expect(row.isManual).toBe(false);
    expect(row.lines).toHaveLength(2);
  });

  it('the same reference again returns the first result and creates nothing', async () => {
    const first = await post(owner.token, payload('REF-A2'));
    const before = { s: await settlementCount(), l: await prismaBase.partnerSettlementLine.count({ where: { tenantId } }) };
    const again = await post(owner.token, payload('REF-A2', { payoutAmount: 999, lines: [{ externalOrderRef: '1', expAmount: 5 }] }));
    expect(again.status).toBe(200);
    expect(again.body.settlement).toMatchObject({ id: first.body.settlement.id, payoutAmount: '335.00', replayed: true });
    expect(await settlementCount()).toBe(before.s);
    expect(await prismaBase.partnerSettlementLine.count({ where: { tenantId } })).toBe(before.l);
  });

  it('the same reference for another partner is a separate settlement', async () => {
    const a = await post(owner.token, payload('REF-SHARED'));
    const b = await post(owner.token, payload('REF-SHARED', { partnerId: esiId }));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.settlement.id).not.toBe(b.body.settlement.id);
  });

  it('two calls with one reference at once create one settlement', async () => {
    const [a, b] = await Promise.all([post(owner.token, payload('REF-RACE')), post(owner.token, payload('REF-RACE'))]);
    expect(a.body.settlement.id).toBe(b.body.settlement.id);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await prismaBase.partnerSettlement.count({ where: { tenantId, reference: 'REF-RACE' } })).toBe(1);
  });

  it('rejects a negative charge, a foreign currency and a batch above 500 lines with a clear error', async () => {
    const before = await settlementCount();
    const negative = await post(owner.token, payload('REF-B1', { lines: [{ externalOrderRef: '1', expAmount: 100, charge: -5 }] }));
    expect(negative.status).toBe(400);
    expect(negative.body.error).toMatch(/charge cannot be negative/);

    const currency = await post(owner.token, payload('REF-B2', { currency: 'NGN' }));
    expect(currency.status).toBe(400);
    expect(currency.body.error).toMatch(/paid in GHS/);
    expect((await post(owner.token, payload('REF-B2b', { currency: 'ghs' }))).status).toBe(201);

    const tooMany = await post(owner.token, payload('REF-B3', { lines: Array.from({ length: 501 }, (_, i) => ({ externalOrderRef: `R${i}`, expAmount: 10 })) }));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatch(/at most 500 lines/);
    const exactly500 = await post(owner.token, payload('REF-B4', { lines: Array.from({ length: 500 }, (_, i) => ({ externalOrderRef: `R${i}`, expAmount: 10 })) }));
    expect(exactly500.status).toBe(201);
    expect(await settlementCount()).toBe(before + 2);
  });

  it('rejects bad input with the field named', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ payoutAmount: 0 }, /payoutAmount must be above 0/],
      [{ payoutAmount: 'abc' }, /payoutAmount must be a number/],
      [{ reference: '  ' }, /reference/],
      [{ payoutDate: '2026-02-30' }, /payoutDate/],
      [{ lines: [] }, /at least one line/],
      [{ lines: [{ externalOrderRef: '1', expAmount: 0 }] }, /expAmount must be above 0/],
      [{ lines: [{ externalOrderRef: '1', expAmount: 5 }, { externalOrderRef: '1', expAmount: 5 }] }, /listed twice/],
      [{ lines: [{ externalOrderRef: 'a', orderId: 7, expAmount: 5 }, { externalOrderRef: 'b', orderId: 7, expAmount: 5 }] }, /Order 7 is listed twice/],
      [{ partnerId: 'x' }, /partnerId/],
    ];
    for (const [extra, message] of cases) {
      const res = await post(owner.token, payload(`REF-C-${Math.random()}`, extra));
      expect({ extra, status: res.status }).toEqual({ extra, status: 400 });
      expect(res.body.error).toMatch(message);
    }
  });

  it('a partner of another tenant, or a user that is not a partner, is 404', async () => {
    expect((await post(owner.token, payload('REF-D1', { partnerId: otherPartnerId }))).status).toBe(404);
    expect((await post(owner.token, payload('REF-D2', { partnerId: admin.id }))).status).toBe(404);
  });

  it('needs the payouts permission: owner and a role that holds it pass, others get 403', async () => {
    expect((await post(admin.token, payload('REF-E1'))).status).toBe(201);
    const manager = await mkUser(tenantId, 'pmanager', 'manager');
    const clerk = await mkUser(tenantId, 'pclerk', 'accountant');
    const agent = await mkUser(tenantId, 'pagent', 'delivery_agent', { kind: 'person' });
    for (const who of [manager, clerk, agent]) {
      expect((await post(who.token, payload('REF-E2'))).status).toBe(403);
    }
    expect((await request(app).post('/api/partner-settlements').send(payload('REF-E3'))).status).toBe(401);
  });

  it('writes one audit row per call', async () => {
    const before = await prismaBase.auditLog.count({ where: { tenantId, resource: 'partner_settlement' } });
    await post(owner.token, payload('REF-F1'));
    await post(owner.token, payload('REF-F1'));
    expect(await prismaBase.auditLog.count({ where: { tenantId, resource: 'partner_settlement' } })).toBe(before + 2);
  });
});

describe('MCP tool partner_payout_record', () => {
  it('is a write tool for the MCP channel and gives the same result as the API', async () => {
    const res = await runTool('partner_payout_record', payload('REF-T1'), await toolActorContext(tenantId));
    expect(res.status).toBe('ok');
    const viaTool = JSON.parse(JSON.stringify((res as any).data));
    const viaApi = (await post(owner.token, payload('REF-T1'))).body.settlement;
    expect(viaApi).toMatchObject({ id: viaTool.id, replayed: true });
    // The same findings and warnings come back on a repeat as on the first call
    expect({ ...viaTool, replayed: true }).toEqual(viaApi);
    expect(viaTool.findings.length).toBeGreaterThan(0);
    expect(await prismaBase.partnerSettlement.count({ where: { tenantId, reference: 'REF-T1' } })).toBe(1);
  });

  it('writes one audit row, and the same reference again creates nothing new', async () => {
    const ctx = await toolActorContext(tenantId);
    const before = (await toolAuditRows(tenantId, 'partner_payout_record')).length;
    await runTool('partner_payout_record', payload('REF-T2'), ctx);
    const rows = await toolAuditRows(tenantId, 'partner_payout_record');
    expect(rows.length - before).toBe(1);
    expect(rows[rows.length - 1]).toMatchObject({ channel: 'mcp', action: 'tool_call' });
    const again = await runTool('partner_payout_record', payload('REF-T2'), ctx);
    expect(again.status).toBe('ok');
    expect((again as any).data.replayed).toBe(true);
    expect(await prismaBase.partnerSettlement.count({ where: { tenantId, reference: 'REF-T2' } })).toBe(1);
  });

  it('refuses invalid input as "invalid" with the problem named, and a chat call as not available', async () => {
    const ctx = await toolActorContext(tenantId);
    const bad = await runTool('partner_payout_record', payload('REF-T3', { lines: [{ externalOrderRef: '1', expAmount: 5, charge: -1 }] }), ctx);
    expect(bad.status).toBe('invalid');
    expect((bad as any).error).toMatch(/charge cannot be negative/);
    const chat = await runTool('partner_payout_record', payload('REF-T4'), { ...ctx, channel: 'chat' });
    expect(chat.status).toBe('denied');
    expect(await prismaBase.partnerSettlement.count({ where: { tenantId, reference: { in: ['REF-T3', 'REF-T4'] } } })).toBe(0);
  });

  it('is denied to a key whose role lacks the payouts permission', async () => {
    const clerk = await prismaBase.user.create({
      data: { email: `tool-clerk+${tenantId}@codadmin.test`, password: 'x', firstName: 'Tool', lastName: 'Clerk', role: 'accountant', kind: 'ai_agent', tenantId },
    });
    const res = await runTool('partner_payout_record', payload('REF-T5'), { tenantId, actorId: clerk.id, actorKind: 'ai_agent', roleId: null, channel: 'mcp' });
    expect(res.status).toBe('denied');
    expect(await prismaBase.partnerSettlement.count({ where: { tenantId, reference: 'REF-T5' } })).toBe(0);
  });
});

describe('no partner-specific code', () => {
  it('the settlement code names no partner', () => {
    const root = path.join(__dirname, '..', '..');
    const files = [
      'services/partnerSettlementService.ts', 'controllers/partnerSettlementController.ts', 'routes/partnerSettlementRoutes.ts',
      'tools/partnerPayout.ts', 'validators/partnerPayoutSchema.ts',
    ];
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      expect({ file, hit: /logiswift|kasapa|kofi|esi\b|kwesi/i.exec(text)?.[0] ?? null }).toEqual({ file, hit: null });
    }
  });
});
