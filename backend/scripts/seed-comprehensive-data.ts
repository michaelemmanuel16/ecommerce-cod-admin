/* eslint-disable */
/* eslint-disable @typescript-eslint/no-unused-vars */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient, OrderStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Ghana regions and areas
const ghanaLocations = [
  { state: 'Greater Accra', area: 'Osu', zipCode: 'GA-001' },
  { state: 'Greater Accra', area: 'Tema', zipCode: 'GA-002' },
  { state: 'Greater Accra', area: 'Madina', zipCode: 'GA-003' },
  { state: 'Greater Accra', area: 'Dansoman', zipCode: 'GA-004' },
  { state: 'Ashanti', area: 'Adum', zipCode: 'AK-001' },
  { state: 'Ashanti', area: 'Asokwa', zipCode: 'AK-002' },
  { state: 'Western', area: 'Takoradi', zipCode: 'WR-001' },
  { state: 'Eastern', area: 'Koforidua', zipCode: 'ER-001' },
  { state: 'Northern', area: 'Tamale', zipCode: 'NR-001' },
  { state: 'Central', area: 'Cape Coast', zipCode: 'CR-001' },
];

async function seedComprehensiveData() {
  try {
    console.log('🌱 Starting comprehensive database seeding...\n');

    // Clear existing data
    console.log('🧹 Clearing existing data...');
    await prisma.delivery.deleteMany();
    await prisma.orderHistory.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.user.deleteMany();
    console.log('  ✅ Database cleared\n');

    // 1. Create 5 Customer Reps
    console.log('👥 Creating 5 Customer Reps...');
    const customerReps = [];
    const repData = [
      { firstName: 'Kwame', lastName: 'Mensah', email: 'kwame.mensah@company.com', phone: '0241234567', commission: 10 },
      { firstName: 'Abena', lastName: 'Owusu', email: 'abena.owusu@company.com', phone: '0242345678', commission: 12 },
      { firstName: 'Kofi', lastName: 'Asante', email: 'kofi.asante@company.com', phone: '0243456789', commission: 8 },
      { firstName: 'Akua', lastName: 'Boateng', email: 'akua.boateng@company.com', phone: '0244567890', commission: 15 },
      { firstName: 'Yaw', lastName: 'Appiah', email: 'yaw.appiah@company.com', phone: '0245678901', commission: 9 },
    ];

    for (const rep of repData) {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const user = await prisma.user.create({
        data: {
          email: rep.email,
          password: hashedPassword,
          firstName: rep.firstName,
          lastName: rep.lastName,
          phoneNumber: rep.phone,
          role: 'sales_rep',
          isActive: true,
          isAvailable: true,
          commissionRate: rep.commission,
        },
      });
      customerReps.push(user);
      console.log(`  ✅ Created rep: ${rep.firstName} ${rep.lastName} (${rep.email})`);
    }

    // 2. Create 3 Delivery Agents
    console.log('\n🚚 Creating 3 Delivery Agents...');
    const deliveryAgents = [];
    const agentData = [
      { firstName: 'Kwabena', lastName: 'Donkor', email: 'kwabena.donkor@company.com', phone: '0246789012' },
      { firstName: 'Ama', lastName: 'Frimpong', email: 'ama.frimpong@company.com', phone: '0247890123' },
      { firstName: 'Kwesi', lastName: 'Osei', email: 'kwesi.osei@company.com', phone: '0248901234' },
    ];

    for (const agent of agentData) {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const user = await prisma.user.create({
        data: {
          email: agent.email,
          password: hashedPassword,
          firstName: agent.firstName,
          lastName: agent.lastName,
          phoneNumber: agent.phone,
          role: 'delivery_agent',
          isActive: true,
          isAvailable: true,
        },
      });
      deliveryAgents.push(user);
      console.log(`  ✅ Created agent: ${agent.firstName} ${agent.lastName} (${agent.email})`);
    }

    // 3. Create Unique Customers
    console.log('\n👤 Creating 12 Unique Customers...');
    const customers = [];
    const customerData = [
      { firstName: 'Emmanuel', lastName: 'Agyemang', email: 'emmanuel.agyemang@gmail.com', phone: '0201234567' },
      { firstName: 'Grace', lastName: 'Adjei', email: 'grace.adjei@gmail.com', phone: '0202345678' },
      { firstName: 'Michael', lastName: 'Ofori', email: 'michael.ofori@yahoo.com', phone: '0203456789' },
      { firstName: 'Beatrice', lastName: 'Acheampong', email: 'beatrice.acheampong@gmail.com', phone: '0204567890' },
      { firstName: 'Daniel', lastName: 'Kyei', email: 'daniel.kyei@hotmail.com', phone: '0205678901' },
      { firstName: 'Sarah', lastName: 'Amankwah', email: 'sarah.amankwah@gmail.com', phone: '0206789012' },
      { firstName: 'Joseph', lastName: 'Antwi', email: 'joseph.antwi@gmail.com', phone: '0207890123' },
      { firstName: 'Rebecca', lastName: 'Ofosu', email: 'rebecca.ofosu@yahoo.com', phone: '0208901234' },
      { firstName: 'Samuel', lastName: 'Mensah', email: 'samuel.mensah@gmail.com', phone: '0209012345' },
      { firstName: 'Elizabeth', lastName: 'Nyarko', email: 'elizabeth.nyarko@gmail.com', phone: '0500123456' },
      { firstName: 'Francis', lastName: 'Boadu', email: 'francis.boadu@hotmail.com', phone: '0501234567' },
      { firstName: 'Victoria', lastName: 'Sarpong', email: 'victoria.sarpong@gmail.com', phone: '0502345678' },
    ];

    for (let i = 0; i < customerData.length; i++) {
      const custData = customerData[i];
      const location = ghanaLocations[i % ghanaLocations.length];

      const customer = await prisma.customer.create({
        data: {
          firstName: custData.firstName,
          lastName: custData.lastName,
          email: custData.email,
          phoneNumber: custData.phone,
          alternatePhone: `025${Math.floor(Math.random() * 9000000 + 1000000)}`,
          address: `${Math.floor(Math.random() * 100 + 1)} ${['Main', 'High', 'Market', 'Station'][Math.floor(Math.random() * 4)]} Street`,
          city: location.area,
          state: location.state,
          zipCode: location.zipCode,
          area: location.area,
          landmark: ['Near Market', 'Opposite Bank', 'Behind Mall', 'Next to School'][Math.floor(Math.random() * 4)],
          isActive: true,
        },
      });
      customers.push(customer);
      console.log(`  ✅ Created customer: ${custData.firstName} ${custData.lastName} (${location.area}, ${location.state})`);
    }

    // 4. Get existing products or create some
    console.log('\n📦 Checking for products...');
    let products = await prisma.product.findMany({ where: { isActive: true } });

    if (products.length < 5) {
      console.log('Creating additional products...');
      const newProducts = [
        {
          sku: 'MAGIC-COPY-001',
          name: 'Magic Copybook',
          description: 'Reusable handwriting practice copybook',
          category: 'Educational',
          price: 250.00,
          costPrice: 150.00,
          stockQuantity: 100,
        },
        {
          sku: 'DICT-CREAM-001',
          name: 'Dictamni Hemorrhoid Cream',
          description: 'Effective hemorrhoid treatment',
          category: 'Health',
          price: 200.00,
          costPrice: 120.00,
          stockQuantity: 50,
        },
        {
          sku: 'WATCH-001',
          name: 'Smart Watch Pro',
          description: 'Fitness tracking smartwatch',
          category: 'Electronics',
          price: 450.00,
          costPrice: 280.00,
          stockQuantity: 30,
        },
        {
          sku: 'POWERBANK-001',
          name: 'Power Bank 20000mAh',
          description: 'Fast charging portable battery',
          category: 'Electronics',
          price: 180.00,
          costPrice: 100.00,
          stockQuantity: 75,
        },
        {
          sku: 'HEADSET-001',
          name: 'Wireless Bluetooth Headset',
          description: 'Noise canceling wireless headphones',
          category: 'Electronics',
          price: 320.00,
          costPrice: 190.00,
          stockQuantity: 45,
        },
      ];

      for (const prod of newProducts) {
        const product = await prisma.product.create({
          data: {
            ...prod,
            lowStockThreshold: 10,
            isActive: true,
          },
        });
        products.push(product);
        console.log(`  ✅ Created product: ${prod.name}`);
      }
    } else {
      console.log(`  ℹ️  Found ${products.length} existing products`);
    }

    // 5. Create Orders (some customers with multiple orders)
    console.log('\n📋 Creating 25 Orders...');
    const orderStatuses: OrderStatus[] = [
      'pending_confirmation',
      'confirmed',
      'preparing',
      'ready_for_pickup',
      'out_for_delivery',
      'delivered',
      'delivered',
      'delivered',
    ];

    const orders = [];
    let orderCounter = 1;

    // Create orders - some customers will have multiple orders
    const orderDistribution = [
      { customerId: 0, count: 3 }, // First customer gets 3 orders
      { customerId: 1, count: 2 }, // Second customer gets 2 orders
      { customerId: 2, count: 3 }, // Third customer gets 3 orders
      { customerId: 3, count: 1 }, // Fourth customer gets 1 order
      { customerId: 4, count: 2 }, // Fifth customer gets 2 orders
      { customerId: 5, count: 1 },
      { customerId: 6, count: 2 },
      { customerId: 7, count: 1 },
      { customerId: 8, count: 3 },
      { customerId: 9, count: 1 },
      { customerId: 10, count: 2 },
      { customerId: 11, count: 4 }, // Last customer gets 4 orders
    ];

    for (const dist of orderDistribution) {
      for (let j = 0; j < dist.count; j++) {
        const customer = customers[dist.customerId];
        const status = orderStatuses[Math.floor(Math.random() * orderStatuses.length)];
        const customerRep = customerReps[Math.floor(Math.random() * customerReps.length)];

        // Assign delivery agent for orders that are out for delivery or delivered
        const needsDeliveryAgent = ['ready_for_pickup', 'out_for_delivery', 'delivered'].includes(status);
        const deliveryAgent = needsDeliveryAgent
          ? deliveryAgents[Math.floor(Math.random() * deliveryAgents.length)]
          : undefined;

        // Random number of products (1-3)
        const numProducts = Math.floor(Math.random() * 3) + 1;
        const selectedProducts = [];
        for (let k = 0; k < numProducts; k++) {
          selectedProducts.push(products[Math.floor(Math.random() * products.length)]);
        }

        const subtotal = selectedProducts.reduce((sum, p) => sum + p.price, 0);
        const shippingCost = Math.random() > 0.5 ? 20.00 : 0;
        const discount = Math.random() > 0.7 ? 25.00 : 0;
        const totalAmount = subtotal + shippingCost - discount;

        const order = await prisma.order.create({
          data: {
            orderNumber: `ORD-${new Date().getFullYear()}-${String(orderCounter).padStart(5, '0')}`,
            customerId: customer.id,
            customerRepId: customerRep.id,
            deliveryAgentId: deliveryAgent?.id,
            status,
            paymentStatus: status === 'delivered' ? 'collected' : 'pending',
            subtotal,
            shippingCost,
            discount,
            totalAmount,
            codAmount: totalAmount,
            deliveryAddress: customer.address,
            deliveryCity: customer.city,
            deliveryState: customer.state,
            deliveryZipCode: customer.zipCode,
            deliveryArea: customer.area,
            priority: Math.floor(Math.random() * 3),
            source: 'manual',
            createdById: customerRep.id,
            orderItems: {
              create: selectedProducts.map((product) => {
                const quantity = Math.floor(Math.random() * 2) + 1;
                return {
                  productId: product.id,
                  quantity,
                  unitPrice: product.price,
                  totalPrice: product.price * quantity,
                };
              }),
            },
            orderHistory: {
              create: [
                {
                  status: 'pending_confirmation',
                  notes: 'Order created',
                  changedBy: customerRep.id,
                },
                ...(status !== 'pending_confirmation' ? [{
                  status,
                  notes: `Order status changed to ${status}`,
                  changedBy: customerRep.id,
                }] : []),
              ],
            },
          },
        });

        orders.push(order);
        console.log(`  ✅ Order ${order.orderNumber} - ${customer.firstName} ${customer.lastName} (${status})`);
        orderCounter++;
      }
    }

    // 6. Update customer statistics
    console.log('\n📊 Updating customer statistics...');
    for (const customer of customers) {
      const customerOrders = orders.filter(o => o.customerId === customer.id);
      const totalSpent = customerOrders.reduce((sum, o) => sum + o.totalAmount, 0);

      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          totalOrders: customerOrders.length,
          totalSpent,
        },
      });
      console.log(`  ✅ Updated ${customer.firstName} ${customer.lastName}: ${customerOrders.length} orders, GHS ${totalSpent.toFixed(2)}`);
    }

    // 7. Create deliveries for orders that need them
    console.log('\n🚚 Creating delivery records...');
    let deliveryCount = 0;
    for (const order of orders) {
      if (order.deliveryAgentId && ['ready_for_pickup', 'out_for_delivery', 'delivered'].includes(order.status)) {
        await prisma.delivery.create({
          data: {
            orderId: order.id,
            agentId: order.deliveryAgentId,
            scheduledTime: new Date(Date.now() + Math.random() * 24 * 60 * 60 * 1000),
            actualDeliveryTime: order.status === 'delivered'
              ? new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000)
              : undefined,
            proofType: order.status === 'delivered' ? 'signature' : undefined,
            deliveryAttempts: order.status === 'delivered' ? 1 : 0,
          },
        });
        deliveryCount++;
      }
    }
    console.log(`  ✅ Created ${deliveryCount} delivery records`);

    // Summary
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   Comprehensive Data Seeded Successfully! 🎉          ║
║                                                       ║
║   Customer Reps:    ${customerReps.length}                                   ║
║   Delivery Agents:  ${deliveryAgents.length}                                   ║
║   Customers:        ${customers.length}                                  ║
║   Products:         ${products.length}                                   ║
║   Orders:           ${orders.length}                                  ║
║   Deliveries:       ${deliveryCount}                                  ║
║                                                       ║
║   Default password for all users: password123        ║
║                                                       ║
║   Sample Customer Rep Login:                          ║
║   Email: kwame.mensah@company.com                     ║
║   Password: password123                               ║
║                                                       ║
║   Sample Delivery Agent Login:                        ║
║   Email: kwabena.donkor@company.com                   ║
║   Password: password123                               ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);

    console.log('\n✨ Refresh your browser to see all the new data!\n');

  } catch (error) {
    console.error('❌ Error seeding data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedComprehensiveData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
