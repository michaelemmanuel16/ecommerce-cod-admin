import { describe, it, expect, jest } from '@jest/globals';
import * as jwt from 'jsonwebtoken';
import { authenticate } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const call = (token: string) => {
  const req: any = { headers: { authorization: `Bearer ${token}` }, method: 'GET', path: '/x' };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  authenticate(req, res, jest.fn() as any);
  return res;
};

describe('authenticate: JWT failures', () => {
  const payload = { id: 1, email: 'a@b.c', role: 'super_admin', tenantId: 't1' };

  it('expired access token: 401 Invalid token with code TOKEN_EXPIRED', () => {
    const res = call(jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: -60 }));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token', code: 'TOKEN_EXPIRED' });
  });

  it('bad signature: 401 Invalid token without a code', () => {
    const res = call(jwt.sign(payload, 'some-other-secret', { expiresIn: '15m' }));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
  });
});
