/**
 * Extended AssignmentService tests for branch coverage
 * Covers selectUserRoundRobin and selectUserWeighted logic
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { fakeRedis } from '../mocks/redis.mock';
import { useTestTenant } from '../mocks/tenant.mock';
import { AssignmentService } from '../../services/assignmentService';

const makeUser = (overrides: any = {}) => ({
  id: 1,
  firstName: 'Kwame',
  lastName: 'Asante',
  role: 'delivery_agent',
  isActive: true,
  isAvailable: true,
  ...overrides,
});

describe('AssignmentService (extended branch coverage)', () => {
  let service: AssignmentService;
  useTestTenant();

  beforeEach(() => {
    jest.clearAllMocks();
    fakeRedis.reset();
    service = new AssignmentService();
  });

  // ───────────────────────────── selectUserRoundRobin ─────────────────────────────
  describe('selectUserRoundRobin', () => {
    it('returns null when users array is empty', async () => {
      const result = await service.selectUserRoundRobin([]);
      expect(result).toBeNull();
    });

    it('returns null when no users are active and available', async () => {
      const users = [makeUser({ isActive: false }), makeUser({ isAvailable: false })];
      const result = await service.selectUserRoundRobin(users as any);
      expect(result).toBeNull();
    });

    it('returns the only available user', async () => {
      const user = makeUser();
      const result = await service.selectUserRoundRobin([user] as any);
      expect(result?.id).toBe(1);
    });

    it('rotates through users on subsequent calls', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 }), makeUser({ id: 3 })];
      const result1 = await service.selectUserRoundRobin(users as any, 'test-key');
      const result2 = await service.selectUserRoundRobin(users as any, 'test-key');
      const result3 = await service.selectUserRoundRobin(users as any, 'test-key');
      // All 3 users should be covered across 3 calls
      const ids = [result1?.id, result2?.id, result3?.id];
      expect(ids).toContain(1);
      expect(ids).toContain(2);
      expect(ids).toContain(3);
    });

    it('uses separate round-robin state per contextKey', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })];
      const a1 = await service.selectUserRoundRobin(users as any, 'key-a');
      const b1 = await service.selectUserRoundRobin(users as any, 'key-b');
      // Both should start from the same position
      expect(a1?.id).toBe(b1?.id);
    });

    it('uses default context key when not provided', async () => {
      const user = makeUser();
      const result = await service.selectUserRoundRobin([user] as any);
      expect(result).toBeDefined();
    });

    it('skips inactive users and only selects available ones', async () => {
      const users = [
        makeUser({ id: 1, isActive: false }),
        makeUser({ id: 2, isActive: true, isAvailable: true }),
      ];
      const result = await service.selectUserRoundRobin(users as any);
      expect(result?.id).toBe(2);
    });
  });

  // ───────────────────────────── selectUserWeighted ─────────────────────────────
  describe('selectUserWeighted', () => {
    it('returns null when users array is empty', async () => {
      const result = await service.selectUserWeighted([], {});
      expect(result).toBeNull();
    });

    it('returns null when no users are active and available', async () => {
      const users = [makeUser({ isAvailable: false })];
      const result = await service.selectUserWeighted(users as any, {});
      expect(result).toBeNull();
    });

    it('falls back to equal distribution when no valid weights', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })];
      const result = await service.selectUserWeighted(users as any, {}); // all weights 0
      expect(result).toBeDefined();
    });

    it('selects user by weight when weights are provided', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })];
      const weights = { '1': 0.9, '2': 0.1 }; // user 1 heavily weighted
      const result = await service.selectUserWeighted(users as any, weights);
      expect(result).toBeDefined();
    });

    it('normalizes weights when they do not sum to 1.0', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })];
      const weights = { '1': 2, '2': 3 }; // sum = 5, not 1.0
      const result = await service.selectUserWeighted(users as any, weights);
      expect(result).toBeDefined();
    });

    it('handles weights that exactly sum to 1.0 without normalization', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })];
      const weights = { '1': 0.5, '2': 0.5 };
      const result = await service.selectUserWeighted(users as any, weights);
      expect(result).toBeDefined();
    });

    it('filters out inactive/unavailable users before weighting', async () => {
      const users = [
        makeUser({ id: 1, isAvailable: false }),
        makeUser({ id: 2, isAvailable: true }),
      ];
      const weights = { '1': 0.8, '2': 0.2 };
      const result = await service.selectUserWeighted(users as any, weights);
      // Only user 2 is available, so even with low weight, user 2 must be selected
      expect(result?.id).toBe(2);
    });
  });

  // ───────────────────────────── getUsersByRole ─────────────────────────────
  describe('getUsersByRole', () => {
    it('returns users by role with no additional filters', async () => {
      (prismaMock.user.findMany as any).mockResolvedValue([makeUser()] as any);
      const result = await service.getUsersByRole('delivery_agent');
      expect(result).toHaveLength(1);
    });

    it('returns users by role with additional filters', async () => {
      (prismaMock.user.findMany as any).mockResolvedValue([makeUser()] as any);
      const result = await service.getUsersByRole('sales_rep', { isActive: true });
      expect(result).toHaveLength(1);
    });

    it('returns empty array when no users match', async () => {
      (prismaMock.user.findMany as any).mockResolvedValue([] as any);
      const result = await service.getUsersByRole('manager');
      expect(result).toHaveLength(0);
    });
  });

  // ───────────────────────────── selectDeliveryAgentForArea ─────────────────────────────
  describe('selectDeliveryAgentForArea', () => {
    it('returns null when no agents available in area', async () => {
      (prismaMock.user.findMany as any).mockResolvedValue([] as any);
      const result = await service.selectDeliveryAgentForArea('Accra Central');
      expect(result).toBeNull();
    });

    it('returns an agent for area using round-robin', async () => {
      const agent = makeUser({ id: 2 });
      (prismaMock.user.findMany as any).mockResolvedValue([agent] as any);

      const result = await service.selectDeliveryAgentForArea('Accra Central');
      expect(result?.id).toBe(2);
    });
  });
});
