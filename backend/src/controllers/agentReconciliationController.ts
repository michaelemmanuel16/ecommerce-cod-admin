import { Request, Response } from 'express';
import agentReconciliationService from '../services/agentReconciliationService';
import { AppError } from '../middleware/errorHandler';
import prisma from '../utils/prisma';
import { getSocketInstance } from '../utils/socketInstance';
import { emitCollectionVerified, emitCollectionApproved } from '../sockets/index';

export class AgentReconciliationController {
    /**
     * Get all collections with filtering
     */
    async getCollections(req: Request, res: Response) {
        const { agentId, status, startDate, endDate } = req.query;

        const where: any = {};
        if (agentId) {
            const parsedId = parseInt(agentId as string);
            if (isNaN(parsedId)) throw new AppError('Invalid agentId', 400);
            where.agentId = parsedId;
        }
        if (status) where.status = status;
        if (startDate || endDate) {
            where.collectionDate = {};
            if (startDate) where.collectionDate.gte = new Date(startDate as string);
            if (endDate) where.collectionDate.lte = new Date(endDate as string);
        }

        const collections = await (prisma as any).agentCollection.findMany({
            where,
            include: {
                agent: {
                    select: { id: true, name: true, email: true }
                },
                order: {
                    select: { id: true, status: true, codAmount: true }
                }
            },
            orderBy: { collectionDate: 'desc' }
        });

        res.json(collections);
    }

    /**
     * Get agent collection stats
     */
    async getAgentStats(req: Request, res: Response) {
        const { agentId } = req.params;

        const parsedId = parseInt(agentId);
        if (isNaN(parsedId)) throw new AppError('Invalid agentId', 400);

        const stats = await (prisma as any).agentCollection.groupBy({
            by: ['status'],
            where: { agentId: parsedId },
            _sum: { amount: true },
            _count: true
        });

        res.json(stats);
    }

    /**
     * Verify a collection (Accountant)
     */
    async verifyCollection(req: Request, res: Response) {
        const { id } = req.params;
        const userId = (req as any).user.id;

        const parsedId = parseInt(id);
        if (isNaN(parsedId)) throw new AppError('Invalid collection ID', 400);

        const result = await agentReconciliationService.verifyCollection(parsedId, userId);

        // Emit socket event
        const io = getSocketInstance();
        if (io) {
            emitCollectionVerified(io, result);
        }

        res.json(result);
    }

    /**
     * Bulk verify collections (Accountant)
     */
    async bulkVerify(req: Request, res: Response) {
        const { ids } = req.body;
        const userId = (req as any).user.id;

        if (!Array.isArray(ids)) {
            throw new AppError('IDs must be an array', 400);
        }

        const results = await agentReconciliationService.bulkVerifyCollections(ids, userId);

        // Emit socket event for the whole batch
        const io = getSocketInstance();
        if (io) {
            io.emit('collections:bulkVerified', { count: results.filter(r => r.success).length });
        }

        res.json(results);
    }

    /**
     * Approve a collection (Manager/Admin)
     */
    async approveCollection(req: Request, res: Response) {
        const { id } = req.params;
        const userId = (req as any).user.id;

        const parsedId = parseInt(id);
        if (isNaN(parsedId)) throw new AppError('Invalid collection ID', 400);

        const result = await agentReconciliationService.approveCollection(parsedId, userId);

        // Emit socket event
        const io = getSocketInstance();
        if (io) {
            emitCollectionApproved(io, result);
        }

        res.json(result);
    }
}

export default new AgentReconciliationController();
