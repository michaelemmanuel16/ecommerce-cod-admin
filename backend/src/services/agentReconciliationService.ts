import { CollectionStatus, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import appEvents, { AppEvent } from '../utils/appEvents';
import { TRANSACTION_CONFIG } from '../config/transactionConfig';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { OPEN_COLLECTION_STATUSES, outstandingOf } from '../utils/collectionCash';
import { GLAutomationService } from './glAutomationService';
import { openFindingOnce } from './findingService';

/** What a verified deposit matched on one collection; kept on AgentDeposit.allocations so a reject reverses exactly this. */
interface DepositAllocation { collectionId: number; amount: string }

type DepositClaim = { status: 'verified'; verifiedAt: Date; verifiedById: number };

/** An open collection as read for matching. `allocatedAmount` is what the database holds now. */
export interface OpenCollection { id: number; agentId: number; amount: Prisma.Decimal; allocatedAmount: Prisma.Decimal; orderId?: number }

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

/** A verify that would take a partner's cash held below zero (F-912). It carries what the Finding needs; the caller opens it after the rollback. */
export class BalanceBelowZeroError extends AppError {
  constructor(message: string, readonly agentId: number, readonly shortfall: Money.Money, readonly subject: { type: string; id: string }) {
    super(message, 400, 'BALANCE_BELOW_ZERO');
  }
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
        const result = await this.openFindingOnBelowZero(() => prisma.$transaction(async (tx) => {
            return await this.verifyCollectionInternal(tx, collectionId, verifierId);
        }, TRANSACTION_CONFIG));
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

    /**
     * Take `amount` off the partner's cash held and add it to deposited, only while the balance stays at zero or above.
     * One conditional UPDATE, so two verifies at once cannot both pass a read-then-write check (F-912).
     */
    private async debitBalance(extTx: any, agentId: number, amount: Money.Money, subject: { type: string; id: string }, message: string): Promise<void> {
        const balance = await this.getOrCreateBalance(agentId, extTx);
        const done = await extTx.agentBalance.updateMany({
            where: { id: balance.id, currentBalance: { gte: amount } },
            data: { totalDeposited: { increment: amount }, currentBalance: { decrement: amount }, lastSettlementDate: new Date() },
        });
        if (done.count === 0) throw new BalanceBelowZeroError(message, agentId, amount.minus(Money.orZero(balance.currentBalance)), subject);
    }

    /**
     * Runs a verify. When it fails because it would push a partner below zero, the transaction has rolled back, so the
     * Finding is opened here, after it, and the error still reaches the caller.
     */
    private async openFindingOnBelowZero<T>(verify: () => Promise<T>): Promise<T> {
        try {
            return await verify();
        } catch (error) {
            if (error instanceof BalanceBelowZeroError) {
                await openFindingOnce({
                    tenantId: resolveTenantId(),
                    type: 'negative_cash_held',
                    subjectType: error.subject.type,
                    subjectId: error.subject.id,
                    amount: error.shortfall,
                    note: `A verify was refused: it would take partner #${error.agentId} ${Money.toApi(error.shortfall)} below zero cash held.`,
                }, { updateAmount: true }).catch((e) => logger.error('Could not open the below-zero Finding', e));
            }
            throw error;
        }
    }

    /** The partner's open collections, oldest first; `orderIds` limits them to those orders. The deposit paths and the partner payout (M5-T11, T12) share it. */
    async loadOpenCollections(extTx: any, agentId: number, orderIds?: number[]): Promise<OpenCollection[]> {
        return extTx.agentCollection.findMany({
            where: { agentId, status: { in: [...OPEN_COLLECTION_STATUSES] }, ...(orderIds ? { orderId: { in: orderIds } } : {}) },
            orderBy: [{ collectionDate: 'asc' }, { id: 'asc' }],
            select: { id: true, agentId: true, amount: true, allocatedAmount: true, orderId: true },
        });
    }

    /**
     * Mark collections reconciled and their orders paid (F-912): status and approval, the verifier where none is set yet,
     * an optional link to the settlement line that paid each, and `Order.paymentStatus`. One statement per table, whatever
     * the number of rows. The one writer of "reconciled": a single verify and a settlement both come here.
     * `onlyFrom` makes it a claim: only rows still in one of those statuses are reconciled, and if any row is not,
     * the call throws "Already verified" (409) and the caller's transaction rolls back. So of two people verifying the
     * same row, the second gets that error.
     */
    async reconcileCollectionRows(
        extTx: any,
        items: Array<{ collectionId: number; orderId: number | null; settlementLineId?: number }>,
        actorId: number,
        opts: { onlyFrom?: readonly CollectionStatus[] } = {},
    ): Promise<void> {
        if (items.length === 0) return;
        const now = new Date();
        const ids = items.map((i) => i.collectionId);
        const claim = await extTx.agentCollection.updateMany({
            where: { id: { in: ids }, ...(opts.onlyFrom ? { status: { in: [...opts.onlyFrom] } } : {}) },
            data: { status: 'reconciled', approvedAt: now, approvedById: actorId },
        });
        if (opts.onlyFrom && claim.count !== ids.length) throw new AppError('Already verified', 409, 'ALREADY_VERIFIED');
        await extTx.agentCollection.updateMany({ where: { id: { in: ids }, verifiedAt: null }, data: { verifiedAt: now, verifiedById: actorId } });
        const linked = items.filter((i) => i.settlementLineId !== undefined);
        if (linked.length > 0) {
            const rows = Prisma.join(linked.map((i) => Prisma.sql`(${i.collectionId}::int, ${i.settlementLineId}::int)`));
            await extTx.$executeRaw`
                UPDATE agent_collections AS c SET settlement_line_id = v.line
                FROM (VALUES ${rows}) AS v(id, line)
                WHERE c.id = v.id AND c.tenant_id = ${resolveTenantId()}`;
        }
        const orderIds = items.map((i) => i.orderId).filter((id): id is number => id !== null);
        if (orderIds.length > 0) await extTx.order.updateMany({ where: { id: { in: orderIds } }, data: { paymentStatus: 'reconciled' } });
    }

    /**
     * The tail of every verified deposit (single, bulk and partner payout): claim the covers of the plan, post the entry,
     * keep the allocations and note any unallocated remainder on the deposit. `deposit` is the verified row.
     * Returns the updated deposit and the id of the excess_deposit Finding the entry opened, if any.
     */
    async settleDeposit(extTx: any, deposit: any, userId: number, plan: ReturnType<typeof planCover>): Promise<{ deposit: any; excessFindingId: number | null }> {
        const { byCollection } = await this.claimCovers(extTx, plan.covers);
        if (byCollection.size !== plan.covers.length) throw new AppError('Collections were changed by someone else. Reload and try again.', 409);

        const { excessFindingId } = await GLAutomationService.createAgentDepositEntry(extTx, deposit, userId, plan);
        const updated = await extTx.agentDeposit.update({
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
        return { deposit: updated, excessFindingId };
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
    private async verifyOne(extTx: any, deposit: any, verifierId: number, open: OpenCollection[], claimed?: DepositClaim): Promise<any> {
        const claimData = claimed ?? await this.claimDeposit(extTx, deposit, verifierId);
        const plan = planCover(open, Money.parse(deposit.amount));
        // The allocations are kept for a later reject; an unallocated remainder goes in the note
        return (await this.settleDeposit(extTx, { ...deposit, ...claimData }, verifierId, plan)).deposit;
    }

    /** Claim the row first: of two people verifying (or a verify and a reject) at once, only one gets count 1; the other gets "Already verified". */
    private async claimDeposit(extTx: any, deposit: any, verifierId: number): Promise<DepositClaim> {
        const claimData = { status: 'verified' as const, verifiedAt: new Date(), verifiedById: verifierId };
        const claim = await extTx.agentDeposit.updateMany({ where: { id: deposit.id, status: 'pending' }, data: claimData });
        if (claim.count === 0) throw new AppError(`Already verified: ${deposit.referenceNumber}`, 409, 'ALREADY_VERIFIED');
        return claimData;
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
    async rejectDeposit(depositId: number, rejectedById: number, reason: string): Promise<any> {
        const notes = reason?.trim();
        if (!notes) throw new AppError('A reason is required to reject a deposit', 400);
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
                rejectReason: notes,
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
        const result = await this.openFindingOnBelowZero(() => prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const deposit = await extTx.agentDeposit.findUnique({
                where: { id: depositId },
            });

            if (!deposit) {
                throw new AppError('Deposit record not found', 404);
            }

            if (deposit.status === 'verified') throw new AppError(`Already verified: ${deposit.referenceNumber}`, 409, 'ALREADY_VERIFIED');
            if (deposit.status !== 'pending') {
                throw new AppError(`Deposit cannot be verified from status: ${deposit.status} `, 400);
            }

            // Claim the row, then take the amount off the balance. The balance update's row lock serialises concurrent verifies
            // of one partner's deposits before they number their journal entries, and it only passes while the balance stays
            // at zero or above.
            const claimed = await this.claimDeposit(extTx, deposit, verifierId);
            await this.debitBalance(extTx, deposit.agentId, Money.parse(deposit.amount), { type: 'agent_deposit', id: String(depositId) },
                'Verification failed: Deposit amount exceeds current agent balance');

            const updated = await this.verifyOne(extTx, deposit, verifierId, await this.loadOpenCollections(extTx, deposit.agentId), claimed);

            logger.info(`Deposit ${depositId} verified by user ${verifierId} `);

            return updated;
        }, TRANSACTION_CONFIG));
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

        const result = await this.openFindingOnBelowZero(() => prisma.$transaction(async (tx) => {
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
                // Claim the rows first (a row someone else verified meanwhile is "Already verified"), then take the
                // total off the balance in one conditional update that only passes while it stays at zero or above.
                const claims: DepositClaim[] = [];
                for (const deposit of agentDeposits) claims.push(await this.claimDeposit(extTx, deposit, verifierId));

                const agentTotalDeposit = agentDeposits.reduce(
                    (sum, d) => sum.plus(Money.parse(d.amount)),
                    Money.ZERO
                );
                await this.debitBalance(extTx, agentId, agentTotalDeposit, { type: 'delivery_partner', id: String(agentId) },
                    `Verification failed: agent #${agentId} has insufficient balance for ${Money.toApi(agentTotalDeposit)}`);

                // Verify the deposits oldest first; the partner's open collections are read once and matched in memory
                const open = await this.loadOpenCollections(extTx, agentId);
                for (const [i, deposit] of agentDeposits.entries()) {
                    await this.verifyOne(extTx, deposit, verifierId, open, claims[i]);
                    totalAmount = totalAmount.plus(Money.parse(deposit.amount));
                }
            }

            logger.info(`Bulk verified ${deposits.length} deposits by user ${verifierId} `, {
                depositIds,
                totalAmount: totalAmount.toString()
            });

            return {
                verified: deposits.length,
                totalAmount
            };
        }, TRANSACTION_CONFIG));
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
        const results = await this.openFindingOnBelowZero(() => prisma.$transaction(async (tx) => {
            const extTx = tx as any;
            const results = [];
            for (const id of collectionIds) {
                // Fail fast - any error will roll back the transaction
                const result = await this.verifyCollectionInternal(extTx, id, verifierId);
                results.push(result);
            }
            return results;
        }, TRANSACTION_CONFIG));
        // Emit AFTER transaction commits so aging refresh reads committed data
        appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);
        return results;
    }

    /**
     * Verify and reconcile a collection in one step (F-912). The path is draft to reconciled:
     * 1. Claim the row (draft only; a second caller gets "Already verified"), mark the order paid
     * 2. Take the open amount off the partner's cash held, only while it stays at zero or above
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

        if (collection.status === 'reconciled') throw new AppError('Already verified', 409, 'ALREADY_VERIFIED');
        if (collection.status !== 'draft') {
            throw new AppError(`Collection cannot be reconciled from status: ${collection.status} `, 400);
        }

        // 1. The claim: status draft to reconciled and the order's paymentStatus, through the one writer
        await this.reconcileCollectionRows(tx, [{ collectionId, orderId: collection.orderId ?? null }], verifierId, { onlyFrom: ['draft'] });
        const updated = { ...collection, status: 'reconciled', approvedById: verifierId };

        // 2. Cash held drops by what no deposit covered yet
        await this.debitBalance(tx, collection.agentId, outstandingOf(collection), { type: 'agent_collection', id: String(collectionId) },
            'Verification failed: the collection amount exceeds the partner cash held');

        // 3. Legacy User total
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
