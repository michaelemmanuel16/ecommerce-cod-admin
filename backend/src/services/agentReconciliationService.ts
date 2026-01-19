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
        const collection = await tx.agentCollection.create({
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
            const collection = await tx.agentCollection.findUnique({
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
            const updated = await tx.agentCollection.update({
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
        const entryNumber = await GLUtils.generateEntryNumber(tx);
        const amount = new Prisma.Decimal(collection.amount.toString());

        await tx.journalEntry.create({
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
            const collection = await tx.agentCollection.findUnique({
                where: { id: collectionId },
            });

            if (!collection) {
                throw new AppError('Collection record not found', 404);
            }

            if (collection.status !== 'verified') {
                throw new AppError(`Collection cannot be approved from status: ${collection.status}`, 400);
            }

            // Update collection status
            const updated = await tx.agentCollection.update({
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

    /**
     * Get or create agent balance record
     */
    async getOrCreateBalance(agentId: number, tx?: Prisma.TransactionClient) {
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
    async createDeposit(agentId: number, amount: number, referenceNumber?: string, notes?: string) {
        if (amount <= 0) {
            throw new AppError('Deposit amount must be greater than zero', 400);
        }

        const deposit = await (prisma as any).agentDeposit.create({
            data: {
                agentId,
                amount,
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
     * Verify an agent deposit
     */
    async verifyDeposit(depositId: number, verifierId: number) {
        return await prisma.$transaction(async (tx) => {
            const deposit = await (tx as any).agentDeposit.findUnique({
                where: { id: depositId },
            });

            if (!deposit) {
                throw new AppError('Deposit record not found', 404);
            }

            if (deposit.status !== 'pending') {
                throw new AppError(`Deposit cannot be verified from status: ${deposit.status}`, 400);
            }

            // Update deposit record
            const updated = await (tx as any).agentDeposit.update({
                where: { id: depositId },
                data: {
                    status: 'verified',
                    verifiedAt: new Date(),
                    verifiedById: verifierId,
                },
            });

            // Update agent balance
            const balance = await this.getOrCreateBalance(deposit.agentId, tx as any);

            // Validation: Prevent negative balance
            if (new Prisma.Decimal(balance.currentBalance.toString()).lessThan(deposit.amount)) {
                throw new AppError('Verification failed: Deposit amount exceeds current agent balance', 400);
            }

            await (tx as any).agentBalance.update({
                where: { id: balance.id },
                data: {
                    totalDeposited: { increment: deposit.amount },
                    currentBalance: { decrement: deposit.amount },
                    lastSettlementDate: new Date(),
                },
            });

            // Create GL Entry
            // Debit: CASH_IN_HAND (1010) - Assuming direct cash handover or bank dep
            // Credit: AR_AGENTS (1020)
            await this.createDepositGLEntry(tx as any, updated, verifierId);

            logger.info(`Deposit ${depositId} verified by user ${verifierId}`);
            return updated;
        });
    }

    /**
     * Create GL entry for deposit verification
     */
    private async createDepositGLEntry(tx: any, deposit: any, userId: number) {
        const entryNumber = await GLUtils.generateEntryNumber(tx);
        const amount = new Prisma.Decimal(deposit.amount.toString());

        await tx.journalEntry.create({
            data: {
                entryNumber,
                entryDate: new Date(),
                description: `Agent deposit verification - Deposit #${deposit.id}`,
                sourceType: JournalSourceType.agent_deposit,
                sourceId: deposit.id,
                createdBy: userId,
                transactions: {
                    create: [
                        {
                            accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND),
                            debitAmount: amount,
                            creditAmount: new Prisma.Decimal(0),
                            description: `Cash received from agent ${deposit.agentId}`,
                        },
                        {
                            accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.AR_AGENTS),
                            debitAmount: new Prisma.Decimal(0),
                            creditAmount: amount,
                            description: `Agent AR cleared for deposit ${deposit.id}`,
                        },
                    ],
                },
            },
        });
    }

    /**
     * Get specific agent balance
     */
    async getAgentBalance(agentId: number) {
        return await (prisma as any).agentBalance.findUnique({
            where: { agentId },
        });
    }

    /**
     * Get all agent balances
     */
    async getAllAgentBalances() {
        return await (prisma as any).agentBalance.findMany({
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
            const results = [];
            for (const id of collectionIds) {
                // Fail fast - any error will roll back the transaction
                const result = await this.verifyCollectionInternal(tx, id, verifierId);
                results.push(result);
            }
            return results;
        });
    }

    /**
     * Internal version of verifyCollection that accepts a transaction client
     */
    private async verifyCollectionInternal(tx: any, collectionId: number, verifierId: number) {
        const collection = await tx.agentCollection.findUnique({
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
        const updated = await tx.agentCollection.update({
            where: { id: collectionId },
            data: {
                status: 'verified',
                verifiedAt: new Date(),
                verifiedById: verifierId,
            },
        });

        // Create GL Journal Entry using shared utility
        await this.createVerificationGLEntry(tx, updated, verifierId);

        logger.info(`Collection ${collectionId} verified by user ${verifierId}`);
        return updated;
    }

}

export default new AgentReconciliationService();
