import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import '../mocks/logger.mock';
import { MessageChannel, MessageStatus } from '@prisma/client';

// A stub provider stands in for every channel.
const stub = {
  channel: MessageChannel.sms,
  name: 'stub',
  isEnabled: jest.fn<(...a: any[]) => Promise<boolean>>(),
  send: jest.fn<(...a: any[]) => Promise<any>>(),
  parseStatusCallback: jest.fn(() => []),
};
jest.mock('../../services/messaging/providers', () => ({ getProvider: () => stub }));

import { messageSender } from '../../services/messaging/messageSender';

const base = { tenantId: 't1', channel: MessageChannel.sms, to: '233241234567', body: 'hello', orderId: 5, customerId: 9 };

describe('messageSender.send', () => {
  beforeEach(() => {
    stub.isEnabled.mockReset().mockResolvedValue(true);
    stub.send.mockReset().mockResolvedValue({ accepted: true, providerMessageId: 'p-1' });
    (prismaMock.messageLog.create as any).mockResolvedValue({ id: 11 });
    (prismaMock.messageLog.update as any).mockResolvedValue({});
    (prismaMock.pendingMessageEvent.findMany as any).mockResolvedValue([]);
  });

  it('writes a pending row, calls the adapter, then marks the row sent with the provider id', async () => {
    const r = await messageSender.send(base);
    expect(r).toMatchObject({ messageLogId: 11, sent: true, status: 'sent', providerMessageId: 'p-1' });
    const created = (prismaMock.messageLog.create as any).mock.calls[0][0].data;
    expect(created).toMatchObject({ status: 'pending', provider: 'stub', channel: 'sms', direction: 'outbound', tenantId: 't1' });
    const updated = (prismaMock.messageLog.update as any).mock.calls[0][0].data;
    expect(updated).toMatchObject({ status: 'sent', providerMessageId: 'p-1' });
  });

  it('writes a skipped row with provider_disabled and never throws when the provider is off', async () => {
    stub.isEnabled.mockResolvedValue(false);
    const r = await messageSender.send(base);
    expect(r).toMatchObject({ sent: false, skipped: true, status: 'skipped', error: 'provider_disabled' });
    expect(stub.send).not.toHaveBeenCalled();
    const created = (prismaMock.messageLog.create as any).mock.calls[0][0].data;
    expect(created).toMatchObject({ status: MessageStatus.skipped, errorMessage: 'provider_disabled', provider: 'stub' });
  });

  it('records failed with the error text when the adapter refuses', async () => {
    stub.send.mockResolvedValue({ accepted: false, error: 'Arkesel API error 400: bad number' });
    const r = await messageSender.send(base);
    expect(r).toMatchObject({ sent: false, status: 'failed', error: 'Arkesel API error 400: bad number' });
    expect((prismaMock.messageLog.update as any).mock.calls[0][0].data).toMatchObject({
      status: 'failed', errorMessage: 'Arkesel API error 400: bad number',
    });
  });

  it('turns a thrown adapter error into a failed row', async () => {
    stub.send.mockRejectedValue(new Error('network down'));
    const r = await messageSender.send(base);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('network down');
  });

  it('links the row to the WhatsApp row it replaces (fallbackOfId) and to a retried row (retryOfId)', async () => {
    await messageSender.send({ ...base, fallbackOfId: 3, retryOfId: 4 });
    expect((prismaMock.messageLog.create as any).mock.calls[0][0].data).toMatchObject({ fallbackOfId: 3, retryOfId: 4 });
  });

  it('applies held status events after the provider id is stored', async () => {
    (prismaMock.pendingMessageEvent.findMany as any).mockResolvedValue([]);
    await messageSender.send(base);
    expect(prismaMock.pendingMessageEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { providerMessageId: 'p-1' } }),
    );
  });

  it('skipReason writes a skipped row without calling the provider', async () => {
    const r = await messageSender.send({ ...base, skipReason: 'opted_out' });
    expect(r.skipped).toBe(true);
    expect(stub.isEnabled).not.toHaveBeenCalled();
    expect((prismaMock.messageLog.create as any).mock.calls[0][0].data.metadata).toMatchObject({ reason: 'opted_out' });
  });
});
