import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function rollback() {
  const todayStart = new Date('2026-02-13T00:00:00.000Z');
  console.log(`Finding bulk-imported orders created on or after ${todayStart.toISOString()}...`);

  // 1. Soft-delete today's bulk-imported orders only
  const deleted = await prisma.order.updateMany({
    where: {
      source: 'bulk_import',
      deletedAt: null,
      createdAt: { gte: todayStart },
    },
    data: { deletedAt: new Date() },
  });
  console.log(`Soft-deleted ${deleted.count} bulk-imported orders`);

  // 2. Find customers with NO remaining live orders (orphaned by the rollback)
  const orphanedCustomers = await prisma.customer.findMany({
    where: {
      orders: {
        none: { deletedAt: null },
      },
    },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true },
  });

  console.log(`Found ${orphanedCustomers.length} customers with no remaining orders`);
  if (orphanedCustomers.length > 0) {
    console.log('Customers to delete:');
    console.log(
      orphanedCustomers
        .map(c => `  ${c.id}: ${c.firstName} ${c.lastName} (${c.phoneNumber})`)
        .join('\n')
    );
  }

  // 3. Prompt confirmation before deleting customers
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise<void>(resolve => {
    readline.question('\nDelete these customers? (yes/no): ', async (answer: string) => {
      if (answer.toLowerCase() === 'yes') {
        const customerIds = orphanedCustomers.map(c => c.id);
        // Hard-delete their orders first (soft-deleted rows still block FK constraint)
        await prisma.order.deleteMany({
          where: { customerId: { in: customerIds } },
        });
        await prisma.customer.deleteMany({
          where: { id: { in: customerIds } },
        });
        console.log(`Deleted ${orphanedCustomers.length} customers`);
      } else {
        console.log('Skipped customer deletion');
      }
      readline.close();
      resolve();
    });
  });

  console.log('Rollback complete');
}

rollback()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
