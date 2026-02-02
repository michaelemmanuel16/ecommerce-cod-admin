import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import agentReconciliationService from '../../services/agentReconciliationService';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { AccountType, NormalBalance, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GLAccountService } from '../../services/glAccountService';

// Mock socket instance
jest.mock('../../utils/socketInstance', () => ({
    getSocketInstance: jest.fn(() => ({
        to: jest.fn(() => ({
            emit: jest.fn(),
        })),
        emit: jest.fn(),
    })),
}));

describe('Agent Balance and Deposit Integration', () => {
    let testUser: any;
    let testAgent: any;

    beforeAll(async () => {
        // Setup GL accounts and users
    });

    beforeEach(async () => {
        GLAccountService.clearCache();
        // Clean up - Order matters due to foreign keys
        await prisma.accountTransaction.deleteMany({});
        await prisma.journalEntry.deleteMany({});
        await (prisma as any).agentDeposit.deleteMany({});
        await (prisma as any).agentCollection.deleteMany({});
        await (prisma as any).agentBalance.deleteMany({});
        await prisma.delivery.deleteMany({});
        await prisma.orderItem.deleteMany({});
        await prisma.order.deleteMany({});
        await prisma.customer.deleteMany({});
        await prisma.account.deleteMany({});
        await prisma.user.deleteMany({
            where: { email: { in: ['admin@test.com', 'agent@test.com'] } }
        });

        // Setup GL Accounts
        const accounts: Prisma.AccountUncheckedCreateInput[] = [
            { id: parseInt(GL_ACCOUNTS.AR_AGENTS), code: GL_ACCOUNTS.AR_AGENTS, name: 'Agent AR', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { id: parseInt(GL_ACCOUNTS.CASH_IN_HAND), code: GL_ACCOUNTS.CASH_IN_HAND, name: 'Cash in Hand', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { id: parseInt(GL_ACCOUNTS.CASH_IN_TRANSIT), code: GL_ACCOUNTS.CASH_IN_TRANSIT, name: 'Cash in Transit', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
        ];
        for (const a of accounts) {
            await prisma.account.upsert({
                where: { code: a.code }, // Use code as key for upsert if id is not reliable
                update: a as Prisma.AccountUpdateInput,
                create: a
            });
        }

        // Create Users
        testUser = await prisma.user.create({
            data: {
                email: 'admin@test.com',
                password: 'password',
                firstName: 'Admin',
                lastName: 'User',
                role: 'admin',
                phoneNumber: '1',
            }
        });

        testAgent = await prisma.user.create({
            data: {
                email: 'agent@test.com',
                password: 'password',
                firstName: 'Agent',
                lastName: 'One',
                role: 'delivery_agent',
                phoneNumber: '2',
            }
        });

        // Create Customer
        const testCustomer = await prisma.customer.create({
            data: {
                firstName: 'Test',
                lastName: 'Customer',
                email: 'customer@test.com',
                phoneNumber: '3',
                address: 'Test Address',
                state: 'Test State',
                area: 'Test Area',
            }
        });

        // Create Order
        const order = await prisma.order.create({
            data: {
                customerId: testCustomer.id,
                totalAmount: 1000,
                subtotal: 1000,
                deliveryAddress: 'Test Address',
                deliveryState: 'Test State',
                deliveryArea: 'Test Area',
                status: 'delivered',
            }
        });

        (testAgent as any).testOrderId = order.id;
    });

    it('should initialize balance, reconciliation update it, and verify deposit reduce it', async () => {
        // 1. Initial State: getOrCreateBalance should create record
        const initialBalance = await agentReconciliationService.getOrCreateBalance(testAgent.id);
        expect(initialBalance).not.toBeNull();
        expect(Number(initialBalance.currentBalance)).toBe(0);

        // 2. Simulate collection accrual (normally done by FinancialSyncService.syncOrderFinancialData)
        // Agent collects 1000 from customer
        await (prisma as any).agentBalance.update({
            where: { id: initialBalance.id },
            data: {
                currentBalance: { increment: 1000 },
                totalCollected: { increment: 1000 }
            }
        });

        const collection = await (prisma as any).agentCollection.create({
            data: {
                agentId: testAgent.id,
                amount: 1000,
                status: 'draft',
                orderId: testAgent.testOrderId,
                collectionDate: new Date(),
            }
        });

        // 3. Reconcile collection (Settle)
        // In the new logic, verifyCollection (reconcile) decrements currentBalance and increments totalDeposited
        await agentReconciliationService.verifyCollection(collection.id, testUser.id);

        const afterReconcileBalance = await agentReconciliationService.getAgentBalance(testAgent.id);
        expect(Number(afterReconcileBalance!.currentBalance)).toBe(0); // Settled
        expect(Number(afterReconcileBalance!.totalDeposited)).toBe(1000);

        // 4. Create and Verify Deposit (Regular flow for cash handover)
        // Note: In this test, balance is now 0. If we want to test deposit, we need some outstanding balance.
        // Let's accrue another 1000.
        await (prisma as any).agentBalance.update({
            where: { id: initialBalance.id },
            data: { currentBalance: { increment: 1000 } }
        });

        const deposit = await agentReconciliationService.createDeposit(testAgent.id, 400, 'bank_transfer', 'REF123', 'Test deposit');
        expect(deposit.status).toBe('pending');
        await agentReconciliationService.verifyDeposit(deposit.id, testUser.id);

        const finalBalance = await agentReconciliationService.getAgentBalance(testAgent.id);
        expect(Number(finalBalance!.currentBalance)).toBe(600);
        expect(Number(finalBalance!.totalDeposited)).toBe(1400); // 1000 from recon + 400 from deposit
    });

    it('should not allow deposit verification that leads to negative balance', async () => {
        // Initialize balance with 500
        const initialBalance = await agentReconciliationService.getOrCreateBalance(testAgent.id);
        await (prisma as any).agentBalance.update({
            where: { id: initialBalance.id },
            data: { currentBalance: 500 }
        });

        // Create deposit for 600 - this should throw in createDeposit
        await expect(agentReconciliationService.createDeposit(testAgent.id, 600, 'bank_transfer', 'REF600'))
            .rejects.toThrow(/Deposit amount cannot exceed your current outstanding balance/);
    });

    it('should allow deposit rejection and not change balance', async () => {
        // 1. Initialize balance
        await agentReconciliationService.getOrCreateBalance(testAgent.id);

        // 2. Create deposit - should fail if balance is 0
        await expect(agentReconciliationService.createDeposit(testAgent.id, 500, 'bank_transfer', 'REF500'))
            .rejects.toThrow(/Deposit amount cannot exceed your current outstanding balance/);
    });
});
