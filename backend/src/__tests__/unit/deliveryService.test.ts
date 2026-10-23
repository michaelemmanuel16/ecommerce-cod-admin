import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { DeliveryService } from '../../services/deliveryService';
import { AppError } from '../../middleware/errorHandler';
import { OrderStatus, DeliveryProofType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GLAccountService } from '../../services/glAccountService';
import * as tenantContext from '../../utils/tenantContext';
import { useTestTenant } from '../mocks/tenant.mock';

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

// Mock GLAccountService
jest.mock('../../services/glAccountService', () => ({
  GLAccountService: {
    getAccountIdByCode: jest.fn().mockResolvedValue(10),
  },
}));

// The state machine has its own tests; here deliveryService is checked to hand each move to it.
jest.mock('../../services/orderStateMachine', () => ({
  ...(jest.requireActual('../../services/orderStateMachine') as object),
  transitionOrder: jest.fn(),
}));
import { transitionOrder } from '../../services/orderStateMachine';
const mockedTransition = transitionOrder as unknown as jest.MockedFunction<(...args: any[]) => Promise<any>>;

describe('DeliveryService', () => {
  useTestTenant();
  let deliveryService: DeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    deliveryService = new DeliveryService();
    (GLAccountService.getAccountIdByCode as jest.Mock).mockResolvedValue(10);
    // GL writes require a resolvable tenant; in production these run inside an
    // authenticated request. Mirror that ambient context here.
    jest.spyOn(tenantContext, 'getTenantId').mockReturnValue('tenant-a');
    mockedTransition.mockReset();
    mockedTransition.mockResolvedValue({
      changed: true, gl: { revenue: { id: 1, entryNumber: 'JE-001' }, revenueOrder: { id: 1, orderItems: [], deliveryAgentId: null, codAmount: 0 } }, afterCommit: jest.fn(),
    });
  });

  describe('completeDelivery', () => {
    const mockDelivery = {
      id: 1,
      orderId: 1,
      agentId: 2,
      actualDeliveryTime: null,
      order: {
        id: 1,
        orderNumber: '1001',
        codAmount: 210
      }
    };

    const completeData = {
      codAmount: 210,
      proofType: 'signature' as DeliveryProofType,
      proofData: 'John Doe signature',
      recipientName: 'John Doe',
      recipientPhone: '+1234567890'
    };

    it('should complete delivery successfully', async () => {
      (prismaMock.delivery.findUnique as any).mockResolvedValue(mockDelivery);
      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          delivery: {
            update: jest.fn().mockResolvedValue(mockDelivery)
          },
          order: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              totalAmount: 210,
              orderItems: [{
                quantity: 2,
                unitPrice: 100,
                product: {
                  name: 'Test Product',
                  cogs: new Decimal(50)
                }
              }],
              customerRepId: 1,
              deliveryAgent: { id: 2, commissionAmount: new Decimal(10) },
              customerRep: { id: 1, commissionAmount: new Decimal(10) }
            }),
            update: jest.fn().mockResolvedValue({})
          },
          transaction: {
            create: jest.fn().mockResolvedValue({})
          },
          agentCollection: {
            create: jest.fn().mockResolvedValue({ id: 1 })
          },
          agentBalance: {
            upsert: jest.fn().mockResolvedValue({})
          },
          journalEntry: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 1, entryNumber: 'JE-001', transactions: [] })
          },
          accountTransaction: {
            createMany: jest.fn().mockResolvedValue({})
          },
          product: {
            update: jest.fn().mockResolvedValue({})
          },
          user: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              commissionAmount: new Decimal(10)
            })
          },
          account: {
            findUnique: jest.fn().mockResolvedValue({
              normalBalance: 'debit',
              currentBalance: new Decimal(0)
            }),
            update: jest.fn().mockResolvedValue({})
          },
          $queryRaw: jest.fn().mockResolvedValue([])
        });
      });

      const result = await deliveryService.completeDelivery(
        '1',
        completeData as any,
        1
      );

      expect(result.message).toBe('Delivery completed successfully');
      expect(result.glEntry).toEqual({ id: 1, entryNumber: 'JE-001' });
      expect(mockedTransition).toHaveBeenCalledWith(1, 'delivered', expect.objectContaining({ kind: 'system' }),
        expect.objectContaining({ skipLegacyStock: true, postRevenueAlways: true, paymentStatus: 'collected' }));
    });
  });
});
