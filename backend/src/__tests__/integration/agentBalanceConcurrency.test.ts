import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import prisma from '../../utils/prisma';
import agentReconciliationService from '../../services/agentReconciliationService';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { AccountType, NormalBalance, Prisma } from '@prisma/client';

describe('Agent Balance Concurrency Integration Test', () => {
    let testUser: any;
    let testAgent: any;

    beforeAll(async () => {
        // Clean up
        await prisma.accountTransaction.deleteMany({});
        await prisma.journalEntry.deleteMany({});
        await (prisma as any).agentDeposit.deleteMany({});
        await (prisma as any).agentBalance.deleteMany({});
        await prisma.user.deleteMany({
            where: { email: { in: ['admin-con@test.com', 'agent-con@test.com'] } }
        });

        // Setup GL Accounts needed
        const accounts: Prisma.AccountUncheckedCreateInput[] = [
            { id: parseInt(GL_ACCOUNTS.AR_AGENTS), code: GL_ACCOUNTS.AR_AGENTS, name: 'Agent AR', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { id: parseInt(GL_ACCOUNTS.CASH_IN_HAND), code: GL_ACCOUNTS.CASH_IN_HAND, name: 'Cash in Hand', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { id: parseInt(GL_ACCOUNTS.CASH_IN_TRANSIT), code: GL_ACCOUNTS.CASH_IN_TRANSIT, name: 'Cash in Transit', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
        ];
        for (const a of accounts) {
            await prisma.account.upsert({
                where: { code: a.code },
                update: a as Prisma.AccountUpdateInput,
                create: a
            });
        }

        testUser = await prisma.user.create({
            data: {
                email: 'admin-con@test.com',
                password: 'password',
                firstName: 'Admin',
                lastName: 'User',
                role: 'admin',
                phoneNumber: '11',
            }
        });

        testAgent = await prisma.user.create({
            data: {
                email: 'agent-con@test.com',
                password: 'password',
                firstName: 'Agent',
                lastName: 'Concurrency',
                role: 'delivery_agent',
                phoneNumber: '22',
            }
        });
    });

    afterAll(async () => {
        // Cleanup if needed
    });

    it('should maintain correct agent balance under concurrent deposit verifications', async () => {
        // 1. Setup initial balance of 2000
        const initialBalance = await agentReconciliationService.getOrCreateBalance(testAgent.id);
        await (prisma as any).agentBalance.update({
            where: { id: initialBalance.id },
            data: { currentBalance: 2000 }
        });

        // 2. Create 10 deposits of 100 each
        const depositIds: number[] = [];
        for (let i = 0; i < 10; i++) {
            const d = await agentReconciliationService.createDeposit(testAgent.id, 100, 'bank_transfer', `REF-CON-${i}`);
            depositIds.push(d.id);
        }

        // 3. Verify all deposits concurrently
        // Note: In a real scenario, different admins might verify them at the same time.
        const promises = depositIds.map(id =>
            agentReconciliationService.verifyDeposit(id, testUser.id)
        );

        await Promise.all(promises);

        // 4. Check final balance: 2000 - (10 * 100) = 1000
        const finalBalance = await agentReconciliationService.getAgentBalance(testAgent.id);
        expect(Number(finalBalance!.currentBalance)).toBe(1000);
        expect(Number(finalBalance!.totalDeposited)).toBe(1000);
    });
});
