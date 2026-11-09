import { describe, it, expect } from '@jest/globals';
import {
  riskLevelOf,
  isCodBlocked,
  customerNeedsManualCall,
  REFUSALS_HIGH_RISK,
  REFUSALS_COD_BLOCKED,
} from '../../services/refusalRuleService';

describe('Refusal rule logic (unit)', () => {
  describe('riskLevelOf', () => {
    it('0 refusals has normal risk', () => {
      expect(riskLevelOf(0)).toBe('normal');
    });

    it('1 refusal: no change (normal risk)', () => {
      expect(riskLevelOf(1)).toBe('normal');
    });

    it('2 refusals: riskLevel=high', () => {
      expect(riskLevelOf(REFUSALS_HIGH_RISK)).toBe('high');
      expect(riskLevelOf(2)).toBe('high');
    });

    it('3 refusals: riskLevel=high', () => {
      expect(riskLevelOf(REFUSALS_COD_BLOCKED)).toBe('high');
      expect(riskLevelOf(5)).toBe('high');
    });
  });

  describe('isCodBlocked and customerNeedsManualCall', () => {
    it('returns false for null/undefined customer', () => {
      expect(isCodBlocked(null)).toBe(false);
      expect(isCodBlocked(undefined)).toBe(false);
      expect(customerNeedsManualCall(null)).toBe(false);
    });

    it('returns true when codBlocked is explicitly true', () => {
      expect(isCodBlocked({ codBlocked: true })).toBe(true);
      expect(customerNeedsManualCall({ codBlocked: true })).toBe(true);
    });

    it('returns false when codBlocked is explicitly false', () => {
      expect(isCodBlocked({ codBlocked: false, refusedOrders: 1 })).toBe(false);
      expect(customerNeedsManualCall({ codBlocked: false, refusedOrders: 1 })).toBe(false);
    });

    it('returns true when customer has 3 or more refusals and no override', () => {
      expect(isCodBlocked({ refusedOrders: 3, codOverride: false })).toBe(true);
      expect(customerNeedsManualCall({ refusedOrders: 3, codOverride: false })).toBe(true);
      expect(customerNeedsManualCall({ refusedOrders: 4 })).toBe(true);
    });

    it('returns false when customer has active override allow=true', () => {
      expect(isCodBlocked({ codOverride: true, refusedOrders: 0 })).toBe(false);
      expect(customerNeedsManualCall({ codOverride: true, refusedOrders: 0 })).toBe(false);
    });

    it('returns false when customer has 1 or 2 refusals', () => {
      expect(isCodBlocked({ codBlocked: false, refusedOrders: 1 })).toBe(false);
      expect(customerNeedsManualCall({ codBlocked: false, refusedOrders: 1 })).toBe(false);
      expect(isCodBlocked({ codBlocked: false, refusedOrders: 2 })).toBe(false);
      expect(customerNeedsManualCall({ codBlocked: false, refusedOrders: 2 })).toBe(false);
    });

    it('returns true when admin manually turned COD off (override allow=false)', () => {
      expect(isCodBlocked({ codOverrideAt: new Date(), codOverride: false })).toBe(true);
      expect(customerNeedsManualCall({ codOverrideAt: new Date(), codOverride: false })).toBe(true);
    });
  });
});
