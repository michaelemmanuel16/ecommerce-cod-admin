import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Response } from 'express';
import { AuthRequest } from '../../types';
import * as userController from '../../controllers/userController';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';

// Mock prisma
jest.mock('../../utils/prisma', () => ({
    __esModule: true,
    default: {
        payout: {
            findMany: jest.fn(),
        },
    },
}));

describe('User Controller - getMyPayoutHistory', () => {
    let mockReq: Partial<AuthRequest>;
    let mockRes: Partial<Response>;
    let mockNext: jest.Mock;

    beforeEach(() => {
        mockReq = {
            user: { id: 1001, role: 'sales_rep' } as any,
        };
        mockRes = {
            json: jest.fn().mockReturnThis() as any,
            status: jest.fn().mockReturnThis() as any,
        };
        mockNext = jest.fn();
        jest.clearAllMocks();
    });

    describe('getMyPayoutHistory', () => {
        it('should return payout history for authenticated sales rep', async () => {
            const mockPayouts = [
                {
                    id: 1,
                    amount: 1620.00,
                    method: 'Mobile Money',
                    payoutDate: new Date('2026-02-06'),
                    status: 'completed',
                    notes: 'Monthly payout',
                    _count: { orders: 324 }
                },
                {
                    id: 2,
                    amount: 10.00,
                    method: 'Bank Transfer',
                    payoutDate: new Date('2026-02-06'),
                    status: 'completed',
                    notes: null,
                    _count: { orders: 2 }
                }
            ];

            (prisma.payout.findMany as jest.Mock).mockResolvedValue(mockPayouts);

            await userController.getMyPayoutHistory(mockReq as AuthRequest, mockRes as Response, mockNext);

            expect(prisma.payout.findMany).toHaveBeenCalledWith({
                where: { repId: 1001 },
                include: {
                    _count: {
                        select: { orders: true }
                    }
                },
                orderBy: {
                    payoutDate: 'desc'
                }
            });

            expect(mockRes.json).toHaveBeenCalledWith({
                payouts: [
                    {
                        id: 1,
                        amount: 1620.00,
                        method: 'Mobile Money',
                        payoutDate: mockPayouts[0].payoutDate,
                        status: 'completed',
                        notes: 'Monthly payout',
                        orderCount: 324
                    },
                    {
                        id: 2,
                        amount: 10.00,
                        method: 'Bank Transfer',
                        payoutDate: mockPayouts[1].payoutDate,
                        status: 'completed',
                        notes: null,
                        orderCount: 2
                    }
                ]
            });
        });

        it('should throw 401 error if user is not authenticated', async () => {
            mockReq.user = undefined;

            await userController.getMyPayoutHistory(mockReq as AuthRequest, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
            const error = mockNext.mock.calls[0][0];
            expect(error.message).toBe('User not authenticated');
            expect(error.statusCode).toBe(401);
        });

        it('should throw 403 error if user is not a sales rep', async () => {
            mockReq.user = { id: 1, role: 'admin' } as any;

            await userController.getMyPayoutHistory(mockReq as AuthRequest, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
            const error = mockNext.mock.calls[0][0];
            expect(error.message).toBe('This endpoint is only available for sales representatives');
            expect(error.statusCode).toBe(403);
        });

        it('should return empty array if sales rep has no payout history', async () => {
            (prisma.payout.findMany as jest.Mock).mockResolvedValue([]);

            await userController.getMyPayoutHistory(mockReq as AuthRequest, mockRes as Response, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith({ payouts: [] });
        });

        it('should handle database errors gracefully', async () => {
            const dbError = new Error('Database connection failed');
            (prisma.payout.findMany as jest.Mock).mockRejectedValue(dbError);

            await userController.getMyPayoutHistory(mockReq as AuthRequest, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalledWith(dbError);
        });
    });
});
