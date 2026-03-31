/**
 * Extended PayoutController tests for branch coverage
 * Covers: getPayoutHistory invalid ID, processPayout invalid ID, orderIds not array
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Response } from 'express';
import { AuthRequest } from '../../types';
import * as payoutController from '../../controllers/payoutController';
import payoutService from '../../services/payoutService';
import { AppError } from '../../middleware/errorHandler';

jest.mock('../../services/payoutService', () => ({
  __esModule: true,
  default: {
    getPendingPayments: jest.fn(),
    getPayoutHistory: jest.fn(),
    processPayout: jest.fn(),
  },
}));

describe('Payout Controller (extended branch coverage)', () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = { params: {}, body: {}, user: { id: 1 } as any };
    mockRes = {
      json: jest.fn().mockReturnThis() as any,
      status: jest.fn().mockReturnThis() as any,
    };
  });

  it('getPayoutHistory throws AppError for invalid rep ID', async () => {
    mockReq.params = { id: 'not-a-number' };
    await expect(payoutController.getPayoutHistory(mockReq as AuthRequest, mockRes as Response))
      .rejects.toThrow(AppError);
  });

  it('processPayout throws AppError for invalid rep ID', async () => {
    mockReq.params = { id: 'invalid' };
    mockReq.body = { orderIds: [1] };
    await expect(payoutController.processPayout(mockReq as AuthRequest, mockRes as Response))
      .rejects.toThrow(AppError);
  });

  it('processPayout throws AppError when orderIds is null', async () => {
    mockReq.params = { id: '1' };
    mockReq.body = { amount: 100, method: 'cash', orderIds: null };
    await expect(payoutController.processPayout(mockReq as AuthRequest, mockRes as Response))
      .rejects.toThrow(AppError);
  });

  it('processPayout throws AppError when orderIds is not an array', async () => {
    mockReq.params = { id: '1' };
    mockReq.body = { amount: 100, method: 'cash', orderIds: 'not-array' };
    await expect(payoutController.processPayout(mockReq as AuthRequest, mockRes as Response))
      .rejects.toThrow(AppError);
  });
});
