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
            // totalCollected += amount
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
