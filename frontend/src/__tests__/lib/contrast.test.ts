import { describe, it, expect } from 'vitest';
import { buttonContrastLow, contrastRatio } from '../../lib/contrast';

describe('contrastRatio (WCAG)', () => {
  it('is 21 for black on white and 1 for the same colour', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  it('does not depend on the order of the colours', () => {
    expect(contrastRatio('#0f172a', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#0f172a'), 8);
  });

  it('matches known values: #767676 on white is about 4.54', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
  });

  it('reads 3-digit hex and is NaN for a bad colour', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('red', '#000')).toBeNaN();
  });
});

describe('buttonContrastLow', () => {
  it('warns under 4.5:1 against white text', () => {
    expect(buttonContrastLow('#fde047')).toBe(true);
    expect(buttonContrastLow('#777777')).toBe(true);
  });

  it('does not warn for dark colours or colours it cannot read', () => {
    expect(buttonContrastLow('#0f172a')).toBe(false);
    expect(buttonContrastLow('not-a-colour')).toBe(false);
  });
});
