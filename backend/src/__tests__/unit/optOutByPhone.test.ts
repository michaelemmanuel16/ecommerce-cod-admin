/** M9 wave 4 (COD-78): isOptedOut by phone, and the conversation assignee role rule. */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import '../mocks/logger.mock';
import { isOptedOut } from '../../services/messaging/optOutService';
import { updateConversation } from '../../services/messaging/conversationService';

jest.mock('../../services/whatsappService', () => ({ __esModule: true, default: {}, formatPhoneNumber: (p: string) => p }));
jest.mock('../../services/messaging/replyNotify', () => ({ notifyCustomerReply: jest.fn() }));

describe('isOptedOut', () => {
  beforeEach(() => {
    (prismaMock.customer.findMany as any).mockResolvedValue([]);
    (prismaMock.optOutEvent.findFirst as any).mockResolvedValue(null);
  });

  it('with no customer, the latest event decides: a stop_reply with no later resubscribe is opted out', async () => {
    (prismaMock.optOutEvent.findFirst as any).mockResolvedValue({ optedOut: true });
    expect(await isOptedOut('t1', 'whatsapp', '233241110000', null)).toBe(true);
    const where = (prismaMock.optOutEvent.findFirst as any).mock.calls[0][0];
    expect(where.where).toMatchObject({ tenantId: 't1', channel: 'whatsapp' });
    expect(where.where.phone.in).toEqual(expect.arrayContaining(['+233241110000']));
    expect(where.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('a later resubscribe clears it, and no event at all is not opted out', async () => {
    (prismaMock.optOutEvent.findFirst as any).mockResolvedValue({ optedOut: false });
    expect(await isOptedOut('t1', 'whatsapp', '+233241110000')).toBe(false);
    (prismaMock.optOutEvent.findFirst as any).mockResolvedValue(null);
    expect(await isOptedOut('t1', 'sms', '+233241110000')).toBe(false);
  });

  it('a customer with that phone decides by the flag of the channel, even when no customerId is given', async () => {
    (prismaMock.customer.findMany as any).mockResolvedValue([{ smsOptOut: true }]);
    expect(await isOptedOut('t1', 'sms', '0241110000')).toBe(true);
    expect((prismaMock.customer.findMany as any).mock.calls[0][0].where.OR[0].phoneNumber.in).toEqual(expect.arrayContaining(['+233241110000', '0241110000']));
    expect(prismaMock.optOutEvent.findFirst).not.toHaveBeenCalled();
    (prismaMock.customer.findMany as any).mockResolvedValue([{ whatsappOptOut: false }]);
    expect(await isOptedOut('t1', 'whatsapp', '233241110000')).toBe(false);
  });

  it('checks email by address', async () => {
    (prismaMock.customer.findMany as any).mockResolvedValue([{ emailOptOut: true }]);
    expect(await isOptedOut('t1', 'email', 'Ama@Example.com')).toBe(true);
    expect((prismaMock.customer.findMany as any).mock.calls[0][0].where.OR[0]).toEqual({ email: { equals: 'Ama@Example.com', mode: 'insensitive' } });
  });
});

describe('updateConversation assignee rule', () => {
  const conv = { id: 5, tenantId: 't1', channel: 'whatsapp', phone: '+233241110000', assignedToId: null, customerId: null };
  beforeEach(() => {
    (prismaMock.conversation.findFirst as any).mockResolvedValue(conv);
    (prismaMock.conversation.update as any).mockResolvedValue({ id: 5, assignedToId: 9, status: 'open' });
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(null);
  });
  const owner = { id: 1, role: 'admin' as const, tenantId: 't1' };

  it('refuses an assignee whose role cannot see conversations (400)', async () => {
    (prismaMock.user.findFirst as any).mockResolvedValue({ role: 'delivery_agent' });
    await expect(updateConversation(5, owner, { assignedToId: 9 })).rejects.toMatchObject({ statusCode: 400, message: 'This person cannot see conversations' });
    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
  });

  it('looks the assignee up by tenant and active flag; none found is 400', async () => {
    (prismaMock.user.findFirst as any).mockResolvedValue(null);
    await expect(updateConversation(5, owner, { assignedToId: 9 })).rejects.toMatchObject({ statusCode: 400 });
    expect((prismaMock.user.findFirst as any).mock.calls[0][0].where).toEqual({ id: 9, tenantId: 't1', isActive: true });
  });

  it('accepts manager, admin, super_admin and sales_rep', async () => {
    for (const role of ['manager', 'admin', 'super_admin', 'sales_rep']) {
      (prismaMock.user.findFirst as any).mockResolvedValue({ role });
      await expect(updateConversation(5, owner, { assignedToId: 9 })).resolves.toMatchObject({ assignedToId: 9 });
    }
  });

  it('a sales_rep may assign only to themselves or clear it (403 otherwise)', async () => {
    const rep = { id: 7, role: 'sales_rep' as const, tenantId: 't1' };
    await expect(updateConversation(5, rep, { assignedToId: 9 })).rejects.toMatchObject({ statusCode: 403 });
    (prismaMock.user.findFirst as any).mockResolvedValue({ role: 'sales_rep' });
    await expect(updateConversation(5, rep, { assignedToId: 7 })).resolves.toBeDefined();
    await expect(updateConversation(5, rep, { assignedToId: null })).resolves.toBeDefined();
  });
});
