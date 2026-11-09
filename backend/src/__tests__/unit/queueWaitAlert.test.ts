import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { checkQueueWaitAlerts, notifyQueueWaitAlert } from '../../services/queueAlertService';
import prisma from '../../utils/prisma';
import * as notificationService from '../../services/notificationService';

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    systemConfig: { findUnique: jest.fn() },
    order: { findMany: jest.fn() },
    notification: { findFirst: jest.fn(), create: jest.fn() },
    user: { findMany: jest.fn() },
  },
}));

jest.mock('../../services/notificationService', () => ({
  __esModule: true,
  createNotification: jest.fn(),
}));

describe('M7-T05: Queue wait alert service tests', () => {
  const mockPrisma = prisma as any;
  const mockCreateNotification = notificationService.createNotification as jest.MockedFunction<typeof notificationService.createNotification>;
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
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      '1',
      'queue_wait_alert',
      'Queue wait alert',
      expect.stringContaining('Order #101 has been waiting 45 min'),
      expect.objectContaining({ orderId: 101, orderNumber: '101', alertMinutes: 30 })
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      '2',
      'queue_wait_alert',
      'Queue wait alert',
      expect.stringContaining('Order #101 has been waiting 45 min'),
      expect.objectContaining({ orderId: 101, orderNumber: '101', alertMinutes: 30 })
    );
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
});
