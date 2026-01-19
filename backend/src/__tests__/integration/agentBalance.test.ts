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

    it('should initialize balance, approval update it, and verify deposit reduce it', async () => {
        // 1. Initial State: getOrCreateBalance should create record
        const initialBalance = await agentReconciliationService.getOrCreateBalance(testAgent.id);
        expect(initialBalance).not.toBeNull();
        expect(Number(initialBalance.currentBalance)).toBe(0);

        // 2. Mock a collection approval (using direct service call since approval logic is tested elsewhere)
        // For integration test, we simulate the effect of approveCollection by manually updating if needed or just calling it
        // Let's manually create a verified collection to approve
        const collection = await (prisma as any).agentCollection.create({
            data: {
                agentId: testAgent.id,
                amount: 1000,
                status: 'verified',
                orderId: testAgent.testOrderId,
                collectionDate: new Date(),
            }
        });

        await agentReconciliationService.approveCollection(collection.id, testUser.id);

        const afterApproveBalance = await agentReconciliationService.getAgentBalance(testAgent.id);
        expect(Number(afterApproveBalance!.currentBalance)).toBe(1000);
        expect(Number(afterApproveBalance!.totalCollected)).toBe(1000);

        // 3. Create Deposit
        const deposit = await agentReconciliationService.createDeposit(testAgent.id, 400, 'REF123', 'Test deposit');
        expect(deposit.status).toBe('pending');
        expect(Number(deposit.amount)).toBe(400);

        // 4. Verify Deposit
        await agentReconciliationService.verifyDeposit(deposit.id, testUser.id);

        const afterVerifyBalance = await agentReconciliationService.getAgentBalance(testAgent.id);
        expect(Number(afterVerifyBalance!.currentBalance)).toBe(600);
        expect(Number(afterVerifyBalance!.totalDeposited)).toBe(400);

        // Check GL Entry for deposit
        const glEntry = await prisma.journalEntry.findFirst({
            where: { sourceId: deposit.id, sourceType: 'agent_deposit' },
            include: { transactions: true }
        });
        expect(glEntry).not.toBeNull();
        expect(glEntry!.transactions).toHaveLength(2);
    });

    it('should not allow deposit verification that leads to negative balance', async () => {
        // Initialize balance with 500
        const collection = await (prisma as any).agentCollection.create({
            data: {
                agentId: testAgent.id,
                amount: 500,
                status: 'verified',
                orderId: testAgent.testOrderId,
                collectionDate: new Date(),
            }
        });
        await agentReconciliationService.approveCollection(collection.id, testUser.id);

        // Create deposit for 600
        const deposit = await agentReconciliationService.createDeposit(testAgent.id, 600);

        // Verify should fail
        await expect(agentReconciliationService.verifyDeposit(deposit.id, testUser.id))
            .rejects.toThrow(/Deposit amount exceeds current agent balance/);
    });
});
