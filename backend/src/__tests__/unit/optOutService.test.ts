/** M9-T10 (COD-78): setOptOut writes the flag per phone and always an event. */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import '../mocks/logger.mock';
import { setOptOut } from '../../services/messaging/optOutService';

describe('setOptOut', () => {
  beforeEach(() => {
    (prismaMock.customer.updateMany as any).mockResolvedValue({ count: 0 });
    (prismaMock.optOutEvent.createMany as any).mockResolvedValue({ count: 0 });
  });

  it('two customers with one phone both change, each with its own event', async () => {
    (prismaMock.customer.findMany as any).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const out = await setOptOut({ tenantId: 't1', phone: '233241110000', channel: 'whatsapp', optedOut: true, reason: 'stop_reply' });
    expect(out.customerIds).toEqual([1, 2]);
    expect((prismaMock.customer.updateMany as any).mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1', id: { in: [1, 2] } }, data: { whatsappOptOut: true } });
    const events = (prismaMock.optOutEvent.createMany as any).mock.calls[0][0].data;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ tenantId: 't1', customerId: 1, phone: '+233241110000', channel: 'whatsapp', optedOut: true, reason: 'stop_reply' });
    expect(events[1]).toMatchObject({ customerId: 2 });
  });

  it('a phone nobody has still writes one event with no customer, and no flag', async () => {
    (prismaMock.customer.findMany as any).mockResolvedValue([]);
    await setOptOut({ tenantId: 't1', phone: '+233241110000', channel: 'sms', optedOut: false, reason: 'resubscribe' });
    expect(prismaMock.customer.updateMany).not.toHaveBeenCalled();
    expect((prismaMock.optOutEvent.createMany as any).mock.calls[0][0].data).toEqual([
      expect.objectContaining({ customerId: null, phone: '+233241110000', optedOut: false, reason: 'resubscribe', actorId: null }),
    ]);
  });

  it('a staff change stores the actor', async () => {
    (prismaMock.customer.findMany as any).mockResolvedValue([{ id: 5 }]);
    await setOptOut({ tenantId: 't1', customerId: 5, phone: '+233241110000', channel: 'sms', optedOut: true, reason: 'staff', actorId: 9 });
    expect((prismaMock.optOutEvent.createMany as any).mock.calls[0][0].data[0]).toMatchObject({ reason: 'staff', actorId: 9, channel: 'sms' });
  });
});
