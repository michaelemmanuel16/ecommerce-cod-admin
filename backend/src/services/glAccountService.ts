import prisma from '../utils/prisma';
import logger from '../utils/logger';

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
}
