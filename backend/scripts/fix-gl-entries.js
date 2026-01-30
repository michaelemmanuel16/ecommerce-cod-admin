const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GL Account Codes
const AR_AGENTS_CODE = '1020';
const CASH_IN_HAND_CODE = '1010';

async function fixGLEntries() {
    console.log('Starting GL Entry Fix...');

    // 1. Get Account IDs
    const arAgentsAccount = await prisma.account.findUnique({ where: { code: AR_AGENTS_CODE } });
    const cashInHandAccount = await prisma.account.findUnique({ where: { code: CASH_IN_HAND_CODE } });

    if (!arAgentsAccount || !cashInHandAccount) {
        console.error('Could not find GL Accounts.');
        process.exit(1);
    }

    // 2. Find all Journal Entries for agent collections
    // Source type is 'agent_collection'
    const entries = await prisma.journalEntry.findMany({
        where: {
            sourceType: 'agent_collection'
        },
        include: {
            transactions: true
        }
    });

    console.log(`Found ${entries.length} agent collection entries.`);

    let updatedCount = 0;

    for (const entry of entries) {
        // Find the transaction that Debits AR Agents
        const arTxn = entry.transactions.find(t =>
            t.accountId === arAgentsAccount.id && Number(t.debitAmount) > 0
        );

        if (arTxn) {
            console.log(`Fixing Entry #${entry.entryNumber} (Txn #${arTxn.id}): Changing Account 1020 -> 1010`);

            await prisma.accountTransaction.update({
                where: { id: arTxn.id },
                data: { accountId: cashInHandAccount.id }
            });
            updatedCount++;
        }
    }

    console.log(`Fixed ${updatedCount} transactions.`);

    // 3. Reconcile Balances (Logic from reconcile-gl.ts integrated here for convenience)
    console.log('Recalculating Account Balances...');
    const accounts = await prisma.account.findMany();

    for (const account of accounts) {
        const sums = await prisma.accountTransaction.aggregate({
            where: { accountId: account.id },
            _sum: {
                debitAmount: true,
                creditAmount: true
            }
        });

        const totalDebits = Number(sums._sum.debitAmount || 0);
        const totalCredits = Number(sums._sum.creditAmount || 0);

        let calculatedBalance = 0;
        if (account.normalBalance === 'debit') {
            calculatedBalance = totalDebits - totalCredits;
        } else {
            calculatedBalance = totalCredits - totalDebits;
        }

        const currentBalance = Number(account.currentBalance);

        if (Math.abs(currentBalance - calculatedBalance) > 0.01) {
            console.log(`  Updating ${account.code}: ${currentBalance.toFixed(2)} -> ${calculatedBalance.toFixed(2)}`);
            await prisma.account.update({
                where: { id: account.id },
                data: { currentBalance: calculatedBalance }
            });
        }
    }

    console.log('GL Account Balances Updated.');
}

fixGLEntries()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
