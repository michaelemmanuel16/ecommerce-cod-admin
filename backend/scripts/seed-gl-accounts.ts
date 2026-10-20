import { PrismaClient } from '@prisma/client';
import { GL_ACCOUNTS } from '../src/config/glAccounts';

const prisma = new PrismaClient();

// Account codes and SKUs are unique per tenant: say which tenant to work on.
const TENANT_ID = process.env.TENANT_ID;
if (!TENANT_ID) {
  console.error('Set TENANT_ID to the tenant id, for example: TENANT_ID=<uuid> ...');
  process.exit(1);
}

async function main() {
    console.log('Seeding required GL accounts...');

    const accounts = [
        { code: GL_ACCOUNTS.CASH_IN_HAND, name: 'Cash in Hand', accountType: 'asset', normalBalance: 'debit' },
        { code: GL_ACCOUNTS.CASH_IN_TRANSIT, name: 'Cash in Transit', accountType: 'asset', normalBalance: 'debit' },
        { code: GL_ACCOUNTS.AR_AGENTS, name: 'Accounts Receivable - Agents', accountType: 'asset', normalBalance: 'debit' },
        { code: GL_ACCOUNTS.INVENTORY, name: 'Inventory', accountType: 'asset', normalBalance: 'debit' },
        { code: GL_ACCOUNTS.PRODUCT_REVENUE, name: 'Product Sales Revenue', accountType: 'revenue', normalBalance: 'credit' },
        { code: GL_ACCOUNTS.COGS, name: 'Cost of Goods Sold', accountType: 'expense', normalBalance: 'debit' },
        { code: GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE, name: 'Failed Delivery Expense', accountType: 'expense', normalBalance: 'debit' },
        { code: GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE, name: 'Return Processing Expense', accountType: 'expense', normalBalance: 'debit' },
        { code: GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION, name: 'Delivery Agent Commission', accountType: 'expense', normalBalance: 'debit' },
        { code: GL_ACCOUNTS.SALES_REP_COMMISSION, name: 'Sales Rep Commission', accountType: 'expense', normalBalance: 'debit' },
        { code: GL_ACCOUNTS.REFUND_LIABILITY, name: 'Refund Liability', accountType: 'liability', normalBalance: 'credit' },
    ] as const;

    for (const account of accounts) {
        const existing = await prisma.account.findUnique({
            where: { tenantId_code: { tenantId: TENANT_ID!, code: account.code } },
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
