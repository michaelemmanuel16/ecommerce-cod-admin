import { Request, Response } from 'express';
import agentReconciliationService from '../services/agentReconciliationService';
import { AppError } from '../middleware/errorHandler';
import prisma from '../utils/prisma';
import { readDateBound } from '../utils/kpiRequest';
import { getSocketInstance } from '../utils/socketInstance';
import * as Money from '../utils/money';
import { emitToTenant, emitToUser } from '../sockets/index';

export class AgentReconciliationController {
    /**
     * Get all collections with filtering
     */
    async getCollections(req: Request, res: Response) {
        const { agentId, status, startDate, endDate } = req.query;
        const user = (req as any).user;

        const where: any = {};
        // Delivery agents can only see their own collections
        if (user.role === 'delivery_agent') {
            where.agentId = user.id;
        } else if (agentId) {
            const parsedId = parseInt(agentId as string);
            if (isNaN(parsedId)) throw new AppError('Invalid agentId', 400);
            where.agentId = parsedId;
        }
        if (status) where.status = status;
        if (startDate || endDate) {
            where.collectionDate = {};
            if (startDate) where.collectionDate.gte = readDateBound(startDate, 'from');
            if (endDate) where.collectionDate.lte = readDateBound(endDate, 'to');
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
        const user = (req as any).user;

        const where: any = {};
        // Delivery agents can only see their own deposits
        if (user.role === 'delivery_agent') {
            where.agentId = user.id;
        } else if (agentId) {
            const parsedId = parseInt(agentId as string);
            if (isNaN(parsedId)) throw new AppError('Invalid agentId', 400);
            where.agentId = parsedId;
        }
        if (status) where.status = status;
        if (startDate || endDate) {
            where.depositDate = {};
            if (startDate) where.depositDate.gte = readDateBound(startDate, 'from');
            if (endDate) where.depositDate.lte = readDateBound(endDate, 'to');
        }

        const query = {
            include: {
                agent: {
                    select: { id: true, firstName: true, lastName: true, email: true }
                },
                verifier: {
                    select: { id: true, firstName: true, lastName: true }
                }
            },
            orderBy: { depositDate: 'desc' }
        };
        const db = (prisma as any).agentDeposit;
        // recentDecided=N: every pending row plus the N newest decided rows, so the Finance screens stay bounded (read only)
        const recentDecided = req.query.recentDecided === undefined ? null : Number(req.query.recentDecided);
        let deposits;
        if (recentDecided === null) {
            deposits = await db.findMany({ where, ...query });
        } else {
            const { status: _ignored, ...scope } = where;
            const [pending, decided] = await Promise.all([
                db.findMany({ where: { ...scope, status: 'pending' }, ...query }),
                db.findMany({ where: { ...scope, status: { not: 'pending' } }, ...query, take: recentDecided }),
            ]);
            deposits = [...pending, ...decided].sort((a, b) => +new Date(b.depositDate) - +new Date(a.depositDate));
        }

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
        const { amount, depositMethod, referenceNumber, notes, receiptUrl, agentId: providedAgentId } = req.body;
        const user = (req as any).user;

        // RBAC: Delivery agents can only create deposits for themselves
        let targetAgentId = user.id;
        if (user.role === 'delivery_agent') {
            if (providedAgentId && parseInt(providedAgentId) !== user.id) {
                throw new AppError('Access denied: Agents can only create deposits for themselves', 403);
            }
        } else if (providedAgentId) {
            const parsedProvidedId = parseInt(providedAgentId);
            if (isNaN(parsedProvidedId)) throw new AppError('Invalid agent ID format', 400);
            const canManageOthers = ['manager', 'admin', 'accountant', 'super_admin'].includes(user.role);
            if (!canManageOthers) {
                throw new AppError('Access denied: You cannot create deposits for other agents', 403);
            }
            targetAgentId = parsedProvidedId;
        }

        try {
            const result = await agentReconciliationService.createDeposit(
                targetAgentId,
                amount,
                depositMethod,
                referenceNumber,
                notes,
                receiptUrl
            );

            // Emit socket event for accountants to see the new pending deposit
            const io = getSocketInstance();
            if (io) {
                emitToTenant(io, 'agent:deposit-submitted', result);
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
            emitToTenant(io, `agent:balance-updated`, { agentId: result.agentId, balance });
            emitToTenant(io, 'agent:deposit-verified', result);
        }

        res.json(result);
    }

    /**
     * Reject a deposit (Accountant only)
     */
    async rejectDeposit(req: Request, res: Response) {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = (req as any).user.id;

        const parsedId = parseInt(id);
        if (isNaN(parsedId)) throw new AppError('Invalid deposit ID', 400);

        const result = await agentReconciliationService.rejectDeposit(parsedId, userId, reason);

        // Emit socket event (optional for rejection, but good for real-time status)
        const io = getSocketInstance();
        if (io) {
            emitToTenant(io, 'agent:deposit-rejected', result);
        }

        res.json(result);
    }

    /**
     * Bulk verify deposits (Accountant only)
     */
    async bulkVerifyDeposits(req: Request, res: Response) {
        const { ids } = req.body;
        const userId = (req as any).user.id;

        if (!Array.isArray(ids)) {
            throw new AppError('IDs must be an array', 400);
        }

        if (ids.length === 0) {
            throw new AppError('No deposit IDs provided', 400);
        }

        if (ids.length > 50) {
            throw new AppError('Cannot verify more than 50 deposits at once', 400);
        }

        // Validate each ID is a positive integer and there are no duplicates
        const uniqueIds = new Set<number>();
        for (const id of ids) {
            if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
                throw new AppError(`Invalid deposit ID: ${id}. Must be a positive integer.`, 400);
            }
            if (uniqueIds.has(id)) {
                throw new AppError(`Duplicate deposit ID detected: ${id}`, 400);
            }
            uniqueIds.add(id);
        }

        const result = await agentReconciliationService.bulkVerifyDeposits(ids, userId);

        // Emit socket event for the whole batch
        const io = getSocketInstance();
        if (io) {
            emitToTenant(io, 'agent:deposits-bulk-verified', {
                count: result.verified,
                totalAmount: Money.toApi(result.totalAmount)
            });
        }

        res.json(result);
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
            emitToTenant(io, 'agent:blocked', {
                agentId: parsedId,
                reason,
                blockedAt: result.blockedAt,
                blockedBy: userId
            });
            // Also notify the specific agent
            emitToUser(io, parsedId, 'notification', {
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
            emitToTenant(io, 'agent:unblocked', { agentId: parsedId, unblockedBy: userId });
            // Also notify the specific agent
            emitToUser(io, parsedId, 'notification', {
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
