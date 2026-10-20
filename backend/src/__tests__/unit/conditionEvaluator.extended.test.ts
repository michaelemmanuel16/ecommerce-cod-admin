/**
 * Extended conditionEvaluator tests for final branch coverage
 * Covers: getNestedValue with truthy non-object context (typeof !== 'object' branch)
 */
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { evaluateConditions, evaluateRule } from '../../utils/conditionEvaluator';
import { Prisma } from '@prisma/client';

describe('conditionEvaluator (extended branch coverage)', () => {
  describe('getNestedValue - truthy non-object branch', () => {
    it('returns false when context is a primitive (number) - typeof !== object branch', () => {
      const conditions = {
        logic: 'AND' as const,
        rules: [{ field: 'status', operator: 'equals' as const, value: 'active' }],
      };
      // context = 42 (truthy number, not object) → getNestedValue returns undefined
      // evaluateConditions should return false since undefined !== 'active'
      const result = evaluateConditions(conditions, 42 as any);
      expect(result).toBe(false);
    });
  });

  describe('evaluateRule - catch block (error thrown by operator)', () => {
    it('returns false when operator throws an error (e.g. matches with null expected)', () => {
      // 'matches' operator accesses expected.pattern - throws on null
      const result = evaluateRule('hello', 'matches', null as any);
      expect(result).toBe(false);
    });
  });

  describe('money fields (Prisma.Decimal)', () => {
    it('compares a Decimal against a number threshold', () => {
      const spent = new Prisma.Decimal('1000.50');
      expect(evaluateRule(spent, 'greater_than', 1000)).toBe(true);
      expect(evaluateRule(spent, 'greater_than', 1001)).toBe(false);
      expect(evaluateRule(spent, 'less_than', 1001)).toBe(true);
      expect(evaluateRule(spent, 'greater_than_or_equal', 1000.5)).toBe(true);
      expect(evaluateRule(spent, 'less_than_or_equal', 1000)).toBe(false);
      expect(evaluateRule(spent, 'equals', 1000.5)).toBe(true);
      expect(evaluateRule(spent, 'not_equals', 1000.5)).toBe(false);
    });

    it('does not treat a money string as a number', () => {
      expect(evaluateRule('1000.50', 'greater_than', 1000)).toBe(false);
    });
  });
});
