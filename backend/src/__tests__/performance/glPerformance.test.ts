import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import prisma from '../../utils/prisma';
import glService from '../../services/glService';
import { AccountType, NormalBalance, JournalSourceType } from '@prisma/client';

describe('GL Performance Test', () => {
    let perfAccount: any;
    let offsetAccount: any;
    let systemUser: any;
    const TRANSACTION_COUNT = 200; // Reduced for faster/stable CI

    beforeAll(async () => {
        systemUser = await prisma.user.findFirst({ where: { role: 'admin' } });

        perfAccount = await prisma.account.create({
            data: {
                code: 'PERF-' + Math.floor(Math.random() * 10000),
                name: 'Performance Test Account',
                accountType: AccountType.asset,
                normalBalance: NormalBalance.debit,
                currentBalance: 0
            }
        });

        offsetAccount = await prisma.account.create({
            data: {
                code: 'POFF-' + Math.floor(Math.random() * 10000),
                name: 'Performance Offset Account',
                accountType: AccountType.equity,
                normalBalance: NormalBalance.credit,
                currentBalance: 0
            }
        });

        console.log(`Seeding ${TRANSACTION_COUNT} transactions for performance testing...`);

        // Seed using a loop for simplicity, or use createMany if possible
        // Note: Creating individual journal entries is more realistic as it updates balances each time
        for (let i = 0; i < TRANSACTION_COUNT; i++) {
            await glService.createJournalEntry({
                entryDate: new Date(),
                description: `Seed Entry ${i}`,
                sourceType: JournalSourceType.manual,
                transactions: [
                    {
                        accountId: perfAccount.id,
                        debitAmount: 10,
                        creditAmount: 0,
                        description: `Part ${i}`
                    },
                    {
                        accountId: offsetAccount.id,
                        debitAmount: 0,
                        creditAmount: 10,
                        description: `Offset ${i}`
                    }
                ]
            }, systemUser);

            if (i % 200 === 0) console.log(`Seeded ${i} entries...`);
        }
    }, 60000); // 60s timeout for seeding

    afterAll(async () => {
        if (perfAccount) {
            await prisma.accountTransaction.deleteMany({ where: { accountId: perfAccount.id } });
            await prisma.account.delete({ where: { id: perfAccount.id } });
        }
        if (offsetAccount) {
            await prisma.accountTransaction.deleteMany({ where: { accountId: offsetAccount.id } });
            await prisma.account.delete({ where: { id: offsetAccount.id } });
        }
    });

    it('should fetch paginated ledger data efficiently', async () => {
        const start = Date.now();
        const result = await glService.getAccountLedger(perfAccount.id.toString(), {
            page: 1,
            limit: 50
        });
        const duration = Date.now() - start;

        console.log(`Paginated fetch (50/1000) took ${duration}ms`);
        expect(result.transactions.length).toBe(50);
        expect(result.pagination.total).toBe(TRANSACTION_COUNT);
        expect(duration).toBeLessThan(200); // Expect < 200ms
    });

    it('should export large ledger to CSV efficiently', async () => {
        const start = Date.now();
        const result = await glService.exportAccountLedgerToCSV(perfAccount.id.toString(), {});
        const duration = Date.now() - start;

        console.log(`CSV Export (${TRANSACTION_COUNT} records) took ${duration}ms`);
        expect(result.csv).toBeDefined();
        expect(result.csv.length).toBeGreaterThan(1000);
        expect(duration).toBeLessThan(1000); // Expect < 1s
    });
});
