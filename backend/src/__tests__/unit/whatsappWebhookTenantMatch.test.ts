import crypto from 'crypto';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

import { prismaMock } from '../mocks/prisma.mock';
import logger from '../../utils/logger';
import whatsappService, { resolveWhatsappTenantFromPayload } from '../../services/whatsappService';
import { handleWebhook } from '../../controllers/whatsappController';

const payload = (phoneId: string, wabaId = 'waba-x') => ({
  entry: [{
    id: wabaId,
    changes: [{
      field: 'messages',
      value: { metadata: { phone_number_id: phoneId }, statuses: [{ id: 'wamid.1', status: 'delivered' }] },
    }],
  }],
});

const row = (tenantId: string, config: any) => ({ tenantId, whatsappProvider: config });

function buildRes() {
  return { status: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() } as any;
}

describe('WhatsApp webhook tenant match', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('matches exactly one tenant by phone_number_id', async () => {
    (prismaMock.systemConfig.findMany as any).mockResolvedValue([
      row('t1', { phoneNumberId: 'p1', wabaId: 'w1' }),
      row('t2', { phoneNumberId: 'p2', wabaId: 'w2' }),
    ]);
    const result = await resolveWhatsappTenantFromPayload(payload('p2'));
    expect(result).toMatchObject([{ tenantId: 't2' }]);
  });

  it('returns every candidate when two tenants share the phone_number_id', async () => {
    (prismaMock.systemConfig.findMany as any).mockResolvedValue([
      row('t1', { phoneNumberId: 'p1' }),
      row('t2', { phoneNumberId: 'p1' }),
    ]);
    expect(await resolveWhatsappTenantFromPayload(payload('p1'))).toHaveLength(2);
  });

  it('returns every candidate when two tenants share the WABA id and no phone matches', async () => {
    (prismaMock.systemConfig.findMany as any).mockResolvedValue([
      row('t1', { phoneNumberId: 'p1', wabaId: 'w1' }),
      row('t2', { phoneNumberId: 'p2', wabaId: 'w1' }),
    ]);
    expect(await resolveWhatsappTenantFromPayload(payload('p-unknown', 'w1'))).toHaveLength(2);
  });

  const sign = (raw: Buffer, secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const twoTenants = () =>
    (prismaMock.systemConfig.findMany as any).mockResolvedValue([
      row('tA', { phoneNumberId: 'p1', appSecret: 'secret-a' }),
      row('tB', { phoneNumberId: 'p1', appSecret: 'secret-b' }),
    ]);

  it('handleWebhook processes the event for the one tenant whose secret verifies', async () => {
    twoTenants();
    const spy = jest.spyOn(whatsappService, 'processStatusUpdate').mockResolvedValue(undefined as any);
    const body = payload('p1');
    const rawBody = Buffer.from(JSON.stringify(body));
    const res = buildRes();
    await handleWebhook(
      { body, headers: { 'x-hub-signature-256': sign(rawBody, 'secret-b') }, rawBody } as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('wamid.1');
  });

  it('handleWebhook drops the event and logs an error when no candidate secret verifies', async () => {
    twoTenants();
    const spy = jest.spyOn(whatsappService, 'processStatusUpdate').mockResolvedValue(undefined as any);
    const body = payload('p1');
    const rawBody = Buffer.from(JSON.stringify(body));
    const res = buildRes();
    await handleWebhook(
      { body, headers: { 'x-hub-signature-256': sign(rawBody, 'wrong') }, rawBody } as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(spy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('several tenant configs match'),
      expect.objectContaining({ candidateTenantIds: ['tA', 'tB'] }),
    );
  });
});
