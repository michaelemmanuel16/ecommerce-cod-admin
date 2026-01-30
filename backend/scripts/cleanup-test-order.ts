import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupTestOrder() {
    const orderId = 3369; // The GHS 5000 test order identified
    console.log(`Starting cleanup for Test Order #${orderId}...`);

    try {
        // 1. Find related Journal Entries
        const journalEntries = await prisma.journalEntry.findMany({
            where: {
                OR: [
                    { description: { contains: `#${orderId}` } },
                    { sourceId: 75, sourceType: 'agent_collection' } // The collection ID identified earlier
                ]
            }
        });

        console.log(`Found ${journalEntries.length} related journal entries.`);

        // 2. Delete Account Transactions first (FK constraint)
        for (const je of journalEntries) {
            console.log(`  Deleting transactions for JE: ${je.entryNumber}`);
            await prisma.accountTransaction.deleteMany({
                where: { journalEntryId: je.id }
            });
        }

        // 3. Delete Journal Entries
        for (const je of journalEntries) {
            console.log(`  Deleting Journal Entry: ${je.entryNumber}`);
            await prisma.journalEntry.delete({
                where: { id: je.id }
            });
        }

        // 4. Delete Agent Collection
        const deletedCollection = await prisma.agentCollection.deleteMany({
            where: { orderId: orderId }
        });
        console.log(`Deleted ${deletedCollection.count} agent collections.`);

        // 5. Delete Delivery record (to satisfy FK constraint)
        const deletedDelivery = await prisma.delivery.deleteMany({
            where: { orderId: orderId }
        });
        console.log(`Deleted ${deletedDelivery.count} deliveries.`);

        // 6. Delete Operational Transaction
        const deletedTx = await prisma.transaction.deleteMany({
            where: { orderId: orderId }
        });
        console.log(`Deleted ${deletedTx.count} transactions.`);

        // 7. Hard delete the Order
        await prisma.order.delete({
            where: { id: orderId }
        });
        console.log(`Order #${orderId} hard-deleted.`);

        // 7. Reset Agent Balance for Agent 562
        const agentId = 562;
        await prisma.agentBalance.updateMany({
            where: { agentId: agentId },
            data: {
                currentBalance: 0,
                totalCollected: 0,
                totalDeposited: 0
            }
        });
        console.log(`Reset balance for Agent #${agentId}.`);

        console.log('Cleanup complete!');
    } catch (error) {
        console.error('Cleanup failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

cleanupTestOrder();
