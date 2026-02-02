const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function migrateVerifiedToReconciled() {
    console.log('Starting migration of verified collections to reconciled...');

    const verifiedCollections = await prisma.agentCollection.findMany({
        where: { status: 'verified' },
        include: { order: true }
    });

    console.log(`Found ${verifiedCollections.length} verified collections to migrate.`);

    for (const collection of verifiedCollections) {
        await prisma.$transaction(async (tx) => {
            console.log(`Processing collection ${collection.id} (Order #${collection.orderId})...`);

            // 1. Update collection status
            await tx.agentCollection.update({
                where: { id: collection.id },
                data: { status: 'reconciled' }
            });

            // 2. Update order payment status
            if (collection.orderId) {
                await tx.order.update({
                    where: { id: collection.orderId },
                    data: { paymentStatus: 'reconciled' }
                });
            }

            // 3. Decrement agent balance
            const balance = await tx.agentBalance.findUnique({
                where: { agentId: collection.agentId }
            });

            if (balance) {
                await tx.agentBalance.update({
                    where: { id: balance.id },
                    data: {
                        currentBalance: { decrement: collection.amount }
                    }
                });
                console.log(`  Decremented balance for agent ${collection.agentId} by ${collection.amount}`);
            } else {
                await tx.agentBalance.create({
                    data: {
                        agentId: collection.agentId,
                        currentBalance: -collection.amount,
                        amountCollected: collection.amount,
                        amountDer: 0
                    }
                });
                console.log(`  Created balance for agent ${collection.agentId} with -${collection.amount}`);
            }
        });
    }

    console.log('Migration complete.');
}

migrateVerifiedToReconciled()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
