/** M9-T30 (COD-83): a bulk send goes through messageSender, so an opted-out customer is skipped and counted. */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { arkeselSmsProvider } from '../../services/messaging/providers';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
let tenantId: string;
let owner: { id: number; token: string };
let okId: number;
let optedOutId: number;

beforeAll(async () => {
  tenantId = (await createTenant('Bulk A')).id;
  owner = await mkUser(tenantId, 'owner', 'super_admin');
  const mk = (n: number, smsOptOut: boolean) => prismaBase.customer.create({
    data: { firstName: `Bulk${n}`, lastName: 'Test', phoneNumber: `+23354${String(SUFFIX).slice(-6)}${n}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId, smsOptOut },
  });
  okId = (await mk(1, false)).id;
  optedOutId = (await mk(2, true)).id;
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('POST /api/communications/bulk-sms', () => {
  it('skips an opted-out customer, logs it as skipped and counts it', async () => {
    jest.spyOn(arkeselSmsProvider, 'isEnabled').mockResolvedValue(true);
    const send = jest.spyOn(arkeselSmsProvider, 'send').mockImplementation(async () => ({ accepted: true, providerMessageId: `sms-${SUFFIX}` }));

    const res = await request(app).post('/api/communications/bulk-sms').set(bearer(owner.token)).send({ customerIds: [okId, optedOutId], message: 'Hello' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.skipped).toBe(1);
    expect(res.body.results.find((r: any) => r.customerId === optedOutId)).toMatchObject({ success: false, skipped: true });
    expect(res.body.results.find((r: any) => r.customerId === okId)).toMatchObject({ success: true });
    expect(send).toHaveBeenCalledTimes(1);
    const row = await prismaBase.messageLog.findFirst({ where: { tenantId, customerId: optedOutId } });
    expect(row).toMatchObject({ status: 'skipped', errorMessage: 'opted_out' });
  });
});
