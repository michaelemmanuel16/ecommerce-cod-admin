import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import appEvents, { AppEvent } from '../utils/appEvents';
import { TRANSACTION_CONFIG } from '../config/transactionConfig';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { OPEN_COLLECTION_STATUSES, outstandingOf } from '../utils/collectionCash';

/** What a verified deposit matched on one collection; kept on AgentDeposit.allocations so a reject reverses exactly this. */
interface DepositAllocation { collectionId: number; amount: string }

/** An open collection as read for matching. `allocatedAmount` is what the database holds now. */
export interface OpenCollection { id: number; agentId: number; amount: Prisma.Decimal; allocatedAmount: Prisma.Decimal }

/** One collection a deposit covers: `take` of its outstanding amount. `allocated` is the value it must still hold to be claimed. */
export interface Cover { id: number; agentId: number; amount: Money.Money; allocated: Money.Money; take: Money.Money }

/**
 * FIFO match of `amount` over `open` (oldest first), in memory. Updates `open` in place (a fully covered row leaves the list,
 * a part-covered row holds its new allocation) so the next deposit of the same partner plans on what is left.
 */
export function planCover(open: OpenCollection[], amount: Money.Money): {
  covers: Cover[]; allocations: DepositAllocation[]; matched: Money.Money; remaining: Money.Money;
} {
  let remaining = amount;
  const covers: Cover[] = [];
  for (let i = 0; i < open.length && remaining.gt(0);) {
    const coll = open[i];
    const outstanding = outstandingOf(coll);
    if (outstanding.lte(0)) { open.splice(i, 1); continue; }
    const take = Prisma.Decimal.min(remaining, outstanding);
    covers.push({ id: coll.id, agentId: coll.agentId, amount: Money.parse(coll.amount), allocated: Money.orZero(coll.allocatedAmount), take });
    remaining = remaining.minus(take);
    if (take.gte(outstanding)) open.splice(i, 1);
    else { coll.allocatedAmount = Money.orZero(coll.allocatedAmount).plus(take); i++; }
  }
  return {
    covers,
    allocations: covers.map((c) => ({ collectionId: c.id, amount: c.take.toString() })),
    matched: amount.minus(remaining),
    remaining,
  };
}

export class AgentReconciliationService {
    /**
     * Create a draft collection record for an order
     * Triggered when an order is delivered
     */
    async createDraftCollection(
        tx: any,
        orderId: number,
        agentId: number,
        amount: Money.MoneyInput,
        collectionDate: Date
    ) {
        const order = await tx.order.findUnique({ where: { id: orderId }, select: { tenantId: true } });
        const collection = await (tx as any).agentCollection.create({
            data: {
                tenantId: resolveTenantId(order?.tenantId),
                orderId,
                agentId,
                amount,
                status: 'draft',
                collectionDate,
            },
        });

        // Update AgentBalance — canonical path for balance tracking
        await (tx as any).agentBalance.upsert({
            where: { agentId },
            create: {
                agentId,
                totalCollected: amount,
                totalDeposited: 0,
                currentBalance: amount,
            },
            update: {
                totalCollected: { increment: amount },
                currentBalance: { increment: amount },
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
        const result = await prisma.$transaction(async (tx) => {
            return await this.verifyCollectionInternal(tx, collectionId, verifierId);
        }, TRANSACTION_CONFIG);
        // Emit AFTER transaction commits so aging refresh reads committed data
        appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);
        return result;
    }

    /**
     * Approve a verified collection record
     * This is now an alias for verifyCollection as both steps are merged.
     * It will settle the balance and ensure reconciled status.
     * Only managers/admins can perform this action
     */
    async approveCollection(collectionId: number, approverId: number) {
        const result = await prisma.$transaction(async (tx) => {
            return await this.verifyCollectionInternal(tx, collectionId, approverId);
        }, TRANSACTION_CONFIG);
        // Emit AFTER transaction commits so aging refresh reads committed data
        appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);
        return result;
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

    /** The partner's open collections, oldest first. The deposit paths and the partner payout (M5-T12) share it. */
    async loadOpenCollections(extTx: any, agentId: number): Promise<OpenCollection[]> {
        return extTx.agentCollection.findMany({
            where: { agentId, status: { in: [...OPEN_COLLECTION_STATUSES] } },
            orderBy: { collectionDate: 'asc' },
            select: { id: true, agentId: true, amount: true, allocatedAmount: true },
        });
    }

    /**
     * Cover open collections, the one write path for verified deposits and the old "mark COD deposited" route.
     * Each cover is claimed conditionally: the row must still be open and hold the allocation the plan read, so two
     * callers can never cover the same cash. A fully covered row becomes 'deposited' (one tenant-scoped UPDATE for all of
     * them); a part-covered row only gets its new allocation. Returns what was claimed, per collection and per partner.
     */
    async claimCovers(extTx: any, covers: Cover[]): Promise<{ byCollection: Map<number, Money.Money>; byAgent: Map<number, Money.Money> }> {
        const byCollection = new Map<number, Money.Money>();
        const full = covers.filter((c) => c.allocated.plus(c.take).gte(c.amount));
        const part = covers.filter((c) => !full.includes(c));
        const won = new Set<number>();

        if (full.length > 0) {
            const rows = Prisma.join(full.map((c) => Prisma.sql`(${c.id}::int, ${c.allocated.toFixed(4)}::numeric)`));
            const claimed: Array<{ id: number }> = await extTx.$queryRaw`
                UPDATE agent_collections AS c
                SET status = 'deposited'::"CollectionStatus", allocated_amount = c.amount, updated_at = now()
                FROM (VALUES ${rows}) AS v(id, alloc)
                WHERE c.id = v.id AND c.tenant_id = ${resolveTenantId()} AND c.allocated_amount = v.alloc
                  AND c.status::text IN (${Prisma.join([...OPEN_COLLECTION_STATUSES])})
                RETURNING c.id`;
            claimed.forEach((r) => won.add(r.id));
        }
        for (const c of part) {
            const res = await extTx.agentCollection.updateMany({
                where: { id: c.id, status: { in: [...OPEN_COLLECTION_STATUSES] }, allocatedAmount: c.allocated },
                data: { allocatedAmount: c.allocated.plus(c.take) },
            });
            if (res.count === 1) won.add(c.id);
        }

        const byAgent = new Map<number, Money.Money>();
        for (const c of covers.filter((x) => won.has(x.id))) {
            byCollection.set(c.id, c.take);
            byAgent.set(c.agentId, Money.add(byAgent.get(c.agentId) ?? Money.ZERO, c.take));
        }
        return { byCollection, byAgent };
    }

    /**
     * Verify one pending deposit (single and bulk verify share this): claim the row, match its amount FIFO over `open`,
     * claim the covers, post the entry, keep the allocations. Does not touch the partner balance (the callers do).
     * `open` is the partner's open collections; bulk passes the same list for each deposit of a partner.
     */
    private async verifyOne(extTx: any, deposit: any, verifierId: number, open: OpenCollection[]): Promise<any> {
        const claimData = { status: 'verified', verifiedAt: new Date(), verifiedById: verifierId };
        // Claim the row first: of two people verifying (or a verify and a reject) at once, only one gets count 1
        const claim = await extTx.agentDeposit.updateMany({ where: { id: deposit.id, status: 'pending' }, data: claimData });
        if (claim.count === 0) throw new AppError(`Already verified: ${deposit.referenceNumber}`, 409);

        const plan = planCover(open, Money.parse(deposit.amount));
        const { byCollection } = await this.claimCovers(extTx, plan.covers);
        if (byCollection.size !== plan.covers.length) throw new AppError('Collections were changed by someone else. Reload and try again.', 409);

        const { GLAutomationService } = await import('./glAutomationService');
        await GLAutomationService.createAgentDepositEntry(extTx, { ...deposit, ...claimData }, verifierId, plan);

        // The allocations are kept for a later reject; an unallocated remainder goes in the note
        return extTx.agentDeposit.update({
            where: { id: deposit.id },
            data: {
                allocations: plan.allocations,
                ...(plan.remaining.isZero() ? {} : {
                    notes: deposit.notes
                        ? `${deposit.notes} (Unallocated remainder: ${plan.remaining.toString()})`
                        : `Unallocated remainder: ${plan.remaining.toString()} `,
                }),
            },
        });
    }

    /**
     * Create a new deposit record
     */
    async createDeposit(agentId: number, amount: Money.MoneyInput, depositMethod: string, referenceNumber: string, notes?: string, receiptUrl?: string): Promise<any> {
        const depositAmount = Money.tryParse(amount);
        if (!depositAmount || depositAmount.lte(0)) {
            throw new AppError('Deposit amount must be greater than zero', 400);
        }

        return await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const balance = await this.getOrCreateBalance(agentId, extTx);
            if (Money.lt(balance.currentBalance, depositAmount)) {
                throw new AppError('Deposit amount cannot exceed your current outstanding balance', 400);
            }

            const agent = await extTx.user.findUnique({ where: { id: agentId }, select: { tenantId: true } });
            const deposit = await extTx.agentDeposit.create({
                data: {
                    tenantId: resolveTenantId(agent?.tenantId),
                    agentId,
                    amount: depositAmount,
                    depositMethod,
                    depositDate: new Date(),
                    referenceNumber,
                    notes,
                    receiptUrl,
                    status: 'pending',
                },
            });

            logger.info(`New deposit created for agent ${agentId}`, { depositId: deposit.id, amount: Money.toApi(depositAmount) });
            return deposit;
        }, TRANSACTION_CONFIG);
    }

    /**
     * Reject an agent deposit. A pending deposit only changes status. A verified deposit has posted cash, so the
     * posting is voided by a reversing entry (F-904), the partner balance is restored and the collections it matched
     * are opened again, newest first.
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

            if (deposit.status !== 'pending' && deposit.status !== 'verified') {
                throw new AppError(`Deposit cannot be rejected from status: ${deposit.status} `, 400);
            }

            // A deposit verified before allocations were recorded cannot be reversed exactly: no newest-first guess
            const allocations: DepositAllocation[] | null = Array.isArray(deposit.allocations) ? deposit.allocations : null;
            if (deposit.status === 'verified' && !allocations) {
                throw new AppError('This deposit was verified before allocation tracking. Reconcile it by hand.', 409);
            }

            const dateStr = new Date().toLocaleString();
            const formattedNotes = notes ? `${deposit.notes ? deposit.notes + '\n' : ''} [REJECTED] ${dateStr}: ${notes} ` : deposit.notes;

            // Claim the change first: of two concurrent rejects (or a reject and a verify) only one gets count 1 and runs the undo.
            const claimData = {
                status: 'rejected',
                verifiedAt: new Date(),
                verifiedById: rejectedById,
                notes: formattedNotes,
                ...(notes ? { rejectReason: notes } : {}),
            };
            const claim = await extTx.agentDeposit.updateMany({ where: { id: depositId, status: deposit.status }, data: claimData });
            if (claim.count === 0) throw new AppError('This deposit was changed by someone else. Reload and try again.', 409);

            if (deposit.status === 'verified') await this.undoVerifiedDeposit(extTx, deposit, allocations!, rejectedById);
            const updated = { ...deposit, ...claimData };

            logger.info(`Deposit ${depositId} rejected by user ${rejectedById} `);
            return updated;
        }, TRANSACTION_CONFIG);
    }

    /** Undoes what verifying a deposit did: the GL posting (voided by reversal), the balance and the matched collections. */
    private async undoVerifiedDeposit(extTx: any, deposit: any, allocations: DepositAllocation[], userId: number): Promise<void> {
        const { GLAutomationService } = await import('./glAutomationService');
        await GLAutomationService.voidJournalEntry(extTx, 'agent_deposit', deposit.id, userId);

        const balance = await this.getOrCreateBalance(deposit.agentId, extTx);
        await extTx.agentBalance.update({
            where: { id: balance.id },
            data: {
                totalDeposited: { decrement: deposit.amount },
                currentBalance: { increment: deposit.amount },
            },
        });

        // Open the collections this deposit matched again: exactly its own allocations, never another deposit's
        const matched: Array<{ id: number; status: string; allocatedAmount: Prisma.Decimal }> = await extTx.agentCollection.findMany({
            where: { id: { in: allocations.map((a) => a.collectionId) } },
            select: { id: true, status: true, allocatedAmount: true },
        });
        const amountOf = new Map(allocations.map((a) => [a.collectionId, Money.parse(a.amount)]));
        for (const coll of matched) {
            const left = Prisma.Decimal.max(Money.parse(coll.allocatedAmount).minus(amountOf.get(coll.id)!), Money.ZERO);
            await extTx.agentCollection.update({
                where: { id: coll.id },
                data: { allocatedAmount: left, ...(coll.status === 'deposited' ? { status: 'draft' } : {}) },
            });
        }

        // The excess Finding no longer stands: the deposit is void
        await extTx.finding.updateMany({
            where: { type: 'excess_deposit', subjectType: 'agent_deposit', subjectId: String(deposit.id), status: 'open' },
            data: { status: 'closed', explanation: 'Deposit rejected', resolvedAt: new Date(), resolvedById: userId },
        });
    }

    /**
     * Verify an agent deposit
     */
    async verifyDeposit(depositId: number, verifierId: number): Promise<any> {
        const result = await prisma.$transaction(async (tx) => {
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
            const depAmt = Money.parse(deposit.amount);
            const currBal = Money.parse(balance.currentBalance);

            if (currBal.lessThan(depAmt)) {
                throw new AppError('Verification failed: Deposit amount exceeds current agent balance', 400);
            }

            // The balance update comes first on purpose: its row lock serialises concurrent verifies of one partner's deposits
            // before they number their journal entries
            await extTx.agentBalance.update({
                where: { id: balance.id },
                data: {
                    totalDeposited: { increment: deposit.amount },
                    currentBalance: { decrement: deposit.amount },
                    lastSettlementDate: new Date(),
                },
            });

            const updated = await this.verifyOne(extTx, deposit, verifierId, await this.loadOpenCollections(extTx, deposit.agentId));

            logger.info(`Deposit ${depositId} verified by user ${verifierId} `);

            return updated;
        }, TRANSACTION_CONFIG);
        // Emit AFTER transaction commits so aging refresh reads committed data
        appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);
        return result;
    }

    /**
     * Bulk verify agent deposits
     * Atomic: rolls back entirely if any verification fails
     * Maximum 50 deposits per batch
     */
    async bulkVerifyDeposits(depositIds: number[], verifierId: number): Promise<{
        verified: number;
        totalAmount: Prisma.Decimal;
    }> {
        if (depositIds.length === 0) {
            throw new AppError('No deposit IDs provided', 400);
        }

        if (depositIds.length > 50) {
            throw new AppError('Cannot verify more than 50 deposits at once', 400);
        }

        const result = await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            let totalAmount = Money.ZERO;

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

            // Process each agent's deposits
            for (const [agentId, agentDeposits] of depositsByAgent) {
                // Use Prisma ORM (not $queryRaw) to stay on the transaction's connection.
                // $queryRaw with FOR UPDATE can self-deadlock in Prisma interactive transactions.
                const balance = await this.getOrCreateBalance(agentId, extTx);

                const currBal = Money.parse(balance.currentBalance);

                // Calculate total deposit amount for this agent
                const agentTotalDeposit = agentDeposits.reduce(
                    (sum, d) => sum.plus(Money.parse(d.amount)),
                    Money.ZERO
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

                // Verify the deposits oldest first; the partner's open collections are read once and matched in memory
                const open = await this.loadOpenCollections(extTx, agentId);
                for (const deposit of agentDeposits) {
                    await this.verifyOne(extTx, deposit, verifierId, open);
                    totalAmount = totalAmount.plus(Money.parse(deposit.amount));
                }

                // Update agent balance once per agent
                await extTx.agentBalance.update({
                    where: { id: balance.id },
                    data: {
                        totalDeposited: { increment: agentTotalDeposit },
                        currentBalance: { decrement: agentTotalDeposit },
                        lastSettlementDate: new Date(),
                    },
                });
            }

            logger.info(`Bulk verified ${deposits.length} deposits by user ${verifierId} `, {
                depositIds,
                totalAmount: totalAmount.toString()
            });

            return {
                verified: deposits.length,
                totalAmount
            };
        }, TRANSACTION_CONFIG);
        // Emit AFTER transaction commits so aging refresh reads committed data
        appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);
        return result;
    }

    /**
     * Get specific agent balance
     */
    async getAgentBalance(agentId: number) {
        const tenantId = getTenantId();
        return await (prisma as unknown as any).agentBalance.findUnique({
            where: { agentId, ...(tenantId ? { tenantId } : {}) },
        });
    }

    /**
     * Get all agent balances
     */
    async getAllAgentBalances(): Promise<any[]> {
        const tenantId = getTenantId();
        return await (prisma as unknown as any).agentBalance.findMany({
            where: { ...(tenantId ? { tenantId } : {}) },
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
        const results = await prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const results = [];
            for (const id of collectionIds) {
                // Fail fast - any error will roll back the transaction
                const result = await this.verifyCollectionInternal(extTx, id, verifierId);
                results.push(result);
            }
            return results;
        }, TRANSACTION_CONFIG);
        // Emit AFTER transaction commits so aging refresh reads committed data
        appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);
        return results;
    }

    /**
     * Internal version of verifyCollection that accepts a transaction client
     * This now completes the reconciliation in one step:
     * 1. Status: draft -> reconciled
     * 2. Order: paymentStatus -> reconciled
     * 3. Balance: totalDeposited+, currentBalance-
     * No journal entry: 1015 already holds the cash, net of the delivery fee. It moves to 1010 once, when a deposit
     * is verified or a settlement line matches (F-904).
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

        logger.info(`Collection ${collectionId} reconciled by user ${verifierId} `);

        // Note: aging refresh event is emitted by the caller AFTER the transaction commits
        // to avoid race conditions where refreshAll() reads uncommitted data

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

            // Warn if agent has active deliveries
            const activeDeliveries = await extTx.order.count({
                where: {
                    deliveryAgentId: agentId,
                    status: { in: ['out_for_delivery', 'ready_for_pickup'] }
                }
            });
            if (activeDeliveries > 0) {
                logger.warn(`Blocking agent ${agentId} who has ${activeDeliveries} active deliveries`);
            }

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
        }, TRANSACTION_CONFIG);
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
        }, TRANSACTION_CONFIG);
    }

    /**
     * Get all currently blocked agents
     */
    async getBlockedAgents() {
        const tenantId = getTenantId();
        return await (prisma as any).agentBalance.findMany({
            where: { isBlocked: true, ...(tenantId ? { tenantId } : {}) },
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
