/**
 * Extended AssignmentService tests for branch coverage
 * Covers selectUserRoundRobin and selectUserWeighted logic
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// The cursor row is covered in the integration test; here it is one in-memory SWRR state per scope.
const cursors = new Map<string, Record<string, number>>();
jest.mock('../../services/assignmentCursor', () => ({
  __esModule: true,
  pickWithCursor: async (scope: string, _role: string, _rotation: unknown, available: any[]) => {
    const { swrrPick } = jest.requireActual('../../services/assignmentCursor') as typeof import('../../services/assignmentCursor');
    if (!cursors.has(scope)) cursors.set(scope, {});
    return swrrPick(cursors.get(scope)!, available);
  },
}));
const mockAlert = jest.fn();
jest.mock('../../services/notificationService', () => ({
  __esModule: true,
  createNotification: jest.fn(),
  notifyAdminsNoAssigneeAvailable: (...args: unknown[]) => mockAlert(...args),
}));

import { prismaMock } from '../mocks/prisma.mock';
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

  beforeEach(() => {
    jest.clearAllMocks();
    cursors.clear();
    (prismaMock.agentBalance.findMany as any).mockResolvedValue([]);
    service = new AssignmentService();
  });

  const ids = async (n: number, pick: () => Promise<any>) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await pick())?.id);
    return out;
  };

  // ───────────────────────────── selectUserRoundRobin ─────────────────────────────
  describe('selectUserRoundRobin', () => {
    it('returns null and alerts when the rotation is empty', async () => {
      expect(await service.selectUserRoundRobin([], 'sales_rep', 'k')).toBeNull();
      expect(mockAlert).toHaveBeenCalledWith('k', 'sales_rep', 'customer representative');
    });

    it('returns null and alerts when nobody is active and available', async () => {
      const users = [makeUser({ id: 1, isActive: false }), makeUser({ id: 2, isAvailable: false })];
      expect(await service.selectUserRoundRobin(users as any, 'delivery_agent', 'k')).toBeNull();
      expect(mockAlert).toHaveBeenCalledWith('k', 'delivery_agent', 'delivery agent');
    });

    it('rotates in a fixed order', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 }), makeUser({ id: 3 })] as any;
      expect(await ids(6, () => service.selectUserRoundRobin(users, 'delivery_agent', 'k'))).toEqual([1, 2, 3, 1, 2, 3]);
    });

    it('keeps a separate cursor per contextKey', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })] as any;
      expect((await service.selectUserRoundRobin(users, 'delivery_agent', 'key-a'))?.id).toBe(1);
      expect((await service.selectUserRoundRobin(users, 'delivery_agent', 'key-a'))?.id).toBe(2);
      expect((await service.selectUserRoundRobin(users, 'delivery_agent', 'key-b'))?.id).toBe(1);
    });

    it('skips an away or inactive user and does not alert', async () => {
      const users = [makeUser({ id: 1, isActive: false }), makeUser({ id: 2 }), makeUser({ id: 3, isAvailable: false })] as any;
      expect(await ids(3, () => service.selectUserRoundRobin(users, 'delivery_agent', 'k'))).toEqual([2, 2, 2]);
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('skips an agent who is blocked for unpaid cash', async () => {
      (prismaMock.agentBalance.findMany as any).mockResolvedValue([{ agentId: 1 }]);
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })] as any;
      expect(await ids(2, () => service.selectUserRoundRobin(users, 'delivery_agent', 'k'))).toEqual([2, 2]);
    });
  });

  // ───────────────────────────── selectUserWeighted ─────────────────────────────
  describe('selectUserWeighted', () => {
    it('returns null and alerts when the rotation is empty', async () => {
      expect(await service.selectUserWeighted([], {}, 'sales_rep', 'k')).toBeNull();
      expect(mockAlert).toHaveBeenCalled();
    });

    it('returns null when nobody is available', async () => {
      expect(await service.selectUserWeighted([makeUser({ isAvailable: false })] as any, {}, 'delivery_agent', 'k')).toBeNull();
    });

    it('uses equal shares when no available user has a weight', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })] as any;
      expect(await ids(4, () => service.selectUserWeighted(users, {}, 'delivery_agent', 'k'))).toEqual([1, 2, 1, 2]);
    });

    it('gives weights 0.9 and 0.1 an exact split over a cycle', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })] as any;
      const picked = await ids(10, () => service.selectUserWeighted(users, { 1: 0.9, 2: 0.1 }, 'delivery_agent', 'k'));
      expect(picked.filter((id) => id === 1)).toHaveLength(9);
      expect(picked.filter((id) => id === 2)).toHaveLength(1);
    });

    it('treats weights 2 and 3 as shares 2:3 (no need to sum to 1)', async () => {
      const users = [makeUser({ id: 1 }), makeUser({ id: 2 })] as any;
      const picked = await ids(5, () => service.selectUserWeighted(users, { 1: 2, 2: 3 }, 'delivery_agent', 'k'));
      expect(picked.filter((id) => id === 1)).toHaveLength(2);
      expect(picked.filter((id) => id === 2)).toHaveLength(3);
    });

    it('skips an unavailable user even with the larger weight', async () => {
      const users = [makeUser({ id: 1, isAvailable: false }), makeUser({ id: 2 })] as any;
      expect(await ids(3, () => service.selectUserWeighted(users, { 1: 0.8, 2: 0.2 }, 'delivery_agent', 'k'))).toEqual([2, 2, 2]);
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
    it('returns null and alerts when there are no agents', async () => {
      (prismaMock.user.findMany as any).mockResolvedValue([] as any);
      const result = await service.selectDeliveryAgentForArea('Accra Central');
      expect(result).toBeNull();
      expect(mockAlert).toHaveBeenCalledWith('delivery_agent_Accra Central', 'delivery_agent', 'delivery agent');
    });

    it('returns an agent for area using round-robin', async () => {
      const agent = makeUser({ id: 2 });
      (prismaMock.user.findMany as any).mockResolvedValue([agent] as any);

      const result = await service.selectDeliveryAgentForArea('Accra Central');
      expect(result?.id).toBe(2);
    });
  });
});
