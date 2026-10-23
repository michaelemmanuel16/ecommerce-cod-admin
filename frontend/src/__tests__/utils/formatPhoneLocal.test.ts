import { describe, expect, it } from 'vitest';
import { formatPhoneLocal } from '../../utils/format';

describe('formatPhoneLocal', () => {
  it('shows Ghana and Nigeria numbers in local format', () => {
    expect(formatPhoneLocal('+233245550103')).toBe('024 555 0103');
    expect(formatPhoneLocal('+2348031234567')).toBe('0803 123 4567');
  });

  it('leaves other values as stored', () => {
    expect(formatPhoneLocal('0245550103')).toBe('0245550103');
  });
});
