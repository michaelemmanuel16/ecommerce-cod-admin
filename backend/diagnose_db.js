
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function diagnose() {
    try {
        console.log('--- Database Diagnostic Start ---');

        // 1. Check total order count
        const totalOrders = await prisma.order.count();
        console.log(`Total orders in DB: ${totalOrders}`);

        // 2. Check for soft-deleted orders
        const deletedOrders = await prisma.order.count({
            where: { deletedAt: { not: null } }
        });
        console.log(`Soft-deleted orders in DB: ${deletedOrders}`);

        // 3. Find the most recent orders
        const recentOrders = await prisma.order.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: { customer: true }
        });

        console.log('--- Most Recent Orders ---');
        recentOrders.forEach(o => {
            console.log(`ID: ${o.id}, Customer: ${o.customer.phoneNumber}, Amount: ${o.totalAmount}, CreatedAt: ${o.createdAt.toISOString()}, DeletedAt: ${o.deletedAt}`);
        });

        // 4. Test the exact duplicate query logic for one of the recent orders
        if (recentOrders.length > 0) {
            const target = recentOrders[0];
            const window = new Date(Date.now() - (24 * 60 * 60 * 1000));

            console.log(`--- Testing Duplicate Logic for ID ${target.id} ---`);
            console.log(`Amount: ${target.totalAmount}, Phone: ${target.customer.phoneNumber}, Window: ${window.toISOString()}`);

            const matches = await prisma.order.findMany({
                where: {
                    totalAmount: target.totalAmount,
                    createdAt: { gte: window },
                    deletedAt: null,
                    customer: {
                        phoneNumber: target.customer.phoneNumber
                    }
                }
            });

            console.log(`Strict match results: ${matches.length}`);

            const fuzzyMatches = await prisma.order.findMany({
                where: {
                    createdAt: { gte: window },
                    customer: {
                        phoneNumber: target.customer.phoneNumber
                    }
                }
            });
            console.log(`Fuzzy match (phone + window only): ${fuzzyMatches.length}`);
            if (fuzzyMatches.length > 0) {
                fuzzyMatches.forEach(m => {
                    console.log(`Fuzzy Match ID: ${m.id}, Amount: ${m.totalAmount}, Type: ${typeof m.totalAmount}`);
                });
            }
        }

    } catch (error) {
        console.error('Diagnostic error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

diagnose();
