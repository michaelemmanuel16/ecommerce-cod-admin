import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import '../mocks/logger.mock';
import logger from '../../utils/logger';
import { MessageStatus } from '@prisma/client';
import { messageStatus, nextStatus } from '../../services/messaging/messageStatus';

const T0 = new Date('2026-11-01T10:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: 5, tenantId: 't1', status: 'sent', createdAt: new Date(), sentAt: null, deliveredAt: null, readAt: null, ...over,
});

describe('nextStatus: forward only', () => {
  const cases: Array<[MessageStatus, MessageStatus, MessageStatus | null]> = [
    ['pending', 'sent', 'sent'],
    ['sent', 'delivered', 'delivered'],
    ['delivered', 'read', 'read'],
    ['pending', 'read', 'read'],
    ['read', 'delivered', null],
    ['delivered', 'sent', null],
    ['sent', 'failed', 'failed'],
    ['pending', 'failed', 'failed'],
    ['delivered', 'failed', null],
    ['read', 'failed', null],
    ['failed', 'delivered', null],
    ['replied', 'read', null],
    ['skipped', 'sent', null],
  ];
  it.each(cases)('%s then %s -> %s', (current, incoming, expected) => {
    expect(nextStatus(current, incoming)).toBe(expected);
  });
});

describe('messageStatus.record', () => {
  beforeEach(() => {
    (prismaMock.messageEvent.upsert as any).mockResolvedValue({});
    (prismaMock.messageLog.update as any).mockResolvedValue({});
    (prismaMock.pendingMessageEvent.create as any).mockResolvedValue({});
  });

  it('upserts the event on (messageLogId, status), moves the status and sets deliveredAt once', async () => {
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(row());
    expect(await messageStatus.record('arkesel', 'p1', 'delivered', T0, { a: 1 })).toBe('applied');
    expect((prismaMock.messageEvent.upsert as any).mock.calls[0][0].where).toEqual({ messageLogId_status: { messageLogId: 5, status: 'delivered' } });
    expect((prismaMock.messageLog.update as any).mock.calls[0][0].data).toEqual({ status: 'delivered', deliveredAt: T0 });
  });

  it('does not overwrite a time that is already set, and does not move the status back', async () => {
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(row({ status: 'read', deliveredAt: new Date('2026-10-01') }));
    await messageStatus.record('whatsapp_cloud', 'p1', 'delivered', T0);
    expect(prismaMock.messageLog.update).not.toHaveBeenCalled();
    expect(prismaMock.messageEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('keeps the failure reason on the event and on the row', async () => {
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(row());
    await messageStatus.record('whatsapp_cloud', 'p1', 'failed', T0, {}, { failureReason: 'Number not on WhatsApp' });
    expect((prismaMock.messageEvent.upsert as any).mock.calls[0][0].create.failureReason).toBe('Number not on WhatsApp');
    expect((prismaMock.messageLog.update as any).mock.calls[0][0].data).toMatchObject({ status: 'failed', errorMessage: 'Number not on WhatsApp' });
  });

  it('holds an event with no row yet for one hour', async () => {
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(null);
    expect(await messageStatus.record('whatsapp_cloud', 'p9', 'delivered', T0, { x: 1 }, { providerStatus: 'delivered', authenticated: true })).toBe('held');
    const data = (prismaMock.pendingMessageEvent.create as any).mock.calls[0][0].data;
    expect(data).toMatchObject({ provider: 'whatsapp_cloud', providerMessageId: 'p9', status: 'delivered' });
    const ttl = data.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(prismaMock.messageEvent.upsert).not.toHaveBeenCalled();
  });

  it('looks the row up by provider id AND provider', async () => {
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(null);
    await messageStatus.record('whatsapp_cloud', 'p1', 'delivered', T0, {}, { authenticated: true });
    expect((prismaMock.messageLog.findFirst as any).mock.calls[0][0].where).toEqual({ providerMessageId: 'p1', provider: 'whatsapp_cloud' });
  });

  it('does not hold an event from an unauthenticated callback', async () => {
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(null);
    expect(await messageStatus.record('arkesel', 'p9', 'delivered', T0, {})).toBe('ignored');
    expect(prismaMock.pendingMessageEvent.create).not.toHaveBeenCalled();
  });

  it('keeps at most 4 KB of a held payload', async () => {
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(null);
    await messageStatus.record('whatsapp_cloud', 'p9', 'delivered', T0, { big: 'x'.repeat(10000) }, { authenticated: true });
    const stored = (prismaMock.pendingMessageEvent.create as any).mock.calls[0][0].data.payload;
    expect(stored.raw).toEqual({ truncated: true, bytes: expect.any(Number) });
    expect(JSON.stringify(stored).length).toBeLessThan(1000);
  });

  it('ignores a status for a message older than the retention', async () => {
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(row({ createdAt: new Date(Date.now() - 91 * 24 * 3600 * 1000) }));
    expect(await messageStatus.record('arkesel', 'p1', 'delivered', T0)).toBe('ignored');
    expect(prismaMock.messageEvent.upsert).not.toHaveBeenCalled();
    expect(prismaMock.messageLog.update).not.toHaveBeenCalled();
  });
});

describe('held events', () => {
  beforeEach(() => {
    (prismaMock.messageEvent.upsert as any).mockResolvedValue({});
    (prismaMock.messageLog.update as any).mockResolvedValue({});
  });

  it('applyPending applies each held event to the row, then deletes them', async () => {
    (prismaMock.pendingMessageEvent.findMany as any).mockResolvedValue([
      { id: 1, provider: 'whatsapp_cloud', status: 'delivered', receivedAt: T0, payload: { occurredAt: T0.toISOString(), providerStatus: 'delivered' } },
    ]);
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(row());
    expect(await messageStatus.applyPending('p1', 'whatsapp_cloud')).toBe(1);
    expect((prismaMock.pendingMessageEvent.findMany as any).mock.calls[0][0].where).toEqual({ providerMessageId: 'p1', provider: 'whatsapp_cloud' });
    expect((prismaMock.messageLog.update as any).mock.calls[0][0].data).toMatchObject({ status: 'delivered', deliveredAt: T0 });
    expect(prismaMock.pendingMessageEvent.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1] } } });
  });

  it('dropExpired deletes expired events with one log line each', async () => {
    (prismaMock.pendingMessageEvent.findMany as any).mockResolvedValue([
      { id: 1, provider: 'arkesel', providerMessageId: 'a', status: 'delivered' },
      { id: 2, provider: 'arkesel', providerMessageId: 'b', status: 'failed' },
    ]);
    expect(await messageStatus.dropExpired()).toBe(2);
    expect((logger.info as jest.Mock).mock.calls.filter((c: any[]) => String(c[0]).startsWith('Dropped expired'))).toHaveLength(2);
    expect(prismaMock.pendingMessageEvent.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2] } } });
  });

  it('dropExpired with nothing expired deletes nothing', async () => {
    (prismaMock.pendingMessageEvent.findMany as any).mockResolvedValue([]);
    expect(await messageStatus.dropExpired()).toBe(0);
    expect(prismaMock.pendingMessageEvent.deleteMany).not.toHaveBeenCalled();
  });
});
