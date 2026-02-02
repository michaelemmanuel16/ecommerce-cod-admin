import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('--- Database Inspection ---');

    const accounts = await prisma.account.findMany();
    console.log(`\nFound ${accounts.length} accounts:`);
    accounts.forEach(a => console.log(`- [${a.code}] ${a.name} (${a.accountType}) Balance: ${a.currentBalance}`));

    const journalEntries = await prisma.journalEntry.count();
    console.log(`\nTotal Journal Entries: ${journalEntries}`);

    const deliveredOrders = await prisma.order.count({ where: { status: 'delivered' } });
    console.log(`\nDelivered Orders: ${deliveredOrders}`);

    const unrecognizedOrders = await prisma.order.count({
        where: {
            status: 'delivered',
            revenueRecognized: false
        }
    });
    console.log(`Delivered orders NOT yet recognized in GL: ${unrecognizedOrders}`);

    const transactions = await prisma.transaction.count();
    console.log(`\nTotal Transactions: ${transactions}`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
