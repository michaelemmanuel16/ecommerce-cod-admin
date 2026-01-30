import { PrismaClient } from '@prisma/client';
import { GLAutomationService } from '../src/services/glAutomationService';
import { SYSTEM_USER_ID } from '../src/config/constants';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Starting GL Synchronization ---');

    const unrecognizedOrders = await prisma.order.findMany({
        where: {
            status: 'delivered',
            revenueRecognized: false,
            deletedAt: null
        },
        include: {
            customer: true,
            deliveryAgent: true,
            customerRep: true,
            orderItems: {
                include: {
                    product: true
                }
            }
        }
    });

    console.log(`Found ${unrecognizedOrders.length} delivered orders to sync...`);

    let count = 0;
    for (const order of unrecognizedOrders) {
        try {
            await prisma.$transaction(async (tx) => {
                // Calculate total COGS
                const totalCOGS = GLAutomationService.calculateTotalCOGS(order.orderItems as any);

                // Create revenue recognition entry
                const glEntry = await GLAutomationService.createRevenueRecognitionEntry(
                    tx as any,
                    order as any,
                    totalCOGS,
                    SYSTEM_USER_ID
                );

                // Update order
                await tx.order.update({
                    where: { id: order.id },
                    data: {
                        revenueRecognized: true,
                        glJournalEntryId: glEntry.id
                    }
                });
            });
            count++;
            if (count % 10 === 0) console.log(`Synced ${count}/${unrecognizedOrders.length} orders...`);
        } catch (error: any) {
            console.error(`Failed to sync order ${order.id}:`, error.message);
        }
    }

    console.log(`\nSynchronization complete! Successfully synced ${count} orders.`);

    console.log('\n--- Updating Account Balances ---');
    const accounts = await prisma.account.findMany({
        include: { transactions: true }
    });

    for (const account of accounts) {
        const totalDebit = account.transactions.reduce((sum, t) => sum + Number(t.debitAmount), 0);
        const totalCredit = account.transactions.reduce((sum, t) => sum + Number(t.creditAmount), 0);
        const newBalance = account.normalBalance === 'debit' ? totalDebit - totalCredit : totalCredit - totalDebit;

        await prisma.account.update({
            where: { id: account.id },
            data: { currentBalance: newBalance }
        });
        console.log(`Updated [${account.code}] ${account.name} Balance to: ${newBalance}`);
    }

    console.log('\nAll balances updated.');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
