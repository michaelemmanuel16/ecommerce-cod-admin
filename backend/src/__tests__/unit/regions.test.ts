import { describe, it, expect } from '@jest/globals';
import { State } from 'country-state-city';
import { getRegionsForCountry } from '../../utils/regions';

// Pins the same counts as frontend/src/utils/__tests__/reference.test.ts. If the two packages drift
// to different library versions, one side's count changes and its test fails.
describe('getRegionsForCountry (M1-T03)', () => {
  it.each([
    ['GH', 16],
    ['NG', 37],
  ])('%s returns %i unique names from the library', (code, count) => {
    const regions = getRegionsForCountry(code);
    expect(regions).toEqual(State.getStatesOfCountry(code).map((s) => s.name));
    expect(regions).toHaveLength(count);
    expect(new Set(regions).size).toBe(count);
  });
  it('accepts lower case and returns [] for an unknown code', () => {
    expect(getRegionsForCountry('gh')).toHaveLength(16);
    expect(getRegionsForCountry('ZZ')).toEqual([]);
  });
});
