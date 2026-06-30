import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import prisma from '../../utils/prisma';
import glService from '../../services/glService';
import { AccountType, NormalBalance, JournalSourceType } from '@prisma/client';
import { withGlTestTenant } from './helpers/glTestTenant';
import { tenantStorage } from '../../utils/tenantContext';

describe('GL Concurrency Integration Test', () => {
    let testAccount: any;
    let offsetAccount: any;
    let systemUser: any;
    let testTenantId: string;

    beforeAll(async () => {
        // Unscoped cleanup, then seed + enter tenant context (mirrors a request).
        testTenantId = await withGlTestTenant(async () => {
            await prisma.accountTransaction.deleteMany({});
            await prisma.journalEntry.deleteMany({});
        });

        // Seed under tenant context so account/user rows are tenant-scoped.
        // Upsert (not create) so the suite is idempotent across local re-runs —
        // User deletes are soft (isActive:false), so the email would otherwise collide.
        systemUser = await prisma.user.upsert({
            where: { email: 'gl-concurrency-tester@example.com' },
            update: { isActive: true, role: 'admin' },
            create: {
                email: 'gl-concurrency-tester@example.com',
                password: 'hashed-password',
                firstName: 'GL',
                lastName: 'Tester',
                role: 'admin'
            }
        });

        testAccount = await prisma.account.create({
            data: {
                code: 'TEST-' + Math.floor(Math.random() * 10000),
                name: 'Concurrency Test Account',
                accountType: AccountType.asset,
                normalBalance: NormalBalance.debit,
                currentBalance: 0
            }
        });

        offsetAccount = await prisma.account.create({
            data: {
                code: 'OFF-' + Math.floor(Math.random() * 10000),
                name: 'Concurrency Offset Account',
                accountType: AccountType.equity,
                normalBalance: NormalBalance.credit,
                currentBalance: 0
            }
        });
    });

    afterAll(async () => {
        // Cleanup: Delete JournalEntries first, which will cascade to AccountTransactions
        const accountIds = [];
        if (testAccount) accountIds.push(testAccount.id);
        if (offsetAccount) accountIds.push(offsetAccount.id);

        if (accountIds.length > 0) {
            // Find all journal entries that have transactions for these accounts
            const entries = await prisma.journalEntry.findMany({
                where: {
                    transactions: {
                        some: {
                            accountId: { in: accountIds }
                        }
                    }
                }
            });

            const entryIds = entries.map(e => e.id);

            if (entryIds.length > 0) {
                // Delete the journal entries (cascades to transactions)
                await prisma.journalEntry.deleteMany({
                    where: { id: { in: entryIds } }
                });
            }

            // Now delete the accounts
            if (testAccount) {
                await prisma.accountTransaction.deleteMany({ where: { accountId: testAccount.id } });
                await prisma.account.delete({ where: { id: testAccount.id } }).catch(err => {
                    console.warn(`Failed to delete testAccount ${testAccount.id}: ${err.message}`);
                });
            }
            if (offsetAccount) {
                await prisma.accountTransaction.deleteMany({ where: { accountId: offsetAccount.id } });
                await prisma.account.delete({ where: { id: offsetAccount.id } }).catch(err => {
                    console.warn(`Failed to delete offsetAccount ${offsetAccount.id}: ${err.message}`);
                });
            }
        }
    });

    it('should maintain correct balance under heavy concurrent updates', async () => {
        // restoreMocks wipes the beforeAll getTenantId spy before this test, so run
        // the body inside real ALS tenant context (faithful to a live request).
        await tenantStorage.run({ tenantId: testTenantId }, async () => {
            const concurrentCount = 10;
            const amount = 100; // Each transaction is 100 debit
            const expectedBalance = concurrentCount * amount;

            console.log(`Starting ${concurrentCount} concurrent journal entries against Account ${testAccount.code}...`);

            // Fire all transactions simultaneously
            const promises = Array.from({ length: concurrentCount }).map((_, i) => {
                return glService.createJournalEntry({
                    entryDate: new Date(),
                    description: `Concurrent Test Entry ${i}`,
                    sourceType: JournalSourceType.manual,
                    transactions: [
                        {
                            accountId: testAccount.id,
                            debitAmount: amount,
                            creditAmount: 0,
                            description: `Debit part ${i}`
                        },
                        {
                            accountId: offsetAccount.id,
                            debitAmount: 0,
                            creditAmount: amount,
                            description: `Credit part ${i}`
                        }
                    ]
                }, systemUser);
            });

            // Wait for all to complete
            await Promise.all(promises);

            // Verify final balance
            const updatedAccount = await prisma.account.findUnique({
                where: { id: testAccount.id }
            });

            console.log(`Final balance: ${updatedAccount?.currentBalance.toString()}`);
            expect(Number(updatedAccount?.currentBalance)).toBe(expectedBalance);
        });
    });
});
