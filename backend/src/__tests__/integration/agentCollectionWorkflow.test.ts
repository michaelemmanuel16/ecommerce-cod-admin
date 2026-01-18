import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { DeliveryService } from '../../services/deliveryService';
import agentReconciliationService from '../../services/agentReconciliationService';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountType, NormalBalance, Prisma } from '@prisma/client';

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
        // Clean up
        await prisma.accountTransaction.deleteMany({});
        await prisma.journalEntry.deleteMany({});
        await prisma.transaction.deleteMany({});
        await (prisma as any).agentCollection.deleteMany({});
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
            { id: parseInt(GL_ACCOUNTS.CASH_IN_TRANSIT), code: GL_ACCOUNTS.CASH_IN_TRANSIT, name: 'Cash in Transit', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { id: parseInt(GL_ACCOUNTS.AR_AGENTS), code: GL_ACCOUNTS.AR_AGENTS, name: 'Agent AR', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { id: parseInt(GL_ACCOUNTS.PRODUCT_REVENUE), code: GL_ACCOUNTS.PRODUCT_REVENUE, name: 'Revenue', accountType: AccountType.revenue, normalBalance: NormalBalance.credit },
            { id: parseInt(GL_ACCOUNTS.COGS), code: GL_ACCOUNTS.COGS, name: 'COGS', accountType: AccountType.expense, normalBalance: NormalBalance.debit },
            { id: parseInt(GL_ACCOUNTS.INVENTORY), code: GL_ACCOUNTS.INVENTORY, name: 'Inventory', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
        ];
        for (const a of accounts) {
            await prisma.account.upsert({
                where: { id: a.id as number },
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
        // 1. Complete Delivery -> Should create Draft Collection
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
        expect(Number(draftCollection.amount)).toBe(5000);

        // 2. Verify Collection -> Should status 'verified' and create GL Entry
        await agentReconciliationService.verifyCollection(draftCollection.id, testUser.id);

        const verifiedColl = await (prisma as any).agentCollection.findUnique({
            where: { id: draftCollection.id }
        });
        expect(verifiedColl.status).toBe('verified');
        expect(verifiedColl.verifiedById).toBe(testUser.id);

        // Check GL Entry
        const glEntry = await prisma.journalEntry.findFirst({
            where: { sourceId: draftCollection.id, sourceType: 'agent_collection' },
            include: { transactions: true }
        });
        expect(glEntry).not.toBeNull();
        expect(glEntry!.transactions).toHaveLength(2);

        const arTrans = glEntry!.transactions.find(t => t.accountId === parseInt(GL_ACCOUNTS.AR_AGENTS));
        const citTrans = glEntry!.transactions.find(t => t.accountId === parseInt(GL_ACCOUNTS.CASH_IN_TRANSIT));

        expect(Number(arTrans!.debitAmount)).toBe(5000);
        expect(Number(citTrans!.creditAmount)).toBe(5000);

        // 3. Approve Collection -> Should status 'approved' and update agent balance
        await agentReconciliationService.approveCollection(verifiedColl.id, testUser.id);

        const approvedColl = await (prisma as any).agentCollection.findUnique({
            where: { id: draftCollection.id }
        });
        expect(approvedColl.status).toBe('approved');

        const updatedAgent = await prisma.user.findUnique({
            where: { id: testAgent.id }
        });
        expect(Number(updatedAgent!.totalCollected)).toBe(5000);
    });
});
