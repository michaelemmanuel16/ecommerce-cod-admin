
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkDataConsistency() {
    const agentId = 4; // VDL

    // 1. Agent Balance table
    const balance = await prisma.agentBalance.findUnique({
        where: { agentId }
    });

    // 2. Collections table (unreconciled)
    const pendingCollections = await prisma.agentCollection.aggregate({
        where: {
            agentId,
            status: { in: ['draft', 'verified'] }
        },
        _sum: { amount: true }
    });

    // 3. Aging table
    const aging = await prisma.agentAgingBucket.findUnique({
        where: { agentId }
    });

    // 4. GL Accounts
    const glCashInHand = await prisma.gLAccount.findFirst({ where: { code: '1010' } });
    const glCashInTransit = await prisma.gLAccount.findFirst({ where: { code: '1015' } });

    console.log('--- Agent: VDL Fulfillment ---');
    console.log(`Current Balance (agent_balances): GHS ${balance?.currentBalance}`);
    console.log(`Pending Collections (agent_collections): GHS ${pendingCollections._sum.amount}`);
    console.log(`Aging Total (agent_aging_buckets): GHS ${aging?.totalBalance}`);

    const balanceMatch = Number(balance?.currentBalance) === Number(pendingCollections._sum.amount);
    const agingMatch = Number(balance?.currentBalance) === Number(aging?.totalBalance);

    console.log(`Consistency (Collections vs Balance): ${balanceMatch ? '✅ MATCH' : '❌ MISMATCH'}`);
    console.log(`Consistency (Aging vs Balance): ${agingMatch ? '✅ MATCH' : '❌ MISMATCH'}`);

    console.log('\n--- General Ledger ---');
    // GL Cash in Hand should match all reconciled collections
    const totalReconciled = await prisma.agentCollection.aggregate({
        where: { status: 'reconciled' },
        _sum: { amount: true }
    });
    console.log(`Total Reconciled Collections: GHS ${totalReconciled._sum.amount}`);
    console.log(`GL Cash in Hand: GHS ${glCashInHand?.balance}`);

    // GL Cash in Transit should match all pending collections
    const totalPending = await prisma.agentCollection.aggregate({
        where: { status: { in: ['draft', 'verified'] } },
        _sum: { amount: true }
    });
    console.log(`Total Pending Collections (All Agents): GHS ${totalPending._sum.amount}`);
    console.log(`GL Cash in Transit: GHS ${glCashInTransit?.balance}`);

    const glTransitMatch = Number(totalPending._sum.amount) === Number(glCashInTransit?.balance);
    console.log(`Consistency (GL Transit): ${glTransitMatch ? '✅ MATCH' : '❌ MISMATCH'}`);
}

checkDataConsistency().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
