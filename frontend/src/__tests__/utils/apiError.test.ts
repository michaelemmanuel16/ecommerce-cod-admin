import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from '../../utils/apiError';

const refused = (data: unknown) => Object.assign(new Error('x'), { isAxiosError: true, response: { status: 400, data } });

describe('apiErrorMessage (F7d)', () => {
  it('reads the same sentence whichever field the API filled', () => {
    expect(apiErrorMessage(refused({ error: 'A', message: 'B' }), 'F')).toBe('A');
    expect(apiErrorMessage(refused({ message: 'B' }), 'F')).toBe('B');
    expect(apiErrorMessage(refused({ error: { message: 'N' } }), 'F')).toBe('N');
  });
  it('falls back for anything else', () => {
    expect(apiErrorMessage(refused({}), 'F')).toBe('F');
    expect(apiErrorMessage(new Error('plain'), 'F')).toBe('F');
  });
});
