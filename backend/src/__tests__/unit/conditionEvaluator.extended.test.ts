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
});
