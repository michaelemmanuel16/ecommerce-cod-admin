import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateDeliveryDates() {
  console.log('🔄 Updating delivery dates for imported delivered orders...\n');

  // Find all delivered orders with null deliveryDate
  const ordersToUpdate = await prisma.order.findMany({
    where: {
      status: 'delivered',
      deliveryDate: null,
      deletedAt: null,
      source: 'bulk_import'
    },
    select: {
      id: true,
      createdAt: true,
    }
  });

  console.log(`Found ${ordersToUpdate.length} orders to update\n`);

  if (ordersToUpdate.length === 0) {
    console.log('✅ No orders need updating.');
    return;
  }

  // Update each order: set deliveryDate = createdAt
  for (const order of ordersToUpdate) {
    await prisma.order.update({
      where: { id: order.id },
      data: { deliveryDate: order.createdAt }
    });
    console.log(`  ✅ Updated Order ${order.id}: deliveryDate = ${order.createdAt.toISOString()}`);
  }

  console.log(`\n✅ Successfully updated ${ordersToUpdate.length} orders!\n`);
}

updateDeliveryDates()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
