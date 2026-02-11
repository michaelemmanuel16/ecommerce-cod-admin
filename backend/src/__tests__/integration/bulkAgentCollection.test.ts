import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
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

describe('Bulk Agent Collection Reconciliation Integration', () => {
    let testUser: any;
    let testAgent: any;
    let testOrders: any[] = [];
    let draftCollections: any[] = [];

    beforeAll(async () => {
        // Ensure necessary GL accounts exist
        const accounts: Prisma.AccountUncheckedCreateInput[] = [
            { code: '1015', name: 'Cash in Transit', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { code: '1020', name: 'Agent AR', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
            { code: '1010', name: 'Cash in Hand', accountType: AccountType.asset, normalBalance: NormalBalance.debit },
        ];
        for (const a of accounts) {
            await prisma.account.upsert({
                where: { code: a.code },
                update: a as Prisma.AccountUpdateInput,
                create: a
            });
        }
    });

    beforeEach(async () => {
        GLAccountService.clearCache();
        // Clean up
        await (prisma as any).agentCollection.deleteMany({});
        await (prisma as any).agentBalance.deleteMany({});
        await prisma.delivery.deleteMany({});
        await prisma.orderItem.deleteMany({});
        await prisma.order.deleteMany({});
        await prisma.customer.deleteMany({});
        await prisma.accountTransaction.deleteMany({});
        await prisma.journalEntry.deleteMany({});
        await prisma.user.deleteMany({
            where: { email: { in: ['admin-bulk@test.com', 'agent-bulk@test.com'] } }
        });

        // Create Users
        testUser = await prisma.user.create({
            data: {
                email: 'admin-bulk@test.com',
                password: 'password',
                firstName: 'Admin',
                lastName: 'User',
                role: 'admin',
                phoneNumber: '11',
            }
        });

        testAgent = await prisma.user.create({
            data: {
                email: 'agent-bulk@test.com',
                password: 'password',
                firstName: 'Agent',
                lastName: 'Bulk',
                role: 'delivery_agent',
                phoneNumber: '22',
                totalCollected: new Decimal(0),
            }
        });

        // Create Customer
        const testCustomer = await prisma.customer.create({
            data: {
                firstName: 'Test',
                lastName: 'Customer',
                phoneNumber: '33',
                address: 'Test Address',
                state: 'Test State',
                area: 'Test Area',
            }
        });

        // Create 3 Orders and Collections
        testOrders = [];
        draftCollections = [];
        for (let i = 0; i < 3; i++) {
            const order = await prisma.order.create({
                data: {
                    status: 'delivered',
                    codAmount: 1000 * (i + 1),
                    subtotal: 1000 * (i + 1),
                    totalAmount: 1000 * (i + 1),
                    paymentStatus: 'pending',
                    deliveryAgentId: testAgent.id,
                    customerId: testCustomer.id,
                    deliveryAddress: 'Test Address',
                    deliveryState: 'Test State',
                    deliveryArea: 'Test Area',
                    externalOrderId: `EXT-${Date.now()}-${i}`
                }
            });
            testOrders.push(order);

            const collection = await (prisma as any).agentCollection.create({
                data: {
                    orderId: order.id,
                    agentId: testAgent.id,
                    amount: new Decimal(1000 * (i + 1)),
                    status: 'draft',
                    collectionDate: new Date()
                }
            });
            draftCollections.push(collection);
        }
    });

    it('should verify multiple collections in bulk', async () => {
        const ids = draftCollections.map(c => c.id);

        // Execute bulk verification
        const results = await agentReconciliationService.bulkVerifyCollections(ids, testUser.id);

        expect(results).toHaveLength(3);

        // Verify collections are updated
        const updatedCollections = await (prisma as any).agentCollection.findMany({
            where: { id: { in: ids } }
        });
        expect(updatedCollections).toHaveLength(3);
        updatedCollections.forEach((c: any) => {
            expect(c.status).toBe('reconciled');
            expect(c.verifiedById).toBe(testUser.id);
        });

        // Verify orders are updated
        const updatedOrders = await prisma.order.findMany({
            where: { id: { in: testOrders.map(o => o.id) } }
        });
        expect(updatedOrders).toHaveLength(3);
        updatedOrders.forEach((o: any) => {
            expect(o.paymentStatus).toBe('reconciled');
        });

        // Verify GL Entries created
        const glEntries = await prisma.journalEntry.findMany({
            where: {
                sourceId: { in: ids },
                sourceType: 'agent_collection'
            }
        });
        expect(glEntries).toHaveLength(3);
    });

    it('should roll back all if one verification fails (atomic transaction)', async () => {
        const ids = [draftCollections[0].id, 99999]; // One valid, one invalid

        await expect(agentReconciliationService.bulkVerifyCollections(ids, testUser.id))
            .rejects.toThrow();

        // Verify first collection remained 'draft' due to rollback
        const firstColl = await (prisma as any).agentCollection.findUnique({
            where: { id: draftCollections[0].id }
        });
        expect(firstColl.status).toBe('draft');

        // Verify order also remained 'pending'
        const firstOrder = await prisma.order.findUnique({
            where: { id: testOrders[0].id }
        });
        expect(firstOrder.paymentStatus).toBe('pending');
    });
});
