const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixVdlAndReconcile() {
    console.log('🚀 Starting VDL and Reconciliation Fix...');

    try {
        const vdlAgent = await prisma.user.findFirst({
            where: { firstName: 'VDL' }
        });

        if (!vdlAgent) {
            console.log('❌ VDL Agent not found.');
            return;
        }

        console.log(`👤 Found VDL Agent (ID: ${vdlAgent.id})`);

        // 1. Update Order Payment Status to 'collected' for all Delivered VDL orders
        const updatedOrders = await prisma.order.updateMany({
            where: {
                deliveryAgentId: vdlAgent.id,
                status: 'delivered',
                paymentStatus: 'pending'
            },
            data: {
                paymentStatus: 'collected'
            }
        });

        console.log(`✅ Updated ${updatedOrders.count} orders to paymentStatus: 'collected'`);

        // 2. Ensure all VDL AgentCollections are in 'draft' status (so they show up in the new modal)
        const updatedCollections = await prisma.agentCollection.updateMany({
            where: {
                agentId: vdlAgent.id,
                status: { not: 'draft' } // In case any were set to verified/approved during testing
            },
            data: {
                status: 'draft'
            }
        });

        console.log(`✅ Reset ${updatedCollections.count} collection records to 'draft' status`);

        // 3. Recalculate AgentBalance
        // Total Draft + Verified + Approved = currentBalance
        const collections = await (prisma as any).agentCollection.findMany({
            where: { agentId: vdlAgent.id }
        });

        const totalCollected = collections.reduce((acc: number, curr: any) => acc + Number(curr.amount), 0);
        const balance = collections
            .filter((c: any) => ['draft', 'verified', 'approved'].includes(c.status))
            .reduce((acc: number, curr: any) => acc + Number(curr.amount), 0);

        const updatedBalance = await prisma.agentBalance.upsert({
            where: { agentId: vdlAgent.id },
            update: {
                currentBalance: balance,
                totalCollected: totalCollected,
                updatedAt: new Date()
            },
            create: {
                agentId: vdlAgent.id,
                currentBalance: balance,
                totalCollected: totalCollected,
                totalDeposited: 0
            }
        });

        console.log(`✅ Updated AgentBalance: Total Collected: ${updatedBalance.totalCollected}, Current Balance: ${updatedBalance.currentBalance}`);

        console.log('🎉 Fix completed successfully!');
    } catch (error) {
        console.error('❌ Error during fix:', error);
    } finally {
        await prisma.$disconnect();
    }
}

fixVdlAndReconcile();
