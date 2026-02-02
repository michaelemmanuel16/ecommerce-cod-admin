import prisma from '../utils/prisma';

async function test() {
    try {
        console.log('Testing database connection...');
        const users = await prisma.user.findMany({ take: 1 });
        console.log('Connection successful, found users:', users.length);

        console.log('Testing deleteMany on accountTransaction...');
        await prisma.accountTransaction.deleteMany({});
        console.log('Delete successful');
    } catch (error) {
        console.error('Database operation failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

test();
