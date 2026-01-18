import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { GL_ACCOUNTS } from '../config/glAccounts';

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
            await this.createVerificationGLEntry(tx, updated, verifierId);

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
        const entryNumber = await this.generateEntryNumber(tx);
        const amount = new Prisma.Decimal(collection.amount);

        await tx.journalEntry.create({
            data: {
                entryNumber,
                entryDate: new Date(),
                description: `Collection verification - Order #${collection.orderId}`,
                sourceType: 'agent_collection',
                sourceId: collection.id,
                createdBy: userId,
                transactions: {
                    create: [
                        {
                            accountId: parseInt(GL_ACCOUNTS.AR_AGENTS),
                            debitAmount: amount,
                            creditAmount: 0,
                            description: `Agent AR for collection ${collection.id}`,
                        },
                        {
                            accountId: parseInt(GL_ACCOUNTS.CASH_IN_TRANSIT),
                            debitAmount: 0,
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
     */
    async bulkVerifyCollections(collectionIds: number[], verifierId: number) {
        const results = [];
        for (const id of collectionIds) {
            try {
                const result = await this.verifyCollection(id, verifierId);
                results.push({ id, success: true, result });
            } catch (error: any) {
                results.push({ id, success: false, error: error.message });
            }
        }
        return results;
    }

    /**
     * Helper to generate JE number (mimics GLAutomationService)
     */
    private async generateEntryNumber(tx: any): Promise<string> {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

        const result = await tx.$queryRaw<any[]>`
      SELECT entry_number
      FROM journal_entries
      WHERE entry_number LIKE ${'JE-' + dateStr + '-%'}
      ORDER BY entry_number DESC
      LIMIT 1
      FOR UPDATE
    `;

        let sequence = 1;
        if (result.length > 0) {
            const lastNumber = result[0].entry_number;
            const lastSequence = parseInt(lastNumber.split('-')[2], 10);
            sequence = lastSequence + 1;
        }

        return `JE-${dateStr}-${sequence.toString().padStart(5, '0')}`;
    }
}

export default new AgentReconciliationService();
