import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkData() {
    const jan1 = new Date('2026-01-01');
    const jan25 = new Date('2026-01-25T23:59:59');

    console.log('--- Financial Data Check (Jan 1 - Jan 25, 2026) ---');

    const deliveredCount = await prisma.order.count({
        where: {
            status: 'delivered',
            createdAt: { gte: jan1, lte: jan25 },
            deletedAt: null
        }
    });

    const deliveredSum = await prisma.order.aggregate({
        where: {
            status: 'delivered',
            createdAt: { gte: jan1, lte: jan25 },
            deletedAt: null
        },
        _sum: { totalAmount: true }
    });

    console.log(`Delivered Orders: ${deliveredCount}`);
    console.log(`Total Revenue: ${deliveredSum._sum.totalAmount || 0}`);

    const outForDeliveryCount = await prisma.order.count({
        where: {
            status: 'out_for_delivery',
            createdAt: { gte: jan1, lte: jan25 },
            deletedAt: null
        }
    });

    const outForDeliverySum = await prisma.order.aggregate({
        where: {
            status: 'out_for_delivery',
            createdAt: { gte: jan1, lte: jan25 },
            deletedAt: null
        },
        _sum: { totalAmount: true }
    });

    console.log(`Out for Delivery: ${outForDeliveryCount}`);
    console.log(`Expected Revenue: ${outForDeliverySum._sum.totalAmount || 0}`);

    const collections = await prisma.transaction.aggregate({
        where: {
            type: 'cod_collection',
            status: { in: ['collected', 'deposited', 'reconciled'] },
            createdAt: { gte: jan1, lte: jan25 }
        },
        _sum: { amount: true }
    });

    console.log(`COD Collected: ${collections._sum.amount || 0}`);

    const expenses = await prisma.expense.aggregate({
        where: {
            expenseDate: { gte: jan1, lte: jan25 }
        },
        _sum: { amount: true }
    });

    console.log(`Total Expenses: ${expenses._sum.amount || 0}`);

    // Check sample imported orders
    const importedSample = await prisma.order.findMany({
        where: { source: 'bulk_import' },
        take: 5,
        select: { id: true, status: true, totalAmount: true, createdAt: true }
    });

    console.log('\nSample Imported Orders:');
    importedSample.forEach(o => {
        console.log(`ID: ${o.id}, Status: ${o.status}, Amount: ${o.totalAmount}, Created: ${o.createdAt.toISOString()}`);
    });
}

checkData()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
