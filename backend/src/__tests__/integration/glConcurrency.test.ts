import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import prisma from '../../utils/prisma';
import glService from '../../services/glService';
import { AccountType, NormalBalance, JournalSourceType } from '@prisma/client';

describe('GL Concurrency Integration Test', () => {
    let testAccount: any;
    let offsetAccount: any;
    let systemUser: any;

    beforeAll(async () => {
        // Setup: Create a test account and user
        systemUser = await prisma.user.findFirst({ where: { role: 'admin' } });
        if (!systemUser) {
            systemUser = await prisma.user.create({
                data: {
                    email: 'gl-tester@example.com',
                    password: 'hashed-password',
                    firstName: 'GL',
                    lastName: 'Tester',
                    role: 'admin'
                }
            });
        }

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
        // Cleanup in correct order: delete child records before parents

        // Step 1: Find all journal entries that touched these accounts
        const entriesToDelete = await prisma.journalEntry.findMany({
            where: {
                transactions: {
                    some: {
                        OR: [
                            { accountId: testAccount?.id },
                            { accountId: offsetAccount?.id }
                        ]
                    }
                }
            },
            select: { id: true }
        });

        const entryIds = entriesToDelete.map(e => e.id);

        // Step 2: Delete journal entry lines (child records)
        if (entryIds.length > 0) {
            await prisma.accountTransaction.deleteMany({
                where: { journalEntryId: { in: entryIds } }
            });

            // Step 3: Delete journal entries
            await prisma.journalEntry.deleteMany({
                where: { id: { in: entryIds } }
            });
        }

        // Step 4: Delete any remaining account transactions (shouldn't be any, but safe)
        if (testAccount) {
            await prisma.accountTransaction.deleteMany({ where: { accountId: testAccount.id } });
        }
        if (offsetAccount) {
            await prisma.accountTransaction.deleteMany({ where: { accountId: offsetAccount.id } });
        }

        // Step 5: Now safe to delete accounts
        if (testAccount) {
            await prisma.account.delete({ where: { id: testAccount.id } });
        }
        if (offsetAccount) {
            await prisma.account.delete({ where: { id: offsetAccount.id } });
        }

        // Step 6: Cleanup test user if created (after all journal entries are deleted)
        if (systemUser && systemUser.email === 'gl-tester@example.com') {
            // Double-check: delete any remaining journal entries created by this user
            await prisma.accountTransaction.deleteMany({
                where: { journalEntry: { createdBy: systemUser.id } }
            });
            await prisma.journalEntry.deleteMany({
                where: { createdBy: systemUser.id }
            });

            // Now safe to delete user
            await prisma.user.delete({ where: { id: systemUser.id } });
        }
    });

    it('should maintain correct balance under heavy concurrent updates', async () => {
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
