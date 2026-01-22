import { Prisma } from '@prisma/client';
import logger from './logger';

/**
 * Shared utilities for General Ledger operations
 */
export class GLUtils {
    /**
     * Generate a unique journal entry number
     * Format: JE-YYYYMMDD-XXXXX (e.g., JE-20260117-00001)
     * Sequence resets daily
     * 
     * @param tx - Prisma transaction client
     * @returns Generated entry number string
     */
    static async generateEntryNumber(tx: Prisma.TransactionClient): Promise<string> {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

        // Find the last entry for today using safe interpolation for the LIKE pattern
        const pattern = `JE-${dateStr}-%`;
        const result = await tx.$queryRaw<any[]>`
      SELECT entry_number
      FROM journal_entries
      WHERE entry_number LIKE ${pattern}
      ORDER BY entry_number DESC
      LIMIT 1
      FOR UPDATE
    `;

        let sequence = 1;
        if (result.length > 0) {
            const lastNumber = result[0].entry_number;
            // Handle the case where the entry_number format might be unexpected
            try {
                const parts = lastNumber.split('-');
                if (parts.length >= 3) {
                    const lastSequence = parseInt(parts[2], 10);
                    if (!isNaN(lastSequence)) {
                        sequence = lastSequence + 1;
                    }
                }
            } catch (e) {
                logger.warn('Failed to parse last journal entry sequence, starting from 1', {
                    lastNumber,
                    error: e instanceof Error ? e.message : String(e)
                });
            }
        }

        return `JE-${dateStr}-${sequence.toString().padStart(5, '0')}`;
    }
}
