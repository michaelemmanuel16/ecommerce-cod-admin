import { parsePackageField, isValidPackageString } from '../packageParser';

describe('Package Parser', () => {
  describe('Pattern 1: BUY [NUMBER] SET(S) - GH₵XXX', () => {
    test('should parse "BUY ONE SET - GH₵250"', () => {
      const result = parsePackageField('BUY ONE SET - GH₵250');
      expect(result.quantity).toBe(1);
      expect(result.price).toBe(250);
      expect(result.rawPackage).toBe('BUY ONE SET - GH₵250');
    });

    test('should parse "BUY TWO SETS - GH₵450"', () => {
      const result = parsePackageField('BUY TWO SETS - GH₵450');
      expect(result.quantity).toBe(2);
      expect(result.price).toBe(450);
    });

    test('should parse "BUY THREE SETS - GH₵650"', () => {
      const result = parsePackageField('BUY THREE SETS - GH₵650');
      expect(result.quantity).toBe(3);
      expect(result.price).toBe(650);
    });
  });

  describe('Pattern 2: BUY [NUMBER]: GHCXXX', () => {
    test('should parse "BUY ONE: GHC250"', () => {
      const result = parsePackageField('BUY ONE: GHC250');
      expect(result.quantity).toBe(1);
      expect(result.price).toBe(250);
    });

    test('should parse "BUY TWO: GHC450"', () => {
      const result = parsePackageField('BUY TWO: GHC450');
      expect(result.quantity).toBe(2);
      expect(result.price).toBe(450);
    });

    test('should parse "BUY THREE: GHC650"', () => {
      const result = parsePackageField('BUY THREE: GHC650');
      expect(result.quantity).toBe(3);
      expect(result.price).toBe(650);
    });
  });

  describe('Pattern 3: BUY X GET X (NPCS): GHCXXX', () => {
    test('should parse "BUY 1 GET 1 (2PCS): GHC250"', () => {
      const result = parsePackageField('BUY 1 GET 1 (2PCS): GHC250');
      expect(result.quantity).toBe(2);
      expect(result.price).toBe(250);
    });

    test('should parse "BUY 2 GET 2 (4PCS): GHC450"', () => {
      const result = parsePackageField('BUY 2 GET 2 (4PCS): GHC450');
      expect(result.quantity).toBe(4);
      expect(result.price).toBe(450);
    });

    test('should parse "BUY 3 GET 3 (6PCS): GHC650"', () => {
      const result = parsePackageField('BUY 3 GET 3 (6PCS): GHC650');
      expect(result.quantity).toBe(6);
      expect(result.price).toBe(650);
    });
  });

  describe('Edge Cases', () => {
    test('should handle different cedi formats (GH₵, GHC, GHS)', () => {
      expect(parsePackageField('BUY ONE SET - GH₵250').price).toBe(250);
      expect(parsePackageField('BUY ONE SET - GHC250').price).toBe(250);
      expect(parsePackageField('BUY ONE SET - GHS250').price).toBe(250);
      expect(parsePackageField('BUY ONE SET - GHC 250').price).toBe(250);
    });

    test('should handle lowercase input', () => {
      const result = parsePackageField('buy two sets - gh₵450');
      expect(result.quantity).toBe(2);
      expect(result.price).toBe(450);
    });

    test('should handle numeric quantities', () => {
      expect(parsePackageField('BUY 1 SET - GH₵250').quantity).toBe(1);
      expect(parsePackageField('BUY 2 SETS - GH₵450').quantity).toBe(2);
      expect(parsePackageField('BUY 3 SETS - GH₵650').quantity).toBe(3);
    });

    test('should return defaults for empty string', () => {
      const result = parsePackageField('');
      expect(result.quantity).toBe(1);
      expect(result.price).toBe(0);
      expect(result.rawPackage).toBe('');
    });

    test('should return defaults for invalid input', () => {
      const result = parsePackageField('invalid package string');
      expect(result.quantity).toBe(1);
      expect(result.price).toBe(0);
    });

    test('should handle null/undefined input', () => {
      const result1 = parsePackageField(null as any);
      const result2 = parsePackageField(undefined as any);

      expect(result1.quantity).toBe(1);
      expect(result1.price).toBe(0);
      expect(result2.quantity).toBe(1);
      expect(result2.price).toBe(0);
    });
  });

  describe('isValidPackageString', () => {
    test('should return true for valid package strings', () => {
      expect(isValidPackageString('BUY TWO SETS - GH₵450')).toBe(true);
      expect(isValidPackageString('BUY ONE: GHC250')).toBe(true);
      expect(isValidPackageString('BUY 2 GET 2 (4PCS): GHC450')).toBe(true);
    });

    test('should return false for invalid package strings', () => {
      expect(isValidPackageString('')).toBe(false);
      expect(isValidPackageString('invalid')).toBe(false);
      expect(isValidPackageString('BUY TWO SETS')).toBe(false); // No price
      // Note: "GH₵450" is considered valid - defaults to quantity=1, price=450
    });
  });
});
