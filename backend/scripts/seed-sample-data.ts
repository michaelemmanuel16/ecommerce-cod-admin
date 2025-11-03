import dotenv from 'dotenv';
dotenv.config();

import prisma from '../src/utils/prisma';

async function seedSampleData() {
  try {
    console.log('🌱 Seeding sample data...');

    // Create sample products
    const magicCopybook = await prisma.product.create({
      data: {
        sku: 'MAGIC-COPY-001',
        name: 'Magic Copybook',
        description: 'Reusable handwriting practice copybook with disappearing ink',
        category: 'Educational',
        price: 250.00,
        costPrice: 150.00,
        stockQuantity: 100,
        lowStockThreshold: 10,
        isActive: true
      }
    });

    const hemorrhoidCream = await prisma.product.create({
      data: {
        sku: 'DICTAMNI-001',
        name: 'Dictamni Hemorrhoid Cream',
        description: 'Effective hemorrhoid treatment cream',
        category: 'Health',
        price: 200.00,
        costPrice: 120.00,
        stockQuantity: 50,
        lowStockThreshold: 10,
        isActive: true
      }
    });

    console.log(`✅ Created ${2} products`);

    // Create sample customers
    const customer1 = await prisma.customer.create({
      data: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phoneNumber: '0241234567',
        alternatePhone: '0201234567',
        address: '123 Liberation Road',
        city: 'Accra',
        state: 'Greater Accra',
        zipCode: '00233',
        area: 'Osu',
        isActive: true
      }
    });

    const customer2 = await prisma.customer.create({
      data: {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com',
        phoneNumber: '0247654321',
        alternatePhone: '0207654321',
        address: '456 Independence Avenue',
        city: 'Kumasi',
        state: 'Ashanti',
        zipCode: '00233',
        area: 'Adum',
        isActive: true
      }
    });

    console.log(`✅ Created ${2} customers`);

    // Create sample orders
    await prisma.order.create({
      data: {
        orderNumber: `ORD-${Date.now()}-00001`,
        customerId: customer1.id,
        status: 'pending_confirmation',
        paymentStatus: 'pending',
        subtotal: 250.00,
        shippingCost: 0,
        discount: 0,
        totalAmount: 250.00,
        codAmount: 250.00,
        deliveryAddress: customer1.address,
        deliveryCity: customer1.city,
        deliveryState: customer1.state,
        deliveryZipCode: customer1.zipCode,
        deliveryArea: customer1.area,
        source: 'manual',
        orderItems: {
          create: {
            productId: magicCopybook.id,
            quantity: 1,
            unitPrice: 250.00,
            totalPrice: 250.00
          }
        },
        orderHistory: {
          create: {
            status: 'pending_confirmation',
            notes: 'Order created'
          }
        }
      }
    });

    await prisma.order.create({
      data: {
        orderNumber: `ORD-${Date.now()}-00002`,
        customerId: customer2.id,
        status: 'confirmed',
        paymentStatus: 'pending',
        subtotal: 400.00,
        shippingCost: 0,
        discount: 0,
        totalAmount: 400.00,
        codAmount: 400.00,
        deliveryAddress: customer2.address,
        deliveryCity: customer2.city,
        deliveryState: customer2.state,
        deliveryZipCode: customer2.zipCode,
        deliveryArea: customer2.area,
        source: 'manual',
        orderItems: {
          create: [
            {
              productId: hemorrhoidCream.id,
              quantity: 2,
              unitPrice: 200.00,
              totalPrice: 400.00
            }
          ]
        },
        orderHistory: {
          create: [
            {
              status: 'pending_confirmation',
              notes: 'Order created'
            },
            {
              status: 'confirmed',
              notes: 'Order confirmed'
            }
          ]
        }
      }
    });

    console.log(`✅ Created ${2} orders`);

    // Update customer stats
    await prisma.customer.update({
      where: { id: customer1.id },
      data: {
        totalOrders: 1,
        totalSpent: 250.00
      }
    });

    await prisma.customer.update({
      where: { id: customer2.id },
      data: {
        totalOrders: 1,
        totalSpent: 400.00
      }
    });

    console.log('✅ Updated customer statistics');

    console.log(`
    ╔═══════════════════════════════════════════════════════╗
    ║                                                       ║
    ║   Sample Data Seeded Successfully!                    ║
    ║                                                       ║
    ║   Products:  2                                        ║
    ║   Customers: 2                                        ║
    ║   Orders:    2                                        ║
    ║                                                       ║
    ║   Refresh your browser to see the data                ║
    ║                                                       ║
    ╚═══════════════════════════════════════════════════════╝
    `);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  }
}

seedSampleData();
