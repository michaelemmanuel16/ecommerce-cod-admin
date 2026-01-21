import { Prisma, JournalSourceType } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import { GL_ACCOUNTS } from '../config/glAccounts';
import { GLUtils } from '../utils/glUtils';
import { GLAccountService } from './glAccountService';

export class AgentReconciliationService {
    /**
     * Create a draft collection record for an order
     * Triggered when an order is delivered
     */
    async createDraftCollection(
        tx: any,
        orderId: number,
        agentId: number,
        amount: number,
        collectionDate: Date
    ) {
        const collection = await (tx as any).agentCollection.create({
            data: {
                orderId,
                agentId,
                amount,
                status: 'draft',
                collectionDate,
            },
        });

        logger.info(`Draft collection created for order ${orderId}`, {
            collectionId: collection.id,
            agentId,
            amount,
        });

        return collection;
    }

    /**
     * Verify a collection record
     * Only accountants can perform this action
     */
    async verifyCollection(collectionId: number, verifierId: number) {
        return await prisma.$transaction(async (tx) => {
            const collection = await (tx as any).agentCollection.findUnique({
                where: { id: collectionId },
                include: { order: true }
            });

            if (!collection) {
                throw new AppError('Collection record not found', 404);
            }

            if (collection.status !== 'draft') {
                throw new AppError(`Collection cannot be verified from status: ${collection.status}`, 400);
            }

            // Update collection status
            const updated = await (tx as any).agentCollection.update({
                where: { id: collectionId },
                data: {
                    status: 'verified',
                    verifiedAt: new Date(),
                    verifiedById: verifierId,
                },
            });

            // Create GL Journal Entry
            // Debit: AR-Agents (1020)
            // Credit: Cash in Transit (1015)
            await this.createVerificationGLEntry(tx as any, updated, verifierId);

            logger.info(`Collection ${collectionId} verified by user ${verifierId}`);
            return updated;
        });
    }

    /**
     * Create GL entry for collection verification
     */
    private async createVerificationGLEntry(
        tx: any,
        collection: any,
        userId: number
    ) {
        const extTx = tx as any;
        const entryNumber = await GLUtils.generateEntryNumber(tx);
        const amount = new Prisma.Decimal(collection.amount.toString());

        await extTx.journalEntry.create({
            data: {
                entryNumber,
                entryDate: new Date(),
                description: `Collection verification - Order #${collection.orderId}`,
                sourceType: JournalSourceType.agent_collection,
                sourceId: collection.id,
                createdBy: userId,
                transactions: {
                    create: [
                        {
                            accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.AR_AGENTS),
                            debitAmount: amount,
                            creditAmount: new Prisma.Decimal(0),
                            description: `Agent AR for collection ${collection.id}`,
                        },
                        {
                            accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT),
                            debitAmount: new Prisma.Decimal(0),
                            creditAmount: amount,
                            description: `Moving cash from transit to agent AR`,
                        },
                    ],
                },
            },
        });
    }

    /**
     * Approve a verified collection record
     * Only managers/admins can perform this action
     */
    async approveCollection(collectionId: number, approverId: number) {
        return await prisma.$transaction(async (tx) => {
            const collection = await (tx as any).agentCollection.findUnique({
                where: { id: collectionId },
            });

            if (!collection) {
                throw new AppError('Collection record not found', 404);
            }

            if (collection.status !== 'verified') {
                throw new AppError(`Collection cannot be approved from status: ${collection.status}`, 400);
            }

            // Update collection status
            const updated = await (tx as any).agentCollection.update({
                where: { id: collectionId },
                data: {
                    status: 'approved',
                    approvedAt: new Date(),
                    approvedById: approverId,
                },
            });

            // Update agent balance
            const balance = await this.getOrCreateBalance(collection.agentId, tx as any);
            await (tx as any).agentBalance.update({
                where: { id: balance.id },
                data: {
                    totalCollected: { increment: collection.amount },
                    currentBalance: { increment: collection.amount },
                },
            });

            // Legacy update for User model (if still needed)
            await tx.user.update({
                where: { id: collection.agentId },
                data: {
                    totalCollected: {
                        increment: collection.amount,
                    },
                },
            });

            logger.info(`Collection ${collectionId} approved by user ${approverId}`);
            return updated;
        });
    }

    async getOrCreateBalance(agentId: number, tx?: any): Promise<any> {
        const client = (tx || prisma) as any;
        const balance = await client.agentBalance.findUnique({
            where: { agentId },
        });

        if (balance) return balance;

        return await client.agentBalance.create({
            data: {
                agentId,
                totalCollected: 0,
                totalDeposited: 0,
                currentBalance: 0,
            },
        });
    }

    /**
     * Create a new deposit record
     */
    async createDeposit(agentId: number, amount: number, depositMethod: string, referenceNumber: string, notes?: string) {
        if (amount <= 0) {
            throw new AppError('Deposit amount must be greater than zero', 400);
        }

        const balance = await this.getOrCreateBalance(agentId);
        if (new Prisma.Decimal(balance.currentBalance.toString()).lessThan(amount)) {
            throw new AppError('Deposit amount cannot exceed your current outstanding balance', 400);
        }

        const deposit = await (prisma as unknown as any).agentDeposit.create({
            data: {
                agentId,
                amount,
                depositMethod,
                depositDate: new Date(),
                referenceNumber,
                notes,
                status: 'pending',
            },
        });

        logger.info(`New deposit created for agent ${agentId}`, { depositId: deposit.id, amount });
        return deposit;
    }

    /**
     * Reject an agent deposit
     */
    async rejectDeposit(depositId: number, rejectedById: number, notes?: string): Promise<any> {
        return await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const deposit = await extTx.agentDeposit.findUnique({
                where: { id: depositId },
                include: { verifier: { select: { firstName: true, lastName: true } } }
            });

            if (!deposit) {
                throw new AppError('Deposit record not found', 404);
            }

            if (deposit.status !== 'pending') {
                throw new AppError(`Deposit cannot be rejected from status: ${deposit.status}`, 400);
            }

            const dateStr = new Date().toLocaleString();
            const formattedNotes = notes ? `${deposit.notes ? deposit.notes + '\n' : ''}[REJECTED] ${dateStr}: ${notes}` : deposit.notes;

            const updated = await extTx.agentDeposit.update({
                where: { id: depositId },
                data: {
                    status: 'rejected',
                    verifiedAt: new Date(),
                    verifiedById: rejectedById,
                    notes: formattedNotes,
                },
            });

            logger.info(`Deposit ${depositId} rejected by user ${rejectedById}`);
            return updated;
        });
    }

    /**
     * Verify an agent deposit
     */
    async verifyDeposit(depositId: number, verifierId: number): Promise<any> {
        return await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const deposit = await extTx.agentDeposit.findUnique({
                where: { id: depositId },
            });

            if (!deposit) {
                throw new AppError('Deposit record not found', 404);
            }

            if (deposit.status !== 'pending') {
                throw new AppError(`Deposit cannot be verified from status: ${deposit.status}`, 400);
            }

            // Update deposit record
            const updated = await extTx.agentDeposit.update({
                where: { id: depositId },
                data: {
                    status: 'verified',
                    verifiedAt: new Date(),
                    verifiedById: verifierId,
                },
            });

            // Update agent balance
            const balance = await this.getOrCreateBalance(deposit.agentId, extTx);

            // Use bank-friendly decimal for comparison
            const depAmt = new Prisma.Decimal(deposit.amount.toString());
            const currBal = new Prisma.Decimal(balance.currentBalance.toString());

            if (currBal.lessThan(depAmt)) {
                throw new AppError('Verification failed: Deposit amount exceeds current agent balance', 400);
            }

            await extTx.agentBalance.update({
                where: { id: balance.id },
                data: {
                    totalDeposited: { increment: deposit.amount },
                    currentBalance: { decrement: deposit.amount },
                    lastSettlementDate: new Date(),
                },
            });

            // Create GL Entry via GLAutomationService
            const { GLAutomationService } = await import('./glAutomationService');
            await GLAutomationService.createAgentDepositEntry(extTx, updated, verifierId);

            // FIFO Matching to Approved Collections (Optimized Bulk Update)
            let remainingAmount = depAmt;
            const collectionIdsToVerify: number[] = [];

            const approvedCollections = await extTx.agentCollection.findMany({
                where: {
                    agentId: deposit.agentId,
                    status: 'approved'
                },
                orderBy: {
                    collectionDate: 'asc'
                }
            });

            for (const coll of approvedCollections) {
                if (remainingAmount.isZero()) break;

                const collAmount = new Prisma.Decimal(coll.amount.toString());

                // If the collection can be fully covered by the remaining deposit
                if (remainingAmount.greaterThanOrEqualTo(collAmount)) {
                    collectionIdsToVerify.push(coll.id);
                    remainingAmount = remainingAmount.minus(collAmount);
                }
            }

            // Perform bulk update if there are collections to verify
            if (collectionIdsToVerify.length > 0) {
                await extTx.agentCollection.updateMany({
                    where: { id: { in: collectionIdsToVerify } },
                    data: { status: 'deposited' }
                });
            }

            // If there's an unallocated remainder, update the deposit note
            if (!remainingAmount.isZero()) {
                await extTx.agentDeposit.update({
                    where: { id: depositId },
                    data: {
                        notes: deposit.notes
                            ? `${deposit.notes} (Unallocated remainder: ${remainingAmount.toString()})`
                            : `Unallocated remainder: ${remainingAmount.toString()}`
                    }
                });
            }

            logger.info(`Deposit ${depositId} verified by user ${verifierId}`);
            return updated;
        });
    }

    /**
     * Get specific agent balance
     */
    async getAgentBalance(agentId: number) {
        return await (prisma as unknown as any).agentBalance.findUnique({
            where: { agentId },
        });
    }

    /**
     * Get all agent balances
     */
    async getAllAgentBalances(): Promise<any[]> {
        return await (prisma as unknown as any).agentBalance.findMany({
            include: {
                agent: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
            },
            orderBy: {
                currentBalance: 'desc',
            },
        });
    }

    /**
     * Bulk verify collections
     * Atomic: rolls back entirely if any verification fails
     */
    async bulkVerifyCollections(collectionIds: number[], verifierId: number) {
        return await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const results = [];
            for (const id of collectionIds) {
                // Fail fast - any error will roll back the transaction
                const result = await this.verifyCollectionInternal(extTx, id, verifierId);
                results.push(result);
            }
            return results;
        });
    }

    /**
     * Internal version of verifyCollection that accepts a transaction client
     */
    private async verifyCollectionInternal(tx: any, collectionId: number, verifierId: number) {
        const collection = await (tx as any).agentCollection.findUnique({
            where: { id: collectionId },
            include: { order: true }
        });

        if (!collection) {
            throw new AppError('Collection record not found', 404);
        }

        if (collection.status !== 'draft') {
            throw new AppError(`Collection cannot be verified from status: ${collection.status}`, 400);
        }

        // Update collection status
        const updated = await (tx as any).agentCollection.update({
            where: { id: collectionId },
            data: {
                status: 'verified',
                verifiedAt: new Date(),
                verifiedById: verifierId,
            },
        });

        // Create GL Journal Entry using shared utility
        await this.createVerificationGLEntry(tx as any, updated, verifierId);

        logger.info(`Collection ${collectionId} verified by user ${verifierId}`);
        return updated;
    }

    /**
     * Block an agent from receiving new deliveries
     * Manager/Admin intervention required
     */
    async blockAgent(agentId: number, blockedById: number, reason: string) {
        return await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const balance = await this.getOrCreateBalance(agentId, extTx);

            const updated = await extTx.agentBalance.update({
                where: { id: balance.id },
                data: {
                    isBlocked: true,
                    blockReason: reason,
                    blockedAt: new Date(),
                    blockedById: blockedById,
                },
                include: {
                    agent: {
                        select: { id: true, firstName: true, lastName: true, email: true }
                    }
                }
            });

            // Create in-app notification
            const { notifyAgentBlocked } = await import('./notificationService');
            await notifyAgentBlocked(agentId.toString(), reason);

            logger.info(`Agent ${agentId} blocked by user ${blockedById}. Reason: ${reason}`);
            return updated;
        });
    }

    /**
     * Unblock an agent to allow new deliveries
     */
    async unblockAgent(agentId: number, unblockedById: number) {
        return await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const balance = await this.getOrCreateBalance(agentId, extTx);

            if (!balance.isBlocked) {
                throw new AppError('Agent is not currently blocked', 400);
            }

            const updated = await extTx.agentBalance.update({
                where: { id: balance.id },
                data: {
                    isBlocked: false,
                    blockReason: null,
                    blockedAt: null,
                    blockedById: null,
                },
                include: {
                    agent: {
                        select: { id: true, firstName: true, lastName: true, email: true }
                    }
                }
            });

            // Create in-app notification
            const { notifyAgentUnblocked } = await import('./notificationService');
            await notifyAgentUnblocked(agentId.toString());

            logger.info(`Agent ${agentId} unblocked by user ${unblockedById}`);
            return updated;
        });
    }

    /**
     * Get all currently blocked agents
     */
    async getBlockedAgents() {
        return await (prisma as any).agentBalance.findMany({
            where: { isBlocked: true },
            include: {
                agent: {
                    select: { id: true, firstName: true, lastName: true, email: true }
                },
                blockedBy: {
                    select: { id: true, firstName: true, lastName: true }
                }
            },
            orderBy: { blockedAt: 'desc' }
        });
    }
}

export default new AgentReconciliationService();
