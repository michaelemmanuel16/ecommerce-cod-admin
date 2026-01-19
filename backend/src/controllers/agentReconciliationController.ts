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
                    select: { id: true, firstName: true, lastName: true, email: true }
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
            // Also emit balance update
            const balance = await agentReconciliationService.getAgentBalance(result.agentId);
            io.emit(`agent:balance-updated`, { agentId: result.agentId, balance });
        }

        res.json(result);
    }

    /**
     * Get specific agent balance
     */
    async getAgentBalance(req: Request, res: Response) {
        const { id } = req.params;
        const agentId = parseInt(id);
        if (isNaN(agentId)) throw new AppError('Invalid agent ID', 400);

        // RBAC: Agents can only view their own balance
        const user = (req as any).user;
        if (user.role === 'delivery_agent' && user.id !== agentId) {
            throw new AppError('Access denied: You can only view your own balance', 403);
        }

        const balance = await agentReconciliationService.getAgentBalance(agentId);
        res.json(balance);
    }

    /**
     * Get all agent balances (Manager/Admin only)
     */
    async getBalances(_req: Request, res: Response) {
        const balances = await agentReconciliationService.getAllAgentBalances();
        res.json(balances);
    }

    /**
     * Create a deposit record (Agent/Accountant/Manager/Admin)
     */
    async createDeposit(req: Request, res: Response) {
        const { amount, referenceNumber, notes, agentId: providedAgentId } = req.body;
        const user = (req as any).user;

        // If providedAgentId is set, check if user has permission to create for another agent
        let targetAgentId = user.id;
        if (providedAgentId && providedAgentId !== user.id) {
            if (!['manager', 'admin', 'accountant'].includes(user.role)) {
                throw new AppError('Access denied: You cannot create deposits for other agents', 403);
            }
            targetAgentId = parseInt(providedAgentId);
        }

        if (isNaN(targetAgentId)) throw new AppError('Invalid agent ID', 400);

        const result = await agentReconciliationService.createDeposit(
            targetAgentId,
            parseFloat(amount),
            referenceNumber,
            notes
        );

        res.status(201).json(result);
    }

    /**
     * Verify a deposit (Accountant only)
     */
    async verifyDeposit(req: Request, res: Response) {
        const { id } = req.params;
        const userId = (req as any).user.id;

        const parsedId = parseInt(id);
        if (isNaN(parsedId)) throw new AppError('Invalid deposit ID', 400);

        const result = await agentReconciliationService.verifyDeposit(parsedId, userId);

        // Emit socket event
        const io = getSocketInstance();
        if (io) {
            const balance = await agentReconciliationService.getAgentBalance(result.agentId);
            io.emit(`agent:balance-updated`, { agentId: result.agentId, balance });
            io.emit('deposit:verified', result);
        }

        res.json(result);
    }
}

export default new AgentReconciliationController();
