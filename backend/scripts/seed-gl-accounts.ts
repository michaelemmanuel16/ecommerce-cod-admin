import { PrismaClient } from '@prisma/client';
import { DEFAULT_GL_ACCOUNTS } from '../src/config/glAccounts';
import { requireTenantIdEnv } from './lib/requireTenantIdEnv';

const prisma = new PrismaClient();

const TENANT_ID = requireTenantIdEnv();

async function main() {
    console.log('Seeding required GL accounts...');

    for (const account of DEFAULT_GL_ACCOUNTS) {
        const existing = await prisma.account.findUnique({
            where: { tenantId_code: { tenantId: TENANT_ID, code: account.code } },
        });

        if (!existing) {
            await prisma.account.create({
                data: {
                    tenantId: TENANT_ID,
                    code: account.code,
                    name: account.name,
                    accountType: account.accountType,
                    normalBalance: account.normalBalance,
                    description: `Automatically created during deployment: ${account.name}`,
                    isActive: true,
                },
            });
            console.log(`+ Created account: ${account.code} - ${account.name}`);
        } else {
            console.log(`- Account already exists: ${account.code} - ${account.name}`);
        }
    }

    console.log('GL account seeding completed.');
}

main()
    .catch((e) => {
        console.error('Error seeding GL accounts:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
