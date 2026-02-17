import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Service for resolving General Ledger account IDs from codes.
 * Decouples business logic from database auto-incrementing/fixed IDs.
 */
export class GLAccountService {
    private static idCache: Map<string, number> = new Map();

    /**
     * Get the database ID for a GL account code (e.g., '1015')
     * Uses a static cache to minimize database hits.
     * 
     * @param code - 4-digit account code
     * @param tx - Optional transaction client (use this to avoid connection pool exhaustion)
     * @returns Database ID
     * @throws Error if account does not exist
     */
    static async getAccountIdByCode(code: string, tx?: any): Promise<number> {
        const cachedId = this.idCache.get(code);
        if (cachedId) return cachedId;

        const client = tx || prisma;
        const account = await client.account.findUnique({
            where: { code },
            select: { id: true }
        });

        if (!account) {
            logger.error(`GL Account with code ${code} not found in database.`);
            throw new Error(`Critical Error: GL Account ${code} not found. Please ensure Chart of Accounts is seeded.`);
        }

        this.idCache.set(code, account.id);
        return account.id;
    }

    /**
     * Clear the account ID cache (useful for tests)
     */
    static clearCache(): void {
        this.idCache.clear();
    }

    /**
     * Verify all required GL accounts exist in the database
     * Throws if any configured account code is missing
     * 
     * @param codes - Array of account codes to verify
     */
    static async verifyRequiredAccounts(codes: string[]): Promise<void> {
        for (const code of codes) {
            await this.getAccountIdByCode(code);
        }
        logger.info(`Successfully verified ${codes.length} GL accounts.`);
    }

    /**
     * Verify that a single account's stored balance matches the sum of its transaction history.
     * Allows up to 0.01 rounding tolerance.
     */
    static async verifyAccountBalanceIntegrity(accountId: number): Promise<{
        storedBalance: Decimal;
        calculatedBalance: Decimal;
        isBalanced: boolean;
        difference: Decimal;
    }> {
        const [account, sums] = await prisma.$transaction(async (tx) => {
            const acc = await tx.account.findUnique({
                where: { id: accountId },
                select: { currentBalance: true, normalBalance: true }
            });
            const s = await tx.accountTransaction.aggregate({
                where: { accountId },
                _sum: { debitAmount: true, creditAmount: true }
            });
            return [acc, s];
        });

        if (!account) {
            throw new Error(`Account ${accountId} not found`);
        }

        const debitSum = new Decimal(sums._sum.debitAmount?.toString() || '0');
        const creditSum = new Decimal(sums._sum.creditAmount?.toString() || '0');
        const storedBalance = new Decimal(account.currentBalance.toString());

        const calculatedBalance = account.normalBalance === 'debit'
            ? debitSum.minus(creditSum)
            : creditSum.minus(debitSum);

        const difference = calculatedBalance.minus(storedBalance);
        const isBalanced = difference.abs().lessThanOrEqualTo(new Decimal('0.01'));

        return { storedBalance, calculatedBalance, isBalanced, difference };
    }

    /**
     * Verify balance integrity for all active GL accounts.
     * Returns a summary of any accounts with discrepancies.
     */
    static async verifyAllAccountBalances(): Promise<{
        totalAccounts: number;
        unbalanced: Array<{ accountId: number; code: string; difference: Decimal }>;
        maxDifference: Decimal;
    }> {
        const accounts = await prisma.account.findMany({
            where: { isActive: true },
            select: { id: true, code: true }
        });

        const unbalanced: Array<{ accountId: number; code: string; difference: Decimal }> = [];
        let maxDifference = new Decimal('0');

        for (const account of accounts) {
            const result = await this.verifyAccountBalanceIntegrity(account.id);
            if (!result.isBalanced) {
                const absDiff = result.difference.abs();
                if (absDiff.greaterThan(maxDifference)) {
                    maxDifference = absDiff;
                }
                unbalanced.push({
                    accountId: account.id,
                    code: account.code,
                    difference: result.difference
                });
            }
        }

        logger.info(`Balance verification complete: ${accounts.length} accounts checked, ${unbalanced.length} unbalanced`);

        return {
            totalAccounts: accounts.length,
            unbalanced,
            maxDifference
        };
    }
}
