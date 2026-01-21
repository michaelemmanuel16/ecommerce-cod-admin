import { Request, Response } from 'express';
import agentReconciliationService from '../services/agentReconciliationService';
import agingService from '../services/agingService';
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
     * Get deposits with filtering
     */
    async getDeposits(req: Request, res: Response) {
        const { agentId, status, startDate, endDate } = req.query;

        const where: any = {};
        if (agentId) {
            const parsedId = parseInt(agentId as string);
            if (isNaN(parsedId)) throw new AppError('Invalid agentId', 400);
            where.agentId = parsedId;
        }
        if (status) where.status = status;
        if (startDate || endDate) {
            where.depositDate = {};
            if (startDate) where.depositDate.gte = new Date(startDate as string);
            if (endDate) where.depositDate.lte = new Date(endDate as string);
        }

        const deposits = await (prisma as any).agentDeposit.findMany({
            where,
            include: {
                agent: {
                    select: { id: true, firstName: true, lastName: true, email: true }
                },
                verifier: {
                    select: { id: true, firstName: true, lastName: true }
                }
            },
            orderBy: { depositDate: 'desc' }
        });

        res.json(deposits);
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
            io.emit('collections:bulkVerified', { count: results.length });
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
        const { amount, depositMethod, referenceNumber, notes, agentId: providedAgentId } = req.body;
        const user = (req as any).user;

        // RBAC: Strengthened check for creating deposits for others
        let targetAgentId = user.id;
        if (providedAgentId) {
            const parsedProvidedId = parseInt(providedAgentId);
            if (isNaN(parsedProvidedId)) throw new AppError('Invalid agent ID format', 400);

            if (parsedProvidedId !== user.id) {
                const canManageOthers = ['manager', 'admin', 'accountant', 'super_admin'].includes(user.role);
                if (!canManageOthers) {
                    throw new AppError('Access denied: You cannot create deposits for other agents', 403);
                }
                targetAgentId = parsedProvidedId;
            }
        }

        try {
            const result = await agentReconciliationService.createDeposit(
                targetAgentId,
                parseFloat(amount),
                depositMethod,
                referenceNumber,
                notes
            );

            // Emit socket event for accountants to see the new pending deposit
            const io = getSocketInstance();
            if (io) {
                io.emit('agent:deposit-submitted', result);
            }

            res.status(201).json(result);
        } catch (error: any) {
            // Handle Prisma unique constraint violation for reference_number
            if (error.code === 'P2002' && error.meta?.target?.includes('reference_number')) {
                throw new AppError('A deposit with this reference number already exists', 409);
            }
            throw error;
        }
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
            io.emit('agent:deposit-verified', result);
        }

        res.json(result);
    }

    /**
     * Reject a deposit (Accountant only)
     */
    async rejectDeposit(req: Request, res: Response) {
        const { id } = req.params;
        const { notes } = req.body;
        const userId = (req as any).user.id;

        const parsedId = parseInt(id);
        if (isNaN(parsedId)) throw new AppError('Invalid deposit ID', 400);

        const result = await agentReconciliationService.rejectDeposit(parsedId, userId, notes);

        // Emit socket event (optional for rejection, but good for real-time status)
        const io = getSocketInstance();
        if (io) {
            io.emit('deposit:rejected', result);
        }

        res.json(result);
    }

    /**
     * Get agent aging report (Manager/Admin/Accountant)
     */
    async getAgingReport(_req: Request, res: Response) {
        const report = await agingService.getAgingReport();
        res.json(report);
    }

    /**
     * Export aging report to CSV (Manager/Admin/Accountant)
     */
    async exportAgingReport(_req: Request, res: Response) {
        const report = await agingService.getAgingReport();

        // CSV Header
        let csv = 'Agent,Total Balance,0-1 Day,2-3 Days,4-7 Days,8+ Days,Oldest Collection\n';

        for (const entry of report) {
            const agentName = `${entry.agent.firstName} ${entry.agent.lastName}`;
            const oldestDate = entry.oldestCollectionDate ? new Date(entry.oldestCollectionDate).toLocaleDateString() : 'N/A';

            csv += `"${agentName}",${entry.totalBalance},${entry.bucket_0_1},${entry.bucket_2_3},${entry.bucket_4_7},${entry.bucket_8_plus},"${oldestDate}"\n`;
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=agent-aging-report-${new Date().toISOString().split('T')[0]}.csv`);
        res.status(200).send(csv);
    }

    /**
     * Block an agent (Manager/Admin only)
     */
    async blockAgent(req: Request, res: Response) {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = (req as any).user.id;

        const parsedId = parseInt(id);
        if (isNaN(parsedId)) throw new AppError('Invalid agent ID', 400);
        if (!reason) throw new AppError('Block reason is required', 400);

        const result = await agentReconciliationService.blockAgent(parsedId, userId, reason);

        // Emit socket event
        const io = getSocketInstance();
        if (io) {
            io.emit('agent:blocked', {
                agentId: parsedId,
                reason,
                blockedAt: result.blockedAt,
                blockedBy: userId
            });
            // Also notify the specific agent
            io.to(`user:${parsedId}`).emit('notification', {
                type: 'agent_blocked',
                title: 'Account Blocked',
                message: `Your account has been blocked: ${reason}`,
                data: { reason }
            });
        }

        res.json(result);
    }

    /**
     * Unblock an agent (Manager/Admin only)
     */
    async unblockAgent(req: Request, res: Response) {
        const { id } = req.params;
        const userId = (req as any).user.id;

        const parsedId = parseInt(id);
        if (isNaN(parsedId)) throw new AppError('Invalid agent ID', 400);

        const result = await agentReconciliationService.unblockAgent(parsedId, userId);

        // Emit socket event
        const io = getSocketInstance();
        if (io) {
            io.emit('agent:unblocked', { agentId: parsedId, unblockedBy: userId });
            // Also notify the specific agent
            io.to(`user:${parsedId}`).emit('notification', {
                type: 'agent_unblocked',
                title: 'Account Unblocked',
                message: 'Your account has been unblocked. You can now receive new deliveries.',
            });
        }

        res.json(result);
    }

    /**
     * Get all blocked agents (Manager/Admin/Accountant)
     */
    async getBlockedAgents(_req: Request, res: Response) {
        const result = await agentReconciliationService.getBlockedAgents();
        res.json(result);
    }
}

export default new AgentReconciliationController();
