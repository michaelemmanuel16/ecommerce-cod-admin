/* eslint-disable */
import dotenv from 'dotenv';
dotenv.config();

import prisma from '../src/utils/prisma';
import bcrypt from 'bcrypt';

async function seedAdditionalData() {
  try {
    console.log('🌱 Seeding additional data...');

    // Create 3 Delivery Agents
    const deliveryAgents = [];
    const agentNames = [
      { firstName: 'Kwame', lastName: 'Mensah' },
      { firstName: 'Akosua', lastName: 'Boateng' },
      { firstName: 'Kofi', lastName: 'Owusu' }
    ];

    for (let i = 0; i < 3; i++) {
      const agent = await prisma.user.create({
        data: {
          email: `delivery${i + 1}@example.com`,
          password: await bcrypt.hash('delivery123', 10),
          firstName: agentNames[i].firstName,
          lastName: agentNames[i].lastName,
          phoneNumber: `024${5000000 + i}`,
          role: 'delivery_agent',
          isActive: true,
          isAvailable: true
        }
      });
      deliveryAgents.push(agent);
    }

    console.log(`✅ Created ${deliveryAgents.length} delivery agents`);

    // Create 3 Customer Reps
    const customerReps = [];
    const repNames = [
      { firstName: 'Ama', lastName: 'Asante' },
      { firstName: 'Yaw', lastName: 'Agyei' },
      { firstName: 'Abena', lastName: 'Adjei' }
    ];

    for (let i = 0; i < 3; i++) {
      const rep = await prisma.user.create({
        data: {
          email: `rep${i + 1}@example.com`,
          password: await bcrypt.hash('rep123', 10),
          firstName: repNames[i].firstName,
          lastName: repNames[i].lastName,
          phoneNumber: `020${6000000 + i}`,
          role: 'sales_rep',
          isActive: true,
          isAvailable: true,
          commissionRate: 5.0 // 5% commission
        }
      });
      customerReps.push(rep);
    }

    console.log(`✅ Created ${customerReps.length} customer reps`);

    // Get existing products
    const products = await prisma.product.findMany();
    if (products.length === 0) {
      console.log('❌ No products found. Please run seed-sample-data.ts first.');
      process.exit(1);
    }

    // Create 10 more customers
    const customers = [];
    const customerData = [
      { firstName: 'Kwabena', lastName: 'Appiah', city: 'Accra', state: 'Greater Accra', area: 'Tema', phone: '0243456789' },
      { firstName: 'Esi', lastName: 'Ansah', city: 'Kumasi', state: 'Ashanti', area: 'Nhyiaeso', phone: '0247890123' },
      { firstName: 'Kojo', lastName: 'Addo', city: 'Takoradi', state: 'Western', area: 'Market Circle', phone: '0245678901' },
      { firstName: 'Efua', lastName: 'Bonsu', city: 'Cape Coast', state: 'Central', area: 'University', phone: '0249012345' },
      { firstName: 'Yaw', lastName: 'Donkor', city: 'Tamale', state: 'Northern', area: 'Central Market', phone: '0241122334' },
      { firstName: 'Adjoa', lastName: 'Frimpong', city: 'Accra', state: 'Greater Accra', area: 'Madina', phone: '0245544332' },
      { firstName: 'Kwesi', lastName: 'Gyamfi', city: 'Kumasi', state: 'Ashanti', area: 'Adum', phone: '0249988776' },
      { firstName: 'Akua', lastName: 'Hammond', city: 'Sunyani', state: 'Bono', area: 'Town Center', phone: '0243344556' },
      { firstName: 'Kofi', lastName: 'Inkoom', city: 'Ho', state: 'Volta', area: 'Barracks', phone: '0247766554' },
      { firstName: 'Ama', lastName: 'Kyei', city: 'Accra', state: 'Greater Accra', area: 'Spintex', phone: '0241199887' }
    ];

    for (const data of customerData) {
      const customer = await prisma.customer.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: `${data.firstName.toLowerCase()}.${data.lastName.toLowerCase()}@example.com`,
          phoneNumber: data.phone,
          alternatePhone: `050${Math.floor(1000000 + Math.random() * 9000000)}`,
          address: `${Math.floor(10 + Math.random() * 990)} ${data.area} Road`,
          city: data.city,
          state: data.state,
          zipCode: '00233',
          area: data.area,
          isActive: true
        }
      });
      customers.push(customer);
    }

    console.log(`✅ Created ${customers.length} additional customers`);

    // Create 15 more orders with various statuses
    const orderStatuses: Array<'pending_confirmation' | 'confirmed' | 'preparing' | 'ready_for_pickup' | 'out_for_delivery' | 'delivered' | 'cancelled'> = [
      'pending_confirmation',
      'confirmed',
      'preparing',
      'ready_for_pickup',
      'out_for_delivery',
      'delivered',
      'confirmed',
      'preparing',
      'out_for_delivery',
      'delivered',
      'pending_confirmation',
      'confirmed',
      'delivered',
      'delivered',
      'cancelled'
    ];

    const orders = [];
    for (let i = 0; i < 15; i++) {
      const customer = customers[Math.floor(Math.random() * customers.length)];
      const product = products[Math.floor(Math.random() * products.length)];
      const quantity = Math.floor(1 + Math.random() * 3); // 1-3 items
      const status = orderStatuses[i];
      const totalAmount = product.price * quantity;

      // Assign customer rep and delivery agent for some orders
      const customerRep = Math.random() > 0.3 ? customerReps[Math.floor(Math.random() * customerReps.length)] : null;
      const deliveryAgent = ['out_for_delivery', 'delivered'].includes(status)
        ? deliveryAgents[Math.floor(Math.random() * deliveryAgents.length)]
        : null;

      const order = await prisma.order.create({
        data: {
          orderNumber: `ORD-${Date.now()}-${String(i + 3).padStart(5, '0')}`,
          customerId: customer.id,
          customerRepId: customerRep?.id,
          deliveryAgentId: deliveryAgent?.id,
          status,
          paymentStatus: status === 'delivered' ? 'collected' : 'pending',
          subtotal: totalAmount,
          shippingCost: 0,
          discount: 0,
          totalAmount,
          codAmount: totalAmount,
          deliveryAddress: customer.address,
          deliveryCity: customer.city,
          deliveryState: customer.state,
          deliveryZipCode: customer.zipCode,
          deliveryArea: customer.area,
          source: Math.random() > 0.5 ? 'manual' : 'website',
          orderItems: {
            create: {
              productId: product.id,
              quantity,
              unitPrice: product.price,
              totalPrice: totalAmount
            }
          },
          orderHistory: {
            create: {
              status,
              notes: `Order ${status.replace('_', ' ')}`
            }
          }
        }
      });

      // Update customer statistics
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          totalOrders: { increment: 1 },
          totalSpent: { increment: totalAmount }
        }
      });

      // Create delivery record for delivered/out_for_delivery orders
      if (deliveryAgent && ['out_for_delivery', 'delivered'].includes(status)) {
        await prisma.delivery.create({
          data: {
            orderId: order.id,
            agentId: deliveryAgent.id,
            scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
            actualDeliveryTime: status === 'delivered' ? new Date() : null,
            proofType: status === 'delivered' ? 'signature' : null,
            proofData: status === 'delivered' ? 'Customer signature received' : null,
            recipientName: `${customer.firstName} ${customer.lastName}`,
            recipientPhone: customer.phoneNumber,
            deliveryAttempts: status === 'delivered' ? 1 : 0
          }
        });
      }

      orders.push(order);
    }

    console.log(`✅ Created ${orders.length} additional orders`);

    console.log(`
    ╔═══════════════════════════════════════════════════════╗
    ║                                                       ║
    ║   Additional Data Seeded Successfully!                ║
    ║                                                       ║
    ║   Delivery Agents:  3                                 ║
    ║   Customer Reps:    3                                 ║
    ║   Customers:        10                                ║
    ║   Orders:           15                                ║
    ║                                                       ║
    ║   Login Credentials:                                  ║
    ║   ─────────────────────────────────────────────────   ║
    ║   Delivery Agents:                                    ║
    ║     delivery1@example.com / delivery123               ║
    ║     delivery2@example.com / delivery123               ║
    ║     delivery3@example.com / delivery123               ║
    ║                                                       ║
    ║   Customer Reps:                                      ║
    ║     rep1@example.com / rep123                         ║
    ║     rep2@example.com / rep123                         ║
    ║     rep3@example.com / rep123                         ║
    ║                                                       ║
    ║   Refresh your browser to see the data                ║
    ║                                                       ║
    ╚═══════════════════════════════════════════════════════╝
    `);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding additional data:', error);
    process.exit(1);
  }
}

seedAdditionalData();
