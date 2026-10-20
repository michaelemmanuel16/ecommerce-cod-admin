import { PrismaClient } from '@prisma/client';

// Read-only. Lists users with tenant_id NULL (M0-T08 / COD-3).
// A platform admin is expected to have no tenant. Any other row needs a decision.
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { tenantId: null },
    select: { id: true, email: true, role: true, isPlatformAdmin: true },
    orderBy: { id: 'asc' },
  });
  console.log(`Users with tenant_id NULL: ${users.length}`);
  console.table(users);
}

main()
  .catch((err) => {
    console.error('Report failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
