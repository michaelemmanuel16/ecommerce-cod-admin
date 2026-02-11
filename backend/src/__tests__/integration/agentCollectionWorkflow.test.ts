import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { DeliveryService } from '../../services/deliveryService';
import agentReconciliationService from '../../services/agentReconciliationService';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountType, NormalBalance, Prisma } from '@prisma/client';
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

describe('Agent Collection Workflow Integration', () => {
    let testUser: any;
    let testAgent: any;
    let testOrder: any;
    let testDelivery: any;
    let deliveryService: DeliveryService;

    beforeAll(async () => {
        deliveryService = new DeliveryService();
    });

    beforeEach(async () => {
        GLAccountService.clearCache();
        // Clean up - Order matters due to foreign keys
        await (prisma as any).agentDeposit.deleteMany({});
        await (prisma as any).agentCollection.deleteMany({});
        await (prisma as any).agentBalance.deleteMany({});
        await prisma.delivery.deleteMany({});
        await prisma.orderItem.deleteMany({});
        await prisma.order.deleteMany({});
        await prisma.customer.deleteMany({});
        await prisma.accountTransaction.deleteMany({});
        await prisma.journalEntry.deleteMany({});
        await prisma.transaction.deleteMany({});
        await prisma.account.deleteMany({});
        await prisma.user.deleteMany({
            where: { email: { in: ['admin@test.com', 'agent@test.com'] } }
        });

        // Setup GL Accounts
        const accounts: Prisma.AccountUncheckedCreateInput[] = [
            { code: '1015', name: 'Cash in Transit', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { code: '1020', name: 'Agent AR', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { code: '4010', name: 'Revenue', accountType: AccountType.revenue, normalBalance: NormalBalance.credit },
            { code: '5010', name: 'COGS', accountType: AccountType.expense, normalBalance: NormalBalance.debit },
            { code: '1200', name: 'Inventory', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { code: '1010', name: 'Cash in Hand', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
        ];
        for (const a of accounts) {
            await prisma.account.upsert({
                where: { code: a.code },
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
                totalCollected: new Decimal(0),
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

        // Create Order and Delivery
        testOrder = await prisma.order.create({
            data: {
                status: 'out_for_delivery',
                codAmount: 5000,
                subtotal: 5000,
                totalAmount: 5000,
                paymentStatus: 'pending',
                deliveryAgentId: testAgent.id,
                customerId: testCustomer.id,
                deliveryAddress: 'Test Delivery Address',
                deliveryState: 'Test Delivery State',
                deliveryArea: 'Test Delivery Area',
            }
        });

        testDelivery = await prisma.delivery.create({
            data: {
                orderId: testOrder.id,
                agentId: testAgent.id,
            }
        });
    });

    it('should complete full collection workflow', async () => {
        // 1. Complete Delivery -> Should create Draft Collection (Net of Commission)
        // Order is 5000. For the test, we didn't specify commission, so let's assume 0 for now
        // to keep it simple, or mock it if needed.
        await deliveryService.completeDelivery(testDelivery.id.toString(), {
            recipientName: 'Test Recipient',
            proofType: 'signature',
            codAmount: 5000
        }, testUser.id.toString());

        const draftCollection = await (prisma as any).agentCollection.findFirst({
            where: { orderId: testOrder.id }
        });

        expect(draftCollection).not.toBeNull();
        expect(draftCollection.status).toBe('draft');

        // In the new logic, syncOrderFinancialData calculates netAmount = gross - agentComm
        // Since testAgent.commissionAmount is not set in beforeEach, netAmount = 5000
        expect(Number(draftCollection.amount)).toBe(5000);

        // 2. Reconcile (Verify) Collection -> Should move directly to 'reconciled' and create GL Entry
        await agentReconciliationService.verifyCollection(draftCollection.id, testUser.id);

        const reconciledColl = await (prisma as any).agentCollection.findUnique({
            where: { id: draftCollection.id }
        });
        expect(reconciledColl.status).toBe('reconciled');
        expect(reconciledColl.verifiedById).toBe(testUser.id);

        // Check GL Entry
        const glEntry = await prisma.journalEntry.findFirst({
            where: { sourceId: draftCollection.id, sourceType: 'agent_collection' },
            include: { transactions: true }
        });
        expect(glEntry).not.toBeNull();
        expect(glEntry!.transactions).toHaveLength(2);

        const cihAccount = await prisma.account.findUnique({ where: { code: '1010' } });
        const citAccount = await prisma.account.findUnique({ where: { code: '1015' } });

        const cihTrans = glEntry!.transactions.find(t => t.accountId === cihAccount!.id);
        const citTrans = glEntry!.transactions.find(t => t.accountId === citAccount!.id);

        expect(Number(cihTrans!.debitAmount)).toBe(5000);
        expect(Number(citTrans!.creditAmount)).toBe(5000);

        // 3. Agent Balance would be updated in real flow via FinancialSyncService
        // For this test, we're only verifying the collection workflow itself
        // Balance updates are tested separately in agentBalance.test.ts
    });
});
