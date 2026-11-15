import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { checkQueueWaitAlerts, notifyQueueWaitAlert, formatWaitMinutes } from '../../services/queueAlertService';
import prisma from '../../utils/prisma';
import * as inboxService from '../../services/inbox/inboxService';

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    systemConfig: { findUnique: jest.fn() },
    order: { findMany: jest.fn() },
    notification: { findFirst: jest.fn(), create: jest.fn() },
    user: { findMany: jest.fn() },
  },
}));

jest.mock('../../services/inbox/inboxService', () => ({
  __esModule: true,
  notify: jest.fn(),
}));

describe('M7-T05: Queue wait alert service tests', () => {
  const mockPrisma = prisma as any;
  const mockCreateNotification = inboxService.notify as jest.MockedFunction<typeof inboxService.notify>;
  const tenantId = 'tenant-test-ops';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('notifies managers and admins when order waits >= 30 min (default limit)', async () => {
    // Standard hours: Mon 08:00 - 20:00
    mockPrisma.systemConfig.findUnique.mockResolvedValue({
      operatingHours: {
        days: { monday: { open: '08:00', close: '20:00', enabled: true } },
        queueWaitAlertMinutes: 30,
      },
      timeZone: 'Africa/Accra',
    });

    const now = new Date('2026-10-05T08:45:00Z'); // Monday 08:45
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: 101,
        orderNumber: 'ORD-101',
        createdAt: new Date('2026-10-05T08:00:00Z'), // 45 min waiting >= 30
        tenantId,
      },
      {
        id: 102,
        orderNumber: 'ORD-102',
        createdAt: new Date('2026-10-05T08:25:00Z'), // 20 min waiting < 30
        tenantId,
      },
    ]);

    // No existing alert for 101
    mockPrisma.notification.findFirst.mockResolvedValue(null);

    // Manager and admin users
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 1, role: 'super_admin' },
      { id: 2, role: 'manager' },
    ]);

    const alerted = await checkQueueWaitAlerts(tenantId, now);

    expect(alerted).toEqual([101]);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      event: 'queue_wait',
      subject: { type: 'order', id: 101 },
      recipients: [1, 2],
      title: 'Queue wait alert',
      message: expect.stringContaining('Order #101 has been waiting 45 min'),
      data: expect.objectContaining({ orderId: 101, orderNumber: '101', alertMinutes: 30 }),
    }));
  });

  it('respects custom settings key for queueWaitAlertMinutes', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({
      operatingHours: {
        days: { monday: { open: '08:00', close: '20:00', enabled: true } },
        queueWaitAlertMinutes: 15, // Custom 15 min alert
      },
      timeZone: 'Africa/Accra',
    });

    const now = new Date('2026-10-05T08:20:00Z'); // Monday 08:20
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: 201,
        orderNumber: 'ORD-201',
        createdAt: new Date('2026-10-05T08:00:00Z'), // 20 min >= 15
        tenantId,
      },
    ]);

    mockPrisma.notification.findFirst.mockResolvedValue(null);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 1, role: 'admin' }]);

    const alerted = await checkQueueWaitAlerts(tenantId, now);
    expect(alerted).toEqual([201]);
  });

  it('is idempotent: fires notification once per order', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({
      operatingHours: {
        days: { monday: { open: '08:00', close: '20:00', enabled: true } },
      },
      timeZone: 'Africa/Accra',
    });

    const now = new Date('2026-10-05T09:00:00Z');
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: 301,
        orderNumber: 'ORD-301',
        createdAt: new Date('2026-10-05T08:00:00Z'),
        tenantId,
      },
    ]);

    // Notification already exists
    mockPrisma.notification.findFirst.mockResolvedValue({ id: 999 });

    const alerted = await checkQueueWaitAlerts(tenantId, now);

    expect(alerted).toEqual([]);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('only looks at orders created in the last 24 hours, so a first sweep does not alert weeks of old orders', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ operatingHours: { queueWaitAlertMinutes: 30 }, timeZone: 'Africa/Accra' });
    mockPrisma.order.findMany.mockResolvedValue([]);
    const now = new Date('2026-10-05T12:00:00Z');
    await checkQueueWaitAlerts(tenantId, now);
    const where = mockPrisma.order.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gt).toEqual(new Date('2026-10-04T12:00:00Z'));
    expect(where.createdAt.lte).toEqual(new Date('2026-10-05T11:30:00Z'));
  });

  it('a said-NO order waiting 31 open minutes alerts; the second run does not alert again', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({
      operatingHours: {
        days: { monday: { open: '08:00', close: '20:00', enabled: true } },
        queueWaitAlertMinutes: 30,
      },
      timeZone: 'Africa/Accra',
    });

    const createdAt = new Date('2026-10-05T08:00:00Z');
    const now = new Date('2026-10-05T08:31:00Z'); // 31 min open
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: 401,
        orderNumber: 'ORD-401',
        createdAt,
        tenantId,
        customerResponse: 'no',
      },
    ]);

    // First run: no notification exists yet
    mockPrisma.notification.findFirst.mockResolvedValueOnce(null);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 1, role: 'admin' }]);

    const alertedFirst = await checkQueueWaitAlerts(tenantId, now);
    expect(alertedFirst).toEqual([401]);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);

    // Second run: notification exists
    mockPrisma.notification.findFirst.mockResolvedValueOnce({ id: 888 });
    const alertedSecond = await checkQueueWaitAlerts(tenantId, now);
    expect(alertedSecond).toEqual([]);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1); // not called again
  });
});

describe('formatWaitMinutes', () => {
  it('uses plain units', () => {
    expect(formatWaitMinutes(41)).toBe('41 min');
    expect(formatWaitMinutes(59.4)).toBe('59 min');
    expect(formatWaitMinutes(60)).toBe('1 h');
    expect(formatWaitMinutes(185)).toBe('3 h 5 min');
    expect(formatWaitMinutes(180)).toBe('3 h');
    expect(formatWaitMinutes(1439)).toBe('23 h 59 min');
    expect(formatWaitMinutes(1440)).toBe('1 day');
    expect(formatWaitMinutes(21 * 1440 + 700)).toBe('21 days');
  });
});
