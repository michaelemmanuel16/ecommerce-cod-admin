import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkConfig() {
    try {
        const config = await (prisma as any).systemConfig.findFirst();
        console.log('--- System Config ---');
        if (config) {
            console.log('Key:', config.key);
            console.log('Permissions:', JSON.stringify(config.rolePermissions, null, 2));
        } else {
            console.log('No SystemConfig found in database.');
        }
    } catch (error) {
        console.error('Error fetching config:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkConfig();
