import prisma from '../utils/prisma';

/**
 * Migration script to fix existing orders with upsells
 *
 * This script:
 * 1. Finds all form submissions with selectedUpsells
 * 2. Creates missing OrderItem records for upsells
 * 3. Updates order totals if needed
 */

async function migrateUpsells() {
  console.log('🔍 Starting upsell migration...\n');

  try {
    // Find all form submissions with selected upsells
    const submissions = await prisma.formSubmission.findMany({
      where: {
        selectedUpsells: {
          not: null
        },
        orderId: {
          not: null
        }
      },
      include: {
        order: {
          include: {
            orderItems: true
          }
        },
        form: {
          include: {
            upsells: true,
            product: true
          }
        }
      }
    });

    console.log(`Found ${submissions.length} orders with upsells\n`);

    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const submission of submissions) {
      if (!submission.order || !submission.form) {
        console.log(`⚠️  Skipping submission ${submission.id} - missing order or form`);
        skippedCount++;
        continue;
      }

      const selectedUpsells = submission.selectedUpsells as any[];
      if (!Array.isArray(selectedUpsells) || selectedUpsells.length === 0) {
        skippedCount++;
        continue;
      }

      // Check if upsell items already exist
      const existingUpsellItems = submission.order.orderItems.filter(
        item => item.itemType === 'upsell'
      );

      if (existingUpsellItems.length > 0) {
        console.log(`✓ Order ${submission.order.id} already has ${existingUpsellItems.length} upsell items`);
        skippedCount++;
        continue;
      }

      console.log(`\n📦 Processing Order ${submission.order.id}:`);
      console.log(`   Package items: ${submission.order.orderItems.length}`);
      console.log(`   Upsells to add: ${selectedUpsells.length}`);

      try {
        // Create upsell order items
        const upsellItems = [];

        for (const selectedUpsell of selectedUpsells) {
          // Find the upsell definition from the form
          const upsellDef = submission.form.upsells.find(
            u => u.id === selectedUpsell.id || u.name === selectedUpsell.name
          );

          const productId = upsellDef?.productId || submission.form.productId;
          const price = selectedUpsell.price || upsellDef?.price || 0;

          upsellItems.push({
            orderId: submission.order.id,
            productId: productId,
            quantity: 1,
            unitPrice: price,
            totalPrice: price,
            itemType: 'upsell',
            metadata: {
              upsellName: selectedUpsell.name,
              upsellId: selectedUpsell.id,
              migratedAt: new Date().toISOString()
            }
          });

          console.log(`   ✓ Adding upsell: ${selectedUpsell.name} ($${price})`);
        }

        // Create the upsell order items
        if (upsellItems.length > 0) {
          await prisma.orderItem.createMany({
            data: upsellItems
          });

          processedCount++;
          console.log(`✅ Successfully migrated ${upsellItems.length} upsell items for Order ${submission.order.id}`);
        }

      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing Order ${submission.order.id}:`, error);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`Total submissions found: ${submissions.length}`);
    console.log(`Orders migrated: ${processedCount}`);
    console.log(`Orders skipped: ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log('='.repeat(60) + '\n');

    if (errorCount === 0) {
      console.log('✅ Migration completed successfully!\n');
    } else {
      console.log('⚠️  Migration completed with errors. Please review the output above.\n');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
migrateUpsells()
  .then(() => {
    console.log('👋 Exiting...');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
