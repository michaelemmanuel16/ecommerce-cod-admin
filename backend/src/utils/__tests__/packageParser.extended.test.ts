/**
 * Extended packageParser tests for branch coverage
 * Covers fallback extraction paths not covered by main tests
 */
import { describe, it, expect } from '@jest/globals';
import { parsePackageField, isValidPackageString } from '../packageParser';

describe('Package Parser (extended branch coverage)', () => {
  describe('extractQuantity - anyNumberMatch fallback', () => {
    it('extracts number from arbitrary position when no BUY pattern', () => {
      // No BUY prefix, no PCS pattern, but has a number → fallback anyNumberMatch
      const result = parsePackageField('SPECIAL 3 UNITS - GH₵250');
      expect(result.quantity).toBe(3);
      expect(result.price).toBe(250);
    });
  });

  describe('extractPrice - fallback number match', () => {
    it('falls back to plain number when no GH currency prefix', () => {
      // No GH₵/GHC prefix but has a 2-4 digit number → fallback price
      const result = parsePackageField('BUY ONE SET: 250');
      expect(result.quantity).toBe(1);
      expect(result.price).toBe(250);
    });
  });
});
