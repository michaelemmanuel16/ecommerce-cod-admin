import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Response } from 'express';
import { AuthRequest } from '../../types';
import * as payoutController from '../../controllers/payoutController';
import payoutService from '../../services/payoutService';
import { AppError } from '../../middleware/errorHandler';

// Mock payoutService
jest.mock('../../services/payoutService', () => ({
    __esModule: true,
    default: {
        getPendingPayments: jest.fn(),
        getPayoutHistory: jest.fn(),
        processPayout: jest.fn(),
    },
}));

describe('Payout Controller', () => {
    let mockReq: Partial<AuthRequest>;
    let mockRes: Partial<Response>;
    let mockNext: jest.Mock;

    beforeEach(() => {
        mockReq = {
            params: {},
            body: {},
            user: { id: 1 } as any,
        };
        mockRes = {
            json: jest.fn().mockReturnThis() as any,
            status: jest.fn().mockReturnThis() as any,
        };
        mockNext = jest.fn();
    });

    describe('getPendingPayments', () => {
        it('should return pending payments for a valid rep ID', async () => {
            const mockPending = [{ orderId: 1, totalAmount: 100 }];
            mockReq.params = { id: '1001' };
            (payoutService.getPendingPayments as jest.Mock).mockResolvedValue(mockPending);

            await payoutController.getPendingPayments(mockReq as AuthRequest, mockRes as Response);

            expect(mockRes.json).toHaveBeenCalledWith(mockPending);
            expect(payoutService.getPendingPayments).toHaveBeenCalledWith(1001);
        });

        it('should throw AppError if rep ID is invalid', async () => {
            mockReq.params = { id: 'invalid' };

            await expect(payoutController.getPendingPayments(mockReq as AuthRequest, mockRes as Response))
                .rejects.toThrow(new AppError('Invalid representative ID', 400));
        });
    });

    describe('getPayoutHistory', () => {
        it('should return payout history for a valid rep ID', async () => {
            const mockHistory = [{ id: 1, amount: 500 }];
            mockReq.params = { id: '1001' };
            (payoutService.getPayoutHistory as jest.Mock).mockResolvedValue(mockHistory);

            await payoutController.getPayoutHistory(mockReq as AuthRequest, mockRes as Response);

            expect(mockRes.json).toHaveBeenCalledWith(mockHistory);
            expect(payoutService.getPayoutHistory).toHaveBeenCalledWith(1001);
        });
    });

    describe('processPayout', () => {
        it('should process a payout successfully', async () => {
            const payoutBody = {
                amount: 300,
                method: 'Bank Transfer',
                orderIds: [1, 2, 3],
                notes: 'Monthly payout'
            };
            const mockPayout = { id: 50, ...payoutBody };
            mockReq.params = { id: '1001' };
            mockReq.body = payoutBody;
            (payoutService.processPayout as jest.Mock).mockResolvedValue(mockPayout);

            await payoutController.processPayout(mockReq as AuthRequest, mockRes as Response);

            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith({
                message: 'Payout processed successfully',
                payout: mockPayout
            });
        });

        it('should throw error if orderIds are missing or empty', async () => {
            mockReq.params = { id: '1001' };
            mockReq.body = { amount: 300, method: 'Bank Transfer', orderIds: [] };

            await expect(payoutController.processPayout(mockReq as AuthRequest, mockRes as Response))
                .rejects.toThrow(new AppError('No orders selected for payout', 400));
        });
    });
});
