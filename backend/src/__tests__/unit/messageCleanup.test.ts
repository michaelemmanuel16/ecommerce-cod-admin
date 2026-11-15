import { describe, it, expect, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import '../mocks/logger.mock';
import { processCleanupOldMessages, processDropExpiredPendingEvents } from '../../queues/messageCleanupQueue';

describe('message log clean-up', () => {
  it('never deletes a row that belongs to a campaign, so campaign counters survive', async () => {
    (prismaMock.tenant.findMany as any).mockResolvedValue([{ id: 't1' }]);
    (prismaMock.messageLog.findMany as any).mockResolvedValue([{ id: 1 }]);
    (prismaMock.messageLog.deleteMany as any).mockResolvedValue({ count: 1 });
    await processCleanupOldMessages();
    const where = (prismaMock.messageLog.findMany as any).mock.calls[0][0].where;
    expect(where.campaignId).toBeNull();
    expect(where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('the held-event job drops expired events', async () => {
    (prismaMock.pendingMessageEvent.findMany as any).mockResolvedValue([{ id: 1, provider: 'arkesel', providerMessageId: 'a', status: 'delivered' }]);
    await processDropExpiredPendingEvents();
    expect(prismaMock.pendingMessageEvent.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1] } } });
  });
});
