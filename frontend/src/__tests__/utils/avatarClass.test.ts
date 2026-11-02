import { describe, it, expect } from 'vitest';
import { AVATAR_TONES, avatarClass } from '../../utils/people';

describe('avatarClass', () => {
  it('tints by id from the five tones; a company is square, an AI agent violet', () => {
    expect(avatarClass('person', 0)).toBe('a pine');
    expect(avatarClass('person', 7)).toBe(`a ${AVATAR_TONES[2]}`);
    expect(avatarClass('company', 1)).toBe('a gold co');
    expect(avatarClass('ai_agent', 2)).toBe('a violet ai');
  });

  it('takes the tone list of a page; [""] gives no tint', () => {
    expect(avatarClass('person', 3, ['x', 'y'])).toBe('a y');
    expect(avatarClass('person', 3, [''])).toBe('a');
    expect(avatarClass('ai_agent', 3, [''])).toBe('a ai');
    expect(avatarClass('company', 3, [''])).toBe('a co');
  });
});
