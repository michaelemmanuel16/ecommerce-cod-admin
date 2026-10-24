import { describe, it, expect } from 'vitest';
import { AxiosError } from 'axios';
import { allowed } from '../../services/delivery-partners.service';

const failure = (status: number) => new AxiosError('x', 'ERR', undefined, undefined, { status } as never);

describe('allowed', () => {
  it('passes the answer through', async () => {
    expect(await allowed(Promise.resolve([1]))).toEqual([1]);
  });

  it('turns a 403 into null', async () => {
    expect(await allowed(Promise.reject(failure(403)))).toBeNull();
  });

  it('lets any other failure reject', async () => {
    await expect(allowed(Promise.reject(failure(500)))).rejects.toBeTruthy();
    await expect(allowed(Promise.reject(new Error('network')))).rejects.toThrow('network');
  });
});
