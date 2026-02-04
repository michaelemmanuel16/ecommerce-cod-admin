import prisma from '../src/utils/prisma';

async function listUsers() {
    try {
        const users = await (prisma as any).user.findMany({
            select: { id: true, email: true, role: true }
        });
        console.log('--- Users ---');
        console.log(users);
    } catch (error) {
        console.error('Error listing users:', error);
    } finally {
        await prisma.$disconnect();
    }
}

listUsers();
