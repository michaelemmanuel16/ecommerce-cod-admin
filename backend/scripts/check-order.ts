import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkOrder() {
    try {
        const order = await prisma.order.findUnique({
            where: { id: 4947 },
            select: { id: true, customerRepId: true, deliveryAgentId: true, status: true }
        });
        console.log('--- Order 4947 ---');
        console.log(order);
    } catch (error) {
        console.error('Error fetching order:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkOrder();
