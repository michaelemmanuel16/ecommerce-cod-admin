import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module to prevent it from starting
jest.mock('../../server', () => {
  const m = { emit: jest.fn(), to: jest.fn() };
  m.to.mockReturnValue(m);
  return { io: m };
});

// Mock whatsappTokenRefreshService
jest.mock('../../services/whatsappTokenRefreshService', () => ({
  refreshTokenIfNeeded: jest.fn().mockResolvedValue({ refreshed: false }),
}));

// Mock providerCrypto
jest.mock('../../utils/providerCrypto', () => ({
  decryptProviderSecrets: jest.fn().mockReturnValue(null),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { prismaMock } from '../mocks/prisma.mock';

describe('Opt-out enforcement', () => {
  const mockOrderBase = {
    id: 100,
    status: 'confirmed',
    totalAmount: 50,
    orderItems: [
      { product: { name: 'Widget' } },
    ],
    deliveryAgent: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendSmsForOrder', () => {
    // Dynamic import to get fresh module after mocks are set up
    let sendSmsForOrder: typeof import('../../services/smsService').sendSmsForOrder;

    beforeEach(async () => {
      const mod = await import('../../services/smsService');
      sendSmsForOrder = mod.sendSmsForOrder;
    });

    it('should return messageLogId: 0 when customer has smsOptOut: true', async () => {
      const orderWithOptOut = {
        ...mockOrderBase,
        customer: {
          id: 10,
          firstName: 'John',
          lastName: 'Doe',
          phoneNumber: '+233241111111',
          smsOptOut: true,
          whatsappOptOut: false,
        },
      };
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue(orderWithOptOut);

      const result = await sendSmsForOrder('confirmed', 100);

      expect(result).toEqual({ messageLogId: 0 });
      // Should NOT have created a messageLog (sendSms not called)
      expect(prismaMock.messageLog.create).not.toHaveBeenCalled();
    });

    it('should proceed with sending when smsOptOut is false', async () => {
      const orderWithoutOptOut = {
        ...mockOrderBase,
        customer: {
          id: 10,
          firstName: 'John',
          lastName: 'Doe',
          phoneNumber: '+233241111111',
          smsOptOut: false,
          whatsappOptOut: false,
        },
      };
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue(orderWithoutOptOut);
      (prismaMock.messageLog.create as jest.Mock).mockResolvedValue({ id: 501 });
      // Mock the systemConfig for getDbSmsConfig (config not set, skip actual dispatch)
      (prismaMock.systemConfig.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await sendSmsForOrder('confirmed', 100);

      expect(result.messageLogId).toBe(501);
      expect(prismaMock.messageLog.create).toHaveBeenCalled();
    });

    it('should throw when order is not found', async () => {
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(sendSmsForOrder('confirmed', 999)).rejects.toThrow(
        'Order 999 not found or has no customer',
      );
    });

    it('should throw for unknown template key', async () => {
      await expect(sendSmsForOrder('nonexistent', 100)).rejects.toThrow(
        'Unknown SMS template: nonexistent',
      );
    });
  });

  describe('sendWhatsAppForOrder', () => {
    let sendWhatsAppForOrder: typeof import('../../services/whatsappService').sendWhatsAppForOrder;

    beforeEach(async () => {
      const mod = await import('../../services/whatsappService');
      sendWhatsAppForOrder = mod.sendWhatsAppForOrder;
    });

    it('should return messageLogId: 0 when customer has whatsappOptOut: true', async () => {
      const orderWithOptOut = {
        ...mockOrderBase,
        customer: {
          id: 10,
          firstName: 'Jane',
          lastName: 'Smith',
          phoneNumber: '+233242222222',
          smsOptOut: false,
          whatsappOptOut: true,
        },
      };
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue(orderWithOptOut);

      const result = await sendWhatsAppForOrder('confirmed', 100);

      expect(result).toEqual({ messageLogId: 0 });
      expect(prismaMock.messageLog.create).not.toHaveBeenCalled();
    });

    it('should proceed with sending when whatsappOptOut is false', async () => {
      const orderWithoutOptOut = {
        ...mockOrderBase,
        customer: {
          id: 10,
          firstName: 'Jane',
          lastName: 'Smith',
          phoneNumber: '+233242222222',
          smsOptOut: false,
          whatsappOptOut: false,
        },
      };
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue(orderWithoutOptOut);
      (prismaMock.messageLog.create as jest.Mock).mockResolvedValue({ id: 601 });
      // Mock the systemConfig for getConfig (WhatsApp not configured, but message gets logged)
      (prismaMock.systemConfig.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await sendWhatsAppForOrder('confirmed', 100);

      expect(result.messageLogId).toBe(601);
      expect(prismaMock.messageLog.create).toHaveBeenCalled();
    });

    it('should throw when order is not found', async () => {
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(sendWhatsAppForOrder('confirmed', 999)).rejects.toThrow(
        'Order 999 not found or has no customer',
      );
    });

    it('should throw for unknown template key', async () => {
      await expect(sendWhatsAppForOrder('nonexistent', 100)).rejects.toThrow(
        'Unknown WhatsApp template: nonexistent',
      );
    });
  });
});
