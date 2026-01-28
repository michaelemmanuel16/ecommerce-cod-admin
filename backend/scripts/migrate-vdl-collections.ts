import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function migrateVDLCollections() {
    console.log('Starting VDL Collection migration...');

    try {
        // 1. Find VDL Agent (firstName: "VDL", lastName: "Fulfilment")
        const vdlAgent = await prisma.user.findFirst({
            where: {
                firstName: 'VDL',
                lastName: 'Fulfilment',
                role: 'delivery_agent'
            }
        });

        if (!vdlAgent) {
            console.error('VDL Fulfilment agent not found!');
            return;
        }

        console.log(`Found VDL Agent: ID ${vdlAgent.id}`);

        // 2. Find all delivered orders for VDL
        const orders = await prisma.order.findMany({
            where: {
                deliveryAgentId: vdlAgent.id,
                status: 'delivered'
            }
        });

        console.log(`Found ${orders.length} delivered orders for VDL.`);

        let createdCount = 0;

        // 3. Create missing AgentCollection records
        for (const order of orders) {
            const existingCollection = await prisma.agentCollection.findUnique({
                where: { orderId: order.id }
            });

            if (!existingCollection) {
                const amount = order.codAmount || order.totalAmount;
                await prisma.agentCollection.create({
                    data: {
                        orderId: order.id,
                        agentId: vdlAgent.id,
                        amount: amount,
                        status: 'draft',
                        collectionDate: order.updatedAt || new Date(),
                    }
                });
                createdCount++;
            }
        }

        console.log(`Created ${createdCount} missing collection records.`);

        // 4. Correct Agent Balance based on actual collection records
        const allAgentCollections = await prisma.agentCollection.findMany({
            where: { agentId: vdlAgent.id }
        });

        const totalHoldingAmount = allAgentCollections.reduce((sum, coll) => sum + Number(coll.amount), 0);

        await prisma.agentBalance.upsert({
            where: { agentId: vdlAgent.id },
            update: {
                totalCollected: totalHoldingAmount,
                currentBalance: totalHoldingAmount
            },
            create: {
                agentId: vdlAgent.id,
                totalCollected: totalHoldingAmount,
                currentBalance: totalHoldingAmount,
                totalDeposited: 0
            }
        });

        console.log(`Updated AgentBalance for VDL. Total holdings: ${totalHoldingAmount}`);
        console.log('Migration complete!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

migrateVDLCollections();
