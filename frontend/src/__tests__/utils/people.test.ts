import { describe, it, expect } from 'vitest';
import { initials } from '../../utils/people';

describe('initials', () => {
  it('uses the first and last name', () => {
    expect(initials('Ama Kofi Mensah')).toBe('AM');
    expect(initials('Ama Mensah')).toBe('AM');
  });
  it('keeps one-word names to one letter', () => {
    expect(initials('Ama')).toBe('A');
  });
  it('ignores extra spaces and empty input', () => {
    expect(initials('  ama   mensah ')).toBe('AM');
    expect(initials('')).toBe('');
  });
});
