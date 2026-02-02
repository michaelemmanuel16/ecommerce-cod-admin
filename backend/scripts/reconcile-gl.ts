import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reconcileGL() {
    console.log('Starting General Ledger reconciliation...');

    try {
        const accounts = await prisma.account.findMany();

        for (const account of accounts) {
            console.log(`Processing account: ${account.code} - ${account.name}`);

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
                console.log(`  Mismatch found! GL: ${currentBalance}, Transactions: ${calculatedBalance}. Fixing...`);
                await prisma.account.update({
                    where: { id: account.id },
                    data: { currentBalance: calculatedBalance }
                });
            } else {
                console.log(`  Balance is correct: ${calculatedBalance}`);
            }
        }

        console.log('Reconciliation complete!');
    } catch (error) {
        console.error('Reconciliation failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

reconcileGL();
