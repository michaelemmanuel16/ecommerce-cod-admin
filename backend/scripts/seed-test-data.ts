import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function seedTestData() {
    try {
        console.log('🌱 Seeding test data...\n');

        // 1. Create Delivery Agent (VDL Fulfilment)
        console.log('👤 Creating Delivery Agent...');
        const agent = await prisma.user.upsert({
            where: { email: 'agent1@codadmin.com' },
            update: {},
            create: {
                email: 'agent1@codadmin.com',
                password: await bcrypt.hash('password123', 10),
                firstName: 'VDL',
                lastName: 'Fulfilment',
                role: 'delivery_agent',
                isActive: true,
                phoneNumber: '+233501234567',
                country: 'Ghana',
                location: 'Accra',
                vehicleType: 'Motorcycle',
                vehicleId: 'GH-001-VDL',
                deliveryRate: 5.00,
                isAvailable: true,
            }
        });
        console.log(`✅ Delivery Agent created: ${agent.firstName} ${agent.lastName} (ID: ${agent.id})\n`);

        // Create agent balance
        await prisma.agentBalance.upsert({
            where: { agentId: agent.id },
            update: {},
            create: {
                agentId: agent.id,
                currentBalance: 0,
                totalCollected: 0,
                totalDeposited: 0,
            }
        });

        // 2. Create Sales Rep (Precious Adjei)
        console.log('👤 Creating Sales Rep...');
        const salesRep = await prisma.user.upsert({
            where: { email: 'rep1@codadmin.com' },
            update: {},
            create: {
                email: 'rep1@codadmin.com',
                password: await bcrypt.hash('password123', 10),
                firstName: 'Precious',
                lastName: 'Adjei',
                role: 'sales_rep',
                isActive: true,
                phoneNumber: '+233509876543',
                country: 'Ghana',
                commissionAmount: 2.00,
            }
        });
        console.log(`✅ Sales Rep created: ${salesRep.firstName} ${salesRep.lastName} (ID: ${salesRep.id})\n`);

        // 3. Create Product (Magic Copybook)
        console.log('📦 Creating Product...');
        const product = await prisma.product.upsert({
            where: { sku: 'MCB-001' },
            update: {},
            create: {
                name: 'Magic Copybook',
                description: 'Reusable magic copybook for children - write, erase, repeat!',
                price: 45.00,
                cogs: 25.00,
                sku: 'MCB-001',
                stockQuantity: 500,
                category: 'Educational',
                isActive: true,
                weight: 0.3,
                dimensions: '21cm x 15cm x 1cm',
            }
        });
        console.log(`✅ Product created: ${product.name} (ID: ${product.id})`);
        console.log(`   Price: GHS ${product.price}`);
        console.log(`   COGS: GHS ${product.cogs}`);
        console.log(`   Stock: ${product.stockQuantity} units\n`);

        console.log('🎉 Test data seeded successfully!\n');
        console.log('📝 Summary:');
        console.log('   - Admin: admin@codadmin.com / password123');
        console.log('   - Delivery Agent: agent1@codadmin.com / password123');
        console.log('   - Sales Rep: rep1@codadmin.com / password123');
        console.log('   - Product: Magic Copybook (GHS 45.00)');

    } catch (error) {
        console.error('❌ Error seeding test data:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

seedTestData();
