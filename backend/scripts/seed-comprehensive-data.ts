import { PrismaClient, OrderStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

const defaultPassword = 'password123';

const ghanaLocations = [
  { state: 'Greater Accra', area: 'East Legon' },
  { state: 'Greater Accra', area: 'Madina' },
  { state: 'Greater Accra', area: 'Tema Community 1' },
  { state: 'Ashanti', area: 'Adum, Kumasi' },
  { state: 'Ashanti', area: 'Bantama' },
  { state: 'Western', area: 'Takoradi Market Circle' },
  { state: 'Central', area: 'Cape Coast Metropolis' },
  { state: 'Northern', area: 'Tamale Central' },
  { state: 'Greater Accra', area: 'Spintex' },
  { state: 'Greater Accra', area: 'Dansoman' },
];

async function seedComprehensiveData() {
  try {
    console.log('🚀 Starting Comprehensive Seeding...');

    // Clear existing data
    console.log('Lines clearing existing data...');
    await prisma.notification.deleteMany();
    await prisma.workflowExecution.deleteMany();
    await prisma.workflow.deleteMany();
    await prisma.webhookLog.deleteMany();
    await prisma.webhookConfig.deleteMany();
    await prisma.agentAgingBucket.deleteMany();
    await prisma.agentDeposit.deleteMany();
    await prisma.agentCollection.deleteMany();
    await prisma.agentBalance.deleteMany();
    await prisma.delivery.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.orderHistory.deleteMany();
    await prisma.order.deleteMany();
    await prisma.checkoutForm.deleteMany();
    await prisma.product.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.accountTransaction.deleteMany();
    await prisma.journalEntry.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.systemConfig.deleteMany();
    console.log('  ✅ Database cleared\n');

    // 0. Create Super Admin and System Config
    console.log('⚙️ Initializing System Config and Super Admin...');
    const adminPassword = await bcrypt.hash(defaultPassword, 10);
    await prisma.user.create({
      data: {
        email: 'admin@codadmin.com',
        password: adminPassword,
        firstName: 'Admin',
        lastName: 'User',
        phoneNumber: '+1234567890',
        role: 'super_admin',
        isActive: true,
        isAvailable: true,
      },
    });
    console.log('  ✅ Super Admin created (admin@codadmin.com)');

    await prisma.systemConfig.create({
      data: {
        businessName: 'COD Admin Pro',
        currency: 'GHS',
        rolePermissions: {
          super_admin: {
            users: ['create', 'view', 'update', 'delete'],
            orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign'],
            customers: ['create', 'view', 'update', 'delete'],
            products: ['create', 'view', 'update', 'delete', 'update_stock'],
            financial: ['view', 'create', 'update', 'delete'],
            analytics: ['view'],
            workflows: ['create', 'view', 'update', 'delete', 'execute'],
            settings: ['view', 'update'],
            calls: ['create', 'view', 'update', 'delete'],
          },
          admin: {
            users: ['create', 'view', 'update', 'delete'],
            orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign'],
            customers: ['create', 'view', 'update', 'delete'],
            products: ['create', 'view', 'update', 'delete'],
            financial: ['view', 'create'],
            analytics: ['view'],
            workflows: ['create', 'view', 'update', 'delete', 'execute'],
            settings: ['view'],
            calls: ['create', 'view', 'update', 'delete'],
          },
          manager: {
            users: [],
            orders: ['view', 'update', 'bulk_import', 'assign'],
            customers: ['create', 'view', 'update', 'delete'],
            products: ['view'],
            financial: ['view'],
            analytics: ['view'],
            workflows: ['view', 'execute'],
            settings: [],
            calls: ['view'],
          },
          sales_rep: {
            users: [],
            orders: ['create', 'view', 'update'],
            customers: ['create', 'view', 'update', 'delete'],
            products: ['view'],
            financial: [],
            analytics: ['view'],
            workflows: [],
            settings: [],
            calls: ['create', 'view'],
          },
          inventory_manager: {
            users: [],
            orders: ['view'],
            customers: ['view'],
            products: ['create', 'view', 'update', 'delete', 'update_stock'],
            financial: [],
            analytics: ['view'],
            workflows: [],
            settings: [],
            calls: [],
          },
          delivery_agent: {
            users: [],
            orders: ['view', 'update'],
            customers: ['view'],
            products: ['view'],
            financial: ['create'],
            analytics: ['view'],
            workflows: [],
            settings: [],
            calls: [],
          },
          accountant: {
            users: [],
            orders: ['view'],
            customers: ['view'],
            products: ['view'],
            financial: ['view', 'create'],
            analytics: ['view'],
            workflows: [],
            calls: [],
            settings: [],
          },
        }
      }
    });
    console.log('  ✅ System Config initialized with permissions\n');

    // 1. Create 5 Customer Reps
    console.log('👥 Creating 5 Customer Reps...');
    const customerReps = [];
    const repData = [
      { firstName: 'Kwame', lastName: 'Mensah', email: 'rep1@codadmin.com', phone: '0241234567', commission: 10 },
      { firstName: 'Abena', lastName: 'Owusu', email: 'rep2@codadmin.com', phone: '0242345678', commission: 12 },
      { firstName: 'Kofi', lastName: 'Asante', email: 'rep3@codadmin.com', phone: '0243456789', commission: 8 },
      { firstName: 'Akua', lastName: 'Boateng', email: 'rep4@codadmin.com', phone: '0244567890', commission: 15 },
      { firstName: 'Yaw', lastName: 'Appiah', email: 'rep5@codadmin.com', phone: '0245678901', commission: 9 },
    ];

    for (const rep of repData) {
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
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
          commissionAmount: rep.commission,
        },
      });
      customerReps.push(user);
      console.log(`  ✅ Created rep: ${rep.firstName} ${rep.lastName} (${rep.email})`);
    }

    // 2. Create 3 Delivery Agents
    console.log('\n🚚 Creating 3 Delivery Agents...');
    const deliveryAgents = [];
    const agentData = [
      { firstName: 'Kwabena', lastName: 'Donkor', email: 'agent1@codadmin.com', phone: '0246789012' },
      { firstName: 'Ama', lastName: 'Frimpong', email: 'agent2@codadmin.com', phone: '0247890123' },
      { firstName: 'Kwesi', lastName: 'Osei', email: 'agent3@codadmin.com', phone: '0248901234' },
    ];

    for (const agent of agentData) {
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
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
          state: location.state,
          area: location.area,
          landmark: ['Near Market', 'Opposite Bank', 'Behind Mall', 'Next to School'][Math.floor(Math.random() * 4)],
          isActive: true,
        },
      });
      customers.push(customer);
      console.log(`  ✅ Created customer: ${custData.firstName} ${custData.lastName} (${location.area}, ${location.state})`);
    }

    // 4. Create Products
    console.log('\n📦 Creating products...');
    const productData = [
      {
        sku: 'MAGIC-COPY-001',
        name: 'Magic Copybook',
        description: 'Reusable handwriting practice copybook',
        category: 'Educational',
        price: 250.00,
        cogs: new Decimal(150.00),
        stockQuantity: 100,
      },
      {
        sku: 'DICT-CREAM-001',
        name: 'Dictamni Hemorrhoid Cream',
        description: 'Effective hemorrhoid treatment',
        category: 'Health',
        price: 200.00,
        cogs: new Decimal(120.00),
        stockQuantity: 50,
      },
      {
        sku: 'WATCH-001',
        name: 'Smart Watch Pro',
        description: 'Fitness tracking smartwatch',
        category: 'Electronics',
        price: 450.00,
        cogs: new Decimal(280.00),
        stockQuantity: 30,
      },
      {
        sku: 'POWERBANK-001',
        name: 'Power Bank 20000mAh',
        description: 'Fast charging portable battery',
        category: 'Electronics',
        price: 180.00,
        cogs: new Decimal(100.00),
        stockQuantity: 75,
      },
      {
        sku: 'HEADSET-001',
        name: 'Wireless Bluetooth Headset',
        description: 'Noise canceling wireless headphones',
        category: 'Electronics',
        price: 320.00,
        cogs: new Decimal(190.00),
        stockQuantity: 45,
      },
    ];

    const products = [];
    for (const prod of productData) {
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

    // 5. Create Orders
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
    const orderDistribution = [
      { customerId: 0, count: 3 },
      { customerId: 1, count: 2 },
      { customerId: 2, count: 3 },
      { customerId: 3, count: 1 },
      { customerId: 4, count: 2 },
      { customerId: 5, count: 1 },
      { customerId: 6, count: 2 },
      { customerId: 7, count: 1 },
      { customerId: 8, count: 3 },
      { customerId: 9, count: 1 },
      { customerId: 10, count: 2 },
      { customerId: 11, count: 4 },
    ];

    for (const dist of orderDistribution) {
      for (let j = 0; j < dist.count; j++) {
        const customer = customers[dist.customerId];
        const status = orderStatuses[Math.floor(Math.random() * orderStatuses.length)];
        const customerRep = customerReps[Math.floor(Math.random() * customerReps.length)];
        const needsDeliveryAgent = ['ready_for_pickup', 'out_for_delivery', 'delivered'].includes(status);
        const deliveryAgent = needsDeliveryAgent
          ? deliveryAgents[Math.floor(Math.random() * deliveryAgents.length)]
          : undefined;

        const numProducts = Math.floor(Math.random() * 3) + 1;
        const selectedProducts = [];
        for (let k = 0; k < numProducts; k++) {
          selectedProducts.push(products[Math.floor(Math.random() * products.length)]);
        }

        const subtotal = selectedProducts.reduce((sum, p) => sum + p.price, 0);
        const shippingCost = Math.random() > 0.5 ? 20.00 : 0;
        const discount = Math.random() > 0.7 ? 25.00 : 0;
        const totalAmount = subtotal + shippingCost - discount;

        // For delivered orders, set a delivery date in the last 7 days
        const deliveryDate = status === 'delivered'
          ? new Date(Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000))
          : null;

        const order = await prisma.order.create({
          data: {
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
            deliveryState: customer.state,
            deliveryArea: customer.area,
            priority: Math.floor(Math.random() * 3),
            source: 'manual',
            createdById: customerRep.id,
            deliveryDate,
            orderItems: {
              create: selectedProducts.map((product) => {
                const quantity = Math.floor(Math.random() * 2) + 1;
                return {
                  productId: product.id,
                  quantity,
                  unitPrice: product.price,
                  totalPrice: product.price * quantity,
                  itemType: 'package',
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
        console.log(`  ✅ Order #${order.id} - ${customer.firstName} ${customer.lastName} (${status})`);
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

    // 7. Create deliveries
    console.log('\n🚚 Creating delivery records...');
    let deliveryCount = 0;
    for (const order of orders) {
      if (order.deliveryAgentId && ['ready_for_pickup', 'out_for_delivery', 'delivered'].includes(order.status)) {
        await prisma.delivery.create({
          data: {
            orderId: order.id,
            agentId: order.deliveryAgentId,
            scheduledTime: new Date(Date.now() + Math.random() * 24 * 60 * 60 * 1000),
            actualDeliveryTime: order.status === 'delivered' ? order.deliveryDate : undefined,
            proofType: order.status === 'delivered' ? 'signature' : undefined,
            deliveryAttempts: order.status === 'delivered' ? 1 : 0,
          },
        });
        deliveryCount++;
      }
    }
    console.log(`  ✅ Created ${deliveryCount} delivery records`);

    // 8. Create Expenses (for marketing & net profit testing)
    console.log('\n💸 Creating expenses...');
    const expenseCategories = ['marketing', 'logistics', 'office', 'other'];
    for (let i = 0; i < 10; i++) {
      await prisma.expense.create({
        data: {
          category: expenseCategories[i % expenseCategories.length],
          amount: Math.floor(Math.random() * 500) + 50,
          description: `Monthly ${expenseCategories[i % expenseCategories.length]} payment`,
          expenseDate: new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000)),
        }
      });
    }
    console.log('  ✅ Created 10 sample expenses');

    console.log('\n✨ Database seeding complete!\n');

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
