import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import appEvents, { AppEvent } from '../utils/appEvents';

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
     * Verify a collection record - this completes reconciliation
     * Updates order paymentStatus to 'reconciled' and clears agent balance
     */
    /**
     * Verify a collection record - this is a step towards full reconciliation
     * Internal version that handles state transitions and GL integration
     */
    async verifyCollection(collectionId: number, verifierId: number) {
        return await prisma.$transaction(async (tx) => {
            return await this.verifyCollectionInternal(tx, collectionId, verifierId);
        });
    }

    /**
     * Create GL entry for collection verification - DEPRECATED
     * Replaced by GLAutomationService.createCollectionVerificationEntry
     */
    /* private async createVerificationGLEntry(
        tx: any,
        collection: any,
        userId: number
    ) {
       // ... deprecated content removed ...
    } */

    /**
     * Approve a verified collection record
     * This is now an alias for verifyCollection as both steps are merged.
     * It will settle the balance and ensure reconciled status.
     * Only managers/admins can perform this action
     */
    async approveCollection(collectionId: number, approverId: number) {
        return await prisma.$transaction(async (tx) => {
            return await this.verifyCollectionInternal(tx, collectionId, approverId);
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

        return await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const balance = await this.getOrCreateBalance(agentId, extTx);
            if (new Prisma.Decimal(balance.currentBalance.toString()).lessThan(amount)) {
                throw new AppError('Deposit amount cannot exceed your current outstanding balance', 400);
            }

            const deposit = await extTx.agentDeposit.create({
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
        });
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
                throw new AppError(`Deposit cannot be rejected from status: ${deposit.status} `, 400);
            }

            const dateStr = new Date().toLocaleString();
            const formattedNotes = notes ? `${deposit.notes ? deposit.notes + '\n' : ''} [REJECTED] ${dateStr}: ${notes} ` : deposit.notes;

            const updated = await extTx.agentDeposit.update({
                where: { id: depositId },
                data: {
                    status: 'rejected',
                    verifiedAt: new Date(),
                    verifiedById: rejectedById,
                    notes: formattedNotes,
                },
            });

            logger.info(`Deposit ${depositId} rejected by user ${rejectedById} `);
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
                throw new AppError(`Deposit cannot be verified from status: ${deposit.status} `, 400);
            }

            // Update agent balance using atomic transaction
            const balance = await this.getOrCreateBalance(deposit.agentId, extTx);

            // Use bank-friendly decimal for comparison
            const depAmt = new Prisma.Decimal(deposit.amount.toString());
            const currBal = new Prisma.Decimal(balance.currentBalance.toString());

            if (currBal.lessThan(depAmt)) {
                throw new AppError('Verification failed: Deposit amount exceeds current agent balance', 400);
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

            // FIFO Matching to Approved Collections (Partial Allocation Support)
            let remainingAmount = depAmt;

            const approvedCollections = await extTx.agentCollection.findMany({
                where: {
                    agentId: deposit.agentId,
                    status: 'approved',
                },
                orderBy: {
                    collectionDate: 'asc'
                }
            });

            // Filter collections that are not yet fully covered
            const pendingMatches = approvedCollections.filter((coll: any) => {
                const amount = new Prisma.Decimal(coll.amount.toString());
                const allocated = new Prisma.Decimal(coll.allocatedAmount?.toString() || '0');
                return allocated.lessThan(amount);
            });

            for (const coll of pendingMatches) {
                if (remainingAmount.isZero()) break;

                const collAmount = new Prisma.Decimal(coll.amount.toString());
                const allocated = new Prisma.Decimal(coll.allocatedAmount?.toString() || '0');
                const outstanding = collAmount.minus(allocated);

                if (remainingAmount.greaterThanOrEqualTo(outstanding)) {
                    // Fully cover this collection
                    await extTx.agentCollection.update({
                        where: { id: coll.id },
                        data: {
                            status: 'deposited',
                            allocatedAmount: collAmount
                        }
                    });
                    remainingAmount = remainingAmount.minus(outstanding);
                } else if (remainingAmount.greaterThan(0)) {
                    // Partially cover this collection
                    await extTx.agentCollection.update({
                        where: { id: coll.id },
                        data: {
                            allocatedAmount: allocated.plus(remainingAmount)
                        }
                    });
                    remainingAmount = new Prisma.Decimal(0);
                }
            }

            // If there's an unallocated remainder, update the deposit note
            if (!remainingAmount.isZero()) {
                await extTx.agentDeposit.update({
                    where: { id: depositId },
                    data: {
                        notes: deposit.notes
                            ? `${deposit.notes} (Unallocated remainder: ${remainingAmount.toString()})`
                            : `Unallocated remainder: ${remainingAmount.toString()} `
                    }
                });
            }

            logger.info(`Deposit ${depositId} verified by user ${verifierId} `);

            // Trigger proactive aging refresh via event bus
            appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);

            return updated;
        }, {
            maxWait: 10000,
            timeout: 30000
        });
    }

    /**
     * Bulk verify agent deposits
     * Atomic: rolls back entirely if any verification fails
     * Maximum 50 deposits per batch
     */
    async bulkVerifyDeposits(depositIds: number[], verifierId: number): Promise<{
        verified: number;
        totalAmount: number;
    }> {
        if (depositIds.length === 0) {
            throw new AppError('No deposit IDs provided', 400);
        }

        if (depositIds.length > 50) {
            throw new AppError('Cannot verify more than 50 deposits at once', 400);
        }

        return await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            let totalAmount = new Prisma.Decimal(0);

            // Fetch all deposits first to validate
            const deposits = await extTx.agentDeposit.findMany({
                where: { id: { in: depositIds } },
                orderBy: { depositDate: 'asc' } // Process oldest first
            });

            if (deposits.length !== depositIds.length) {
                throw new AppError('One or more deposit records not found', 404);
            }

            // Validate all deposits are in pending status
            const invalidDeposits = deposits.filter((d: any) => d.status !== 'pending');
            if (invalidDeposits.length > 0) {
                const refs = invalidDeposits.map((d: any) => d.referenceNumber).join(', ');
                throw new AppError(`Cannot verify deposits with non - pending status: ${refs} `, 400);
            }

            // Group deposits by agent for optimized processing
            const depositsByAgent = new Map<number, any[]>();
            for (const deposit of deposits) {
                const agentDeposits = depositsByAgent.get(deposit.agentId) || [];
                agentDeposits.push(deposit);
                depositsByAgent.set(deposit.agentId, agentDeposits);
            }

            const { GLAutomationService } = await import('./glAutomationService');

            // Process each agent's deposits
            for (const [agentId, agentDeposits] of depositsByAgent) {
                // Lock agent balance row for this transaction to prevent race conditions
                const balances = await extTx.$queryRaw<any[]>`
                    SELECT * FROM "agent_balances" WHERE "agent_id" = ${agentId} FOR UPDATE
                `;

                let balance = balances[0];

                if (!balance) {
                    // Create if not exists (already handled in loop but locking is key)
                    balance = await this.getOrCreateBalance(agentId, extTx);
                }

                const currBal = new Prisma.Decimal(balance.currentBalance.toString());

                // Calculate total deposit amount for this agent
                const agentTotalDeposit = agentDeposits.reduce(
                    (sum, d) => sum.plus(new Prisma.Decimal(d.amount.toString())),
                    new Prisma.Decimal(0)
                );

                // Validate agent has sufficient balance
                if (currBal.lessThan(agentTotalDeposit)) {
                    const agent = await extTx.user.findUnique({
                        where: { id: agentId },
                        select: { firstName: true, lastName: true }
                    });
                    throw new AppError(
                        `Verification failed: Agent ${agent?.firstName} ${agent?.lastName} has insufficient balance(${currBal.toString()} < ${agentTotalDeposit.toString()})`,
                        400
                    );
                }

                // Update all deposits for this agent
                for (const deposit of agentDeposits) {
                    await extTx.agentDeposit.update({
                        where: { id: deposit.id },
                        data: {
                            status: 'verified',
                            verifiedAt: new Date(),
                            verifiedById: verifierId,
                        },
                    });

                    // Create GL Entry for each deposit
                    await GLAutomationService.createAgentDepositEntry(extTx, deposit, verifierId);

                    totalAmount = totalAmount.plus(new Prisma.Decimal(deposit.amount.toString()));
                }

                // Update agent balance once per agent
                await extTx.agentBalance.update({
                    where: { id: balance.id },
                    data: {
                        totalDeposited: { increment: agentTotalDeposit.toNumber() },
                        currentBalance: { decrement: agentTotalDeposit.toNumber() },
                        lastSettlementDate: new Date(),
                    },
                });

                // FIFO Matching for this agent's total deposit amount
                let remainingAmount = agentTotalDeposit;

                const approvedCollections = await extTx.agentCollection.findMany({
                    where: {
                        agentId,
                        status: 'approved',
                    },
                    orderBy: {
                        collectionDate: 'asc'
                    }
                });

                // Filter collections that are not yet fully covered
                const pendingMatches = approvedCollections.filter((coll: any) => {
                    const amount = new Prisma.Decimal(coll.amount.toString());
                    const allocated = new Prisma.Decimal(coll.allocatedAmount?.toString() || '0');
                    return allocated.lessThan(amount);
                });

                for (const coll of pendingMatches) {
                    if (remainingAmount.isZero()) break;

                    const collAmount = new Prisma.Decimal(coll.amount.toString());
                    const allocated = new Prisma.Decimal(coll.allocatedAmount?.toString() || '0');
                    const outstanding = collAmount.minus(allocated);

                    if (remainingAmount.greaterThanOrEqualTo(outstanding)) {
                        // Fully cover this collection
                        await extTx.agentCollection.update({
                            where: { id: coll.id },
                            data: {
                                status: 'deposited',
                                allocatedAmount: collAmount
                            }
                        });
                        remainingAmount = remainingAmount.minus(outstanding);
                    } else if (remainingAmount.greaterThan(0)) {
                        // Partially cover this collection
                        await extTx.agentCollection.update({
                            where: { id: coll.id },
                            data: {
                                allocatedAmount: allocated.plus(remainingAmount)
                            }
                        });
                        remainingAmount = new Prisma.Decimal(0);
                    }
                }
            }

            logger.info(`Bulk verified ${deposits.length} deposits by user ${verifierId} `, {
                depositIds,
                totalAmount: totalAmount.toString()
            });

            // Trigger proactive aging refresh (non-blocking)
            appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);

            return {
                verified: deposits.length,
                totalAmount: totalAmount.toNumber()
            };
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
     * This now completes the reconciliation in one step:
     * 1. Status: draft -> reconciled
     * 2. Order: paymentStatus -> reconciled
     * 3. Balance: totalDeposited+, currentBalance-
     * 4. GL Entry: Cash in Transit -> Cash in Hand
     */
    private async verifyCollectionInternal(tx: any, collectionId: number, verifierId: number) {
        const collection = await (tx as any).agentCollection.findUnique({
            where: { id: collectionId },
            include: { order: true }
        });

        if (!collection) {
            throw new AppError('Collection record not found', 404);
        }

        // Allow verification from draft or verified (if the flow was partially completed)
        if (collection.status !== 'draft' && collection.status !== 'verified') {
            throw new AppError(`Collection cannot be reconciled from status: ${collection.status} `, 400);
        }

        // 1. Update collection status to reconciled
        const updated = await (tx as any).agentCollection.update({
            where: { id: collectionId },
            data: {
                status: 'reconciled',
                verifiedAt: collection.verifiedAt || new Date(),
                verifiedById: collection.verifiedById || verifierId,
                approvedAt: new Date(),
                approvedById: verifierId,
            },
        });

        // 2. Update associated order paymentStatus to reconciled
        if (collection.orderId) {
            await (tx as any).order.update({
                where: { id: collection.orderId },
                data: { paymentStatus: 'reconciled' }
            });
        }

        // 3. Update agent balance - this is a settlement/reconciliation
        const balance = await this.getOrCreateBalance(collection.agentId, tx as any);
        await (tx as any).agentBalance.update({
            where: { id: balance.id },
            data: {
                totalDeposited: { increment: collection.amount }, // Reflects money settled
                currentBalance: { decrement: collection.amount }, // Removes from agent's current holding
            },
        });

        // 4. Update for User model (legacy)
        await tx.user.update({
            where: { id: collection.agentId },
            data: {
                totalCollected: {
                    increment: collection.amount,
                },
            },
        });

        // 5. Create GL Journal Entry (Transit -> Hand)
        // Only if it wasn't already verified (to avoid duplicate entries)
        if (collection.status === 'draft') {
            const { GLAutomationService } = await import('./glAutomationService');
            await GLAutomationService.createCollectionVerificationEntry(tx as any, updated, verifierId);
        }

        logger.info(`Collection ${collectionId} reconciled by user ${verifierId} `);

        // Trigger proactive aging refresh (non-blocking)
        appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);

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

            logger.info(`Agent ${agentId} blocked by user ${blockedById}.Reason: ${reason} `);
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

            logger.info(`Agent ${agentId} unblocked by user ${unblockedById} `);
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
