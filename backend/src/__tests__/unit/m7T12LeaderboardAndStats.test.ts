/**
 * M7-T12 (COD-65): Calls stats, upsell leaderboard, rep inbox events (unit tests)
 */
import { describe, it, expect } from '@jest/globals';
import { leaderboardQuerySchema } from '../../validators/rewardSchema';
import { checkAndNotifyLateCallbacks } from '../../services/notificationService';

describe('M7-T12 Validator and logic unit tests', () => {
  describe('leaderboardQuerySchema', () => {
    it('accepts role=upsell', () => {
      const parsed = leaderboardQuerySchema.safeParse({ role: 'upsell', period: 'month' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.role).toBe('upsell');
      }
    });

    it('accepts role=call_rep and role=delivery', () => {
      expect(leaderboardQuerySchema.safeParse({ role: 'call_rep' }).success).toBe(true);
      expect(leaderboardQuerySchema.safeParse({ role: 'delivery' }).success).toBe(true);
    });

    it('rejects invalid role', () => {
      const parsed = leaderboardQuerySchema.safeParse({ role: 'invalid_role' });
      expect(parsed.success).toBe(false);
    });
  });
});
