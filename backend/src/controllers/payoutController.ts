import { Response } from 'express';
import { AuthRequest } from '../types';
import payoutService from '../services/payoutService';
import { AppError } from '../middleware/errorHandler';

export const getPendingPayments = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const repId = parseInt(id, 10);

        if (isNaN(repId)) {
            throw new AppError('Invalid representative ID', 400);
        }

        const pending = await payoutService.getPendingPayments(repId);
        res.json(pending);
    } catch (error) {
        throw error;
    }
};

export const getPayoutHistory = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const repId = parseInt(id, 10);

        if (isNaN(repId)) {
            throw new AppError('Invalid representative ID', 400);
        }

        const history = await payoutService.getPayoutHistory(repId);
        res.json(history);
    } catch (error) {
        throw error;
    }
};

export const processPayout = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const repId = parseInt(id, 10);
        const { amount, method, orderIds, notes } = req.body;

        if (isNaN(repId)) {
            throw new AppError('Invalid representative ID', 400);
        }

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            throw new AppError('No orders selected for payout', 400);
        }

        const payout = await payoutService.processPayout({
            repId,
            amount,
            method,
            orderIds,
            notes,
            processedBy: req.user!.id
        });

        res.status(201).json({
            message: 'Payout processed successfully',
            payout
        });
    } catch (error) {
        throw error;
    }
};
