import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('--- Deep Database Inspection ---');

    const transactionsCount = await prisma.accountTransaction.count();
    console.log(`\nTotal Account Transactions: ${transactionsCount}`);

    if (transactionsCount > 0) {
        const firstTrans = await prisma.accountTransaction.findFirst({
            include: { account: true }
        });
        console.log(`Sample Transaction: ${firstTrans?.debitAmount} DR / ${firstTrans?.creditAmount} CR for account ${firstTrans?.account.name}`);
    }

    const accounts = await prisma.account.findMany({
        include: {
            transactions: true
        }
    });

    console.log(`\nAccount Status:`);
    accounts.forEach(a => {
        const totalDebit = a.transactions.reduce((sum, t) => sum + Number(t.debitAmount), 0);
        const totalCredit = a.transactions.reduce((sum, t) => sum + Number(t.creditAmount), 0);
        const calcBalance = a.normalBalance === 'debit' ? totalDebit - totalCredit : totalCredit - totalDebit;

        console.log(`- [${a.code}] ${a.name}: DB Balance: ${a.currentBalance}, Calc Balance: ${calcBalance} (${a.transactions.length} trans)`);
    });
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
