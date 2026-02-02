import { PrismaClient, OrderStatus, AccountType, NormalBalance } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Ghana regions and cities
const ghanaLocations = [
  { region: 'Greater Accra', cities: ['Accra', 'Tema', 'Madina', 'Legon', 'Dansoman', 'Kasoa', 'Achimota'] },
  { region: 'Ashanti', cities: ['Kumasi', 'Obuasi', 'Ejisu', 'Mampong', 'Konongo'] },
  { region: 'Western', cities: ['Sekondi-Takoradi', 'Tarkwa', 'Axim', 'Prestea'] },
  { region: 'Central', cities: ['Cape Coast', 'Elmina', 'Winneba', 'Kasoa'] },
  { region: 'Eastern', cities: ['Koforidua', 'Akosombo', 'Nkawkaw', 'Mpraeso'] },
  { region: 'Northern', cities: ['Tamale', 'Yendi', 'Savelugu', 'Walewale'] },
  { region: 'Volta', cities: ['Ho', 'Hohoe', 'Keta', 'Aflao'] },
  { region: 'Upper East', cities: ['Bolgatanga', 'Bawku', 'Navrongo'] },
  { region: 'Upper West', cities: ['Wa', 'Tumu', 'Lawra'] },
  { region: 'Bono', cities: ['Sunyani', 'Berekum', 'Dormaa Ahenkro'] },
];

// Sample names
const firstNames = [
  'Kwame', 'Kofi', 'Yaw', 'Akua', 'Ama', 'Abena', 'Kwesi', 'Adjoa',
  'Emmanuel', 'Grace', 'Samuel', 'Esther', 'Daniel', 'Rebecca', 'Joseph',
  'Sarah', 'David', 'Hannah', 'Michael', 'Ruth', 'Peter', 'Mary',
  'John', 'Elizabeth', 'James', 'Comfort', 'Isaac', 'Patience',
  'Benjamin', 'Charity', 'Solomon', 'Faith', 'Stephen', 'Joyce'
];

const lastNames = [
  'Mensah', 'Asante', 'Boateng', 'Owusu', 'Agyeman', 'Osei', 'Addo',
  'Frimpong', 'Annan', 'Adjei', 'Ofori', 'Gyasi', 'Konadu', 'Opoku',
  'Darko', 'Amoah', 'Yeboah', 'Appiah', 'Nkrumah', 'Amponsah'
];

// Product categories and items
const productData = [
  // Electronics
  { category: 'Electronics', name: 'Samsung Galaxy A54 5G', price: 2500, cost: 2000 },
  { category: 'Electronics', name: 'iPhone 13 Pro Max', price: 7500, cost: 6500 },
  { category: 'Electronics', name: 'Apple Watch Series 8', price: 3200, cost: 2800 },
  { category: 'Electronics', name: 'Sony WH-1000XM5 Headphones', price: 1800, cost: 1400 },
  { category: 'Electronics', name: 'iPad Air 5th Gen', price: 4500, cost: 3800 },
  { category: 'Electronics', name: 'MacBook Pro M2', price: 12000, cost: 10500 },
  { category: 'Electronics', name: 'Samsung 55" QLED TV', price: 5500, cost: 4500 },
  { category: 'Electronics', name: 'PlayStation 5', price: 4200, cost: 3600 },
  { category: 'Electronics', name: 'JBL Flip 6 Speaker', price: 680, cost: 500 },
  { category: 'Electronics', name: 'Canon EOS R6', price: 15000, cost: 13000 },

  // Fashion
  { category: 'Fashion', name: 'Nike Air Max 270', price: 850, cost: 600 },
  { category: 'Fashion', name: 'Adidas Ultraboost 22', price: 920, cost: 650 },
  { category: 'Fashion', name: 'Levi\'s 501 Original Jeans', price: 380, cost: 250 },
  { category: 'Fashion', name: 'Kente Cloth Traditional Wear', price: 1200, cost: 800 },
  { category: 'Fashion', name: 'Designer Handbag', price: 2500, cost: 1800 },
  { category: 'Fashion', name: 'Ray-Ban Aviator Sunglasses', price: 680, cost: 450 },
  { category: 'Fashion', name: 'Leather Wallet', price: 180, cost: 100 },
  { category: 'Fashion', name: 'Smart Watch Band', price: 120, cost: 60 },

  // Home & Living
  { category: 'Home & Living', name: 'Blender 1000W', price: 450, cost: 300 },
  { category: 'Home & Living', name: 'Microwave Oven', price: 850, cost: 600 },
  { category: 'Home & Living', name: 'Rice Cooker 5L', price: 280, cost: 180 },
  { category: 'Home & Living', name: 'Air Fryer 6.5L', price: 680, cost: 480 },
  { category: 'Home & Living', name: 'Vacuum Cleaner', price: 950, cost: 650 },
  { category: 'Home & Living', name: 'Standing Fan', price: 320, cost: 200 },
  { category: 'Home & Living', name: 'LED Desk Lamp', price: 180, cost: 100 },

  // Health & Beauty
  { category: 'Health & Beauty', name: 'Shea Butter Pure 500g', price: 85, cost: 50 },
  { category: 'Health & Beauty', name: 'African Black Soap Set', price: 120, cost: 70 },
  { category: 'Health & Beauty', name: 'Hair Dryer Professional', price: 380, cost: 250 },
  { category: 'Health & Beauty', name: 'Fitness Tracker Band', price: 420, cost: 280 },
  { category: 'Health & Beauty', name: 'Massage Gun', price: 680, cost: 450 },
  { category: 'Health & Beauty', name: 'Digital Scale', price: 180, cost: 100 },
  { category: 'Health & Beauty', name: 'Blood Pressure Monitor', price: 320, cost: 200 },
];

// Vehicle types for delivery agents
const vehicleTypes = ['Motorcycle', 'Car', 'Van', 'Bicycle', 'Tricycle'];

// Helper functions
// Cryptographically secure random number generator (0 to 1)
function random(): number {
  return crypto.randomInt(0, 1000000) / 1000000;
}

function randomElement<T>(array: T[]): T {
  return array[crypto.randomInt(0, array.length)];
}

function randomPhone(): string {
  const prefixes = ['024', '054', '055', '020', '050', '027', '057', '026', '056'];
  const prefix = randomElement(prefixes);
  const number = crypto.randomInt(0, 10000000).toString().padStart(7, '0');
  return `0${prefix}${number}`;
}

function randomDate(start: Date, end: Date): Date {
  const range = end.getTime() - start.getTime();
  const randomOffset = (crypto.randomInt(0, 1000000) / 1000000) * range;
  return new Date(start.getTime() + randomOffset);
}

async function resetSequences() {
  console.log('Resetting database sequences to start at 1000...');

  const tables = [
    'users', 'customers', 'products', 'orders', 'order_items',
    'deliveries', 'transactions', 'expenses', 'accounts', 'workflows',
    'workflow_executions', 'webhook_configs', 'webhook_logs',
    'notifications', 'checkout_forms', 'form_packages',
    'form_upsells', 'form_submissions', 'order_history'
  ];

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER SEQUENCE ${table}_id_seq RESTART WITH 1000;`
      );
    } catch (error) {
      // Sequence might not exist yet, that's okay
      console.log(`Sequence for ${table} might not exist yet, skipping...`);
    }
  }
}

async function cleanDatabase() {
  if (process.env.ALLOW_DB_CLEANUP !== 'true') {
    console.warn('⚠️  Skipping data cleanup. Set ALLOW_DB_CLEANUP=true to enable.');
    return;
  }

  console.log('Cleaning database...');

  // Delete in correct order to respect foreign key constraints
  await prisma.formSubmission.deleteMany();
  await prisma.formUpsell.deleteMany();
  await prisma.formPackage.deleteMany();
  await prisma.checkoutForm.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.webhookLog.deleteMany();
  await prisma.webhookConfig.deleteMany();
  await prisma.workflowExecution.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.account.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.orderHistory.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();

  console.log('Database cleaned successfully');
}

async function seedChartOfAccounts() {
  console.log('\n💰 Seeding Chart of Accounts...');

  const accounts = [
    // Assets (1000-1999) - Debit Normal Balance
    { code: '1010', name: 'Cash in Hand', description: 'Bank account cash balances', accountType: AccountType.asset, normalBalance: NormalBalance.debit, isSystem: true },
    { code: '1020', name: 'Cash in Transit', description: 'Cash collected by delivery agents, not yet deposited', accountType: AccountType.asset, normalBalance: NormalBalance.debit, isSystem: true },
    { code: '1030', name: 'Accounts Receivable - Agents', description: 'Amounts owed by delivery agents for COD collections', accountType: AccountType.asset, normalBalance: NormalBalance.debit, isSystem: true },
    { code: '1040', name: 'Inventory', description: 'Value of products in stock', accountType: AccountType.asset, normalBalance: NormalBalance.debit, isSystem: true },

    // Liabilities (2000-2999) - Credit Normal Balance
    { code: '2010', name: 'Accounts Payable', description: 'Amounts owed to suppliers and vendors', accountType: AccountType.liability, normalBalance: NormalBalance.credit, isSystem: true },
    { code: '2020', name: 'Agent Deposits Pending', description: 'Cash held by agents awaiting deposit', accountType: AccountType.liability, normalBalance: NormalBalance.credit, isSystem: true },

    // Equity (3000-3999) - Credit Normal Balance
    { code: '3010', name: 'Owner\'s Equity', description: 'Owner\'s investment in the business', accountType: AccountType.equity, normalBalance: NormalBalance.credit, isSystem: true },
    { code: '3020', name: 'Retained Earnings', description: 'Accumulated profits retained in the business', accountType: AccountType.equity, normalBalance: NormalBalance.credit, isSystem: true },

    // Revenue (4000-4999) - Credit Normal Balance
    { code: '4010', name: 'Product Sales Revenue', description: 'Revenue from product sales', accountType: AccountType.revenue, normalBalance: NormalBalance.credit, isSystem: true },
    { code: '4020', name: 'Shipping Revenue', description: 'Revenue from shipping fees', accountType: AccountType.revenue, normalBalance: NormalBalance.credit, isSystem: true },

    // Expenses (5000-5999) - Debit Normal Balance
    { code: '5010', name: 'Cost of Goods Sold (COGS)', description: 'Direct costs of products sold', accountType: AccountType.expense, normalBalance: NormalBalance.debit, isSystem: true },
    { code: '5020', name: 'Delivery Expense', description: 'Costs associated with successful deliveries', accountType: AccountType.expense, normalBalance: NormalBalance.debit, isSystem: true },
    { code: '5030', name: 'Failed Delivery Expense', description: 'Costs from failed delivery attempts', accountType: AccountType.expense, normalBalance: NormalBalance.debit, isSystem: true },
    { code: '5040', name: 'Return Processing Expense', description: 'Costs for processing returned items', accountType: AccountType.expense, normalBalance: NormalBalance.debit, isSystem: true },
    { code: '5050', name: 'Operating Expenses', description: 'General operational expenses', accountType: AccountType.expense, normalBalance: NormalBalance.debit, isSystem: true },
  ];

  await prisma.account.createMany({
    data: accounts,
    skipDuplicates: true
  });

  console.log(`✓ Created ${accounts.length} standard accounts`);
}

async function seed() {
  console.log('🌱 Starting comprehensive seed...');

  // Clean database and reset sequences
  await cleanDatabase();
  await resetSequences();

  // ==================== SEED CHART OF ACCOUNTS ====================
  await seedChartOfAccounts();

  // ==================== CREATE USERS ====================
  console.log('\n👥 Creating users...');
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Super Admin
  const superAdmin = await prisma.user.create({
    data: {
      email: 'admin@codadmin.com',
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      phoneNumber: randomPhone(),
      role: 'super_admin',
      isActive: true,
      isAvailable: true,
    }
  });
  console.log(`✓ Created super admin (ID: ${superAdmin.id})`);

  // Admins
  const admins = [];
  for (let i = 1; i <= 2; i++) {
    const admin = await prisma.user.create({
      data: {
        email: `admin${i}@codadmin.com`,
        password: hashedPassword,
        firstName: randomElement(firstNames),
        lastName: randomElement(lastNames),
        phoneNumber: randomPhone(),
        role: 'admin',
        isActive: true,
        isAvailable: true,
      }
    });
    admins.push(admin);
  }
  console.log(`✓ Created ${admins.length} admins`);

  // Managers
  const managers = [];
  for (let i = 1; i <= 2; i++) {
    const manager = await prisma.user.create({
      data: {
        email: `manager${i}@codadmin.com`,
        password: hashedPassword,
        firstName: randomElement(firstNames),
        lastName: randomElement(lastNames),
        phoneNumber: randomPhone(),
        role: 'manager',
        isActive: true,
        isAvailable: true,
      }
    });
    managers.push(manager);
  }
  console.log(`✓ Created ${managers.length} managers`);

  // Customer Reps
  const customerReps = [];
  for (let i = 1; i <= 10; i++) {
    const rep = await prisma.user.create({
      data: {
        email: `rep${i}@codadmin.com`,
        password: hashedPassword,
        firstName: randomElement(firstNames),
        lastName: randomElement(lastNames),
        phoneNumber: randomPhone(),
        role: 'sales_rep',
        commissionAmount: 5 + random() * 5, // 5-10
        isActive: true,
        isAvailable: random() > 0.2, // 80% available
      }
    });
    customerReps.push(rep);
  }
  console.log(`✓ Created ${customerReps.length} customer reps`);

  // Delivery Agents
  const deliveryAgents = [];
  for (let i = 1; i <= 10; i++) {
    const location = randomElement(ghanaLocations);
    const agent = await prisma.user.create({
      data: {
        email: `agent${i}@codadmin.com`,
        password: hashedPassword,
        firstName: randomElement(firstNames),
        lastName: randomElement(lastNames),
        phoneNumber: randomPhone(),
        role: 'delivery_agent',
        vehicleType: randomElement(vehicleTypes),
        vehicleId: `GH-${Math.floor(random() * 10000).toString().padStart(4, '0')}`,
        deliveryRate: 10 + random() * 15, // GHS 10-25 per delivery
        location: `${randomElement(location.cities)}, ${location.region}`,
        isActive: true,
        isAvailable: random() > 0.3, // 70% available
      }
    });
    deliveryAgents.push(agent);
  }
  console.log(`✓ Created ${deliveryAgents.length} delivery agents`);

  // Accountants
  const accountants = [];
  for (let i = 1; i <= 2; i++) {
    const accountant = await prisma.user.create({
      data: {
        email: `accountant${i}@codadmin.com`,
        password: hashedPassword,
        firstName: randomElement(firstNames),
        lastName: randomElement(lastNames),
        phoneNumber: randomPhone(),
        role: 'accountant',
        isActive: true,
        isAvailable: true,
      }
    });
    accountants.push(accountant);
  }
  console.log(`✓ Created ${accountants.length} accountants`);

  // Inventory Managers
  const inventoryManagers = [];
  for (let i = 1; i <= 2; i++) {
    const invManager = await prisma.user.create({
      data: {
        email: `inventory${i}@codadmin.com`,
        password: hashedPassword,
        firstName: randomElement(firstNames),
        lastName: randomElement(lastNames),
        phoneNumber: randomPhone(),
        role: 'inventory_manager',
        isActive: true,
        isAvailable: true,
      }
    });
    inventoryManagers.push(invManager);
  }
  console.log(`✓ Created ${inventoryManagers.length} inventory managers`);

  // ==================== CREATE CUSTOMERS ====================
  console.log('\n👤 Creating customers...');
  const customers = [];
  for (let i = 1; i <= 50; i++) {
    const location = randomElement(ghanaLocations);
    const city = randomElement(location.cities);
    const customer = await prisma.customer.create({
      data: {
        firstName: randomElement(firstNames),
        lastName: randomElement(lastNames),
        email: random() > 0.3 ? `customer${i}@example.com` : undefined,
        phoneNumber: randomPhone(),
        alternatePhone: random() > 0.5 ? randomPhone() : undefined,
        address: `House ${Math.floor(random() * 500) + 1}, Street ${Math.floor(random() * 100)}`,
        state: location.region,
        area: city,
        landmark: random() > 0.5 ? randomElement([
          'Near Police Station', 'Behind Market', 'Near School',
          'Close to Church', 'Opposite Hospital', 'Near Main Road'
        ]) : undefined,
        tags: random() > 0.7 ? ['vip'] : random() > 0.5 ? ['regular'] : [],
        isActive: random() > 0.1, // 90% active
      }
    });
    customers.push(customer);
  }
  console.log(`✓ Created ${customers.length} customers`);

  // ==================== CREATE PRODUCTS ====================
  console.log('\n📦 Creating products...');
  const products = [];
  for (let i = 0; i < productData.length; i++) {
    const data = productData[i];
    const product = await prisma.product.create({
      data: {
        sku: `SKU-${(1000 + i).toString().padStart(4, '0')}`,
        name: data.name,
        description: `High quality ${data.name.toLowerCase()} available for delivery`,
        category: data.category,
        price: data.price,
        cogs: data.cost,
        stockQuantity: Math.floor(random() * 200) + 50,
        lowStockThreshold: 20,
        isActive: random() > 0.1, // 90% active
      }
    });
    products.push(product);
  }
  console.log(`✓ Created ${products.length} products`);

  // ==================== CREATE ORDERS ====================
  console.log('\n🛒 Creating orders...');
  const orderStatuses = [
    'pending_confirmation',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'returned',
    'failed_delivery'
  ];

  const orders = [];
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  for (let i = 1; i <= 120; i++) {
    const customer = randomElement(customers);
    const status = randomElement(orderStatuses) as OrderStatus;
    const rep = randomElement(customerReps);
    const createdAt = randomDate(threeMonthsAgo, new Date());

    // Select 1-4 random products
    const numProducts = Math.floor(random() * 4) + 1;
    const orderProducts = [];
    for (let j = 0; j < numProducts; j++) {
      orderProducts.push(randomElement(products));
    }

    // Calculate totals
    const subtotal = orderProducts.reduce((sum, p) => sum + p.price, 0);
    const shippingCost = 10 + Math.floor(random() * 30); // GHS 10-40
    const discount = random() > 0.7 ? Math.floor(random() * 50) : 0;
    const totalAmount = subtotal + shippingCost - discount;

    // Determine payment status based on order status
    let paymentStatus: 'pending' | 'collected' | 'deposited' | 'reconciled' = 'pending';
    if (status === 'delivered') {
      const rand = random();
      paymentStatus = rand > 0.7 ? 'reconciled' : rand > 0.4 ? 'deposited' : 'collected';
    } else if (status === 'out_for_delivery') {
      paymentStatus = random() > 0.5 ? 'collected' : 'pending';
    }

    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        customerRepId: rep.id,
        status,
        paymentStatus,
        subtotal,
        shippingCost,
        discount,
        totalAmount,
        codAmount: totalAmount,
        deliveryAddress: customer.address,
        deliveryState: customer.state,
        deliveryArea: customer.area,
        priority: Math.floor(random() * 3),
        tags: random() > 0.8 ? ['urgent'] : [],
        source: randomElement(['manual', 'web', 'mobile', 'whatsapp']),
        createdById: superAdmin.id,
        createdAt,
        orderItems: {
          create: orderProducts.map((product) => ({
            productId: product.id,
            quantity: Math.floor(random() * 3) + 1,
            unitPrice: product.price,
            totalPrice: product.price * (Math.floor(random() * 3) + 1),
          }))
        },
      }
    });
    orders.push(order);
  }
  console.log(`✓ Created ${orders.length} orders`);

  // Update customer totals
  console.log('\n📊 Updating customer statistics...');
  for (const customer of customers) {
    const customerOrders = orders.filter(o => o.customerId === customer.id);
    const totalSpent = customerOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        totalOrders: customerOrders.length,
        totalSpent,
      }
    });
  }

  // ==================== CREATE DELIVERIES ====================
  console.log('\n🚚 Creating deliveries...');
  const deliveryOrders = orders.filter(o =>
    ['out_for_delivery', 'delivered', 'failed_delivery'].includes(o.status)
  );

  let deliveryCount = 0;
  for (const order of deliveryOrders) {
    const agent = randomElement(deliveryAgents);
    const scheduledTime = new Date(order.createdAt);
    scheduledTime.setDate(scheduledTime.getDate() + Math.floor(random() * 3) + 1);

    const deliveryData: any = {
      orderId: order.id,
      agentId: agent.id,
      scheduledTime,
      deliveryAttempts: order.status === 'failed_delivery' ? 3 : 1,
    };

    if (order.status === 'delivered') {
      const actualTime = new Date(scheduledTime);
      actualTime.setHours(actualTime.getHours() + Math.floor(random() * 5));
      deliveryData.actualDeliveryTime = actualTime;
      deliveryData.proofType = randomElement(['signature', 'photo', 'otp']);
      deliveryData.proofData = 'Delivered successfully';
      deliveryData.recipientName = `${order.customerId}`;
    } else if (order.status === 'failed_delivery') {
      deliveryData.notes = randomElement([
        'Customer not available',
        'Wrong address provided',
        'Customer refused delivery',
        'Unable to locate address'
      ]);
    }

    await prisma.delivery.create({ data: deliveryData });
    deliveryCount++;

    // Assign delivery agent to order
    await prisma.order.update({
      where: { id: order.id },
      data: { deliveryAgentId: agent.id }
    });
  }
  console.log(`✓ Created ${deliveryCount} deliveries`);

  // ==================== CREATE TRANSACTIONS ====================
  console.log('\n💰 Creating transactions...');
  const paidOrders = orders.filter(o =>
    ['delivered'].includes(o.status) && o.paymentStatus !== 'pending'
  );

  for (const order of paidOrders) {
    await prisma.transaction.create({
      data: {
        orderId: order.id,
        type: 'payment',
        amount: order.codAmount || order.totalAmount,
        paymentMethod: 'cash',
        status: order.paymentStatus,
        reference: `TXN-${order.id}-${Date.now()}`,
        description: `COD payment for order #${order.id}`,
      }
    });
  }
  console.log(`✓ Created ${paidOrders.length} transactions`);

  // ==================== SUMMARY ====================
  console.log('\n✅ Seed completed successfully!');
  console.log('\n📈 Summary:');
  console.log(`   Users: ${1 + admins.length + managers.length + customerReps.length + deliveryAgents.length + accountants.length + inventoryManagers.length}`);
  console.log(`   - Super Admin: 1`);
  console.log(`   - Admins: ${admins.length}`);
  console.log(`   - Managers: ${managers.length}`);
  console.log(`   - Customer Reps: ${customerReps.length}`);
  console.log(`   - Delivery Agents: ${deliveryAgents.length}`);
  console.log(`   - Accountants: ${accountants.length}`);
  console.log(`   - Inventory Managers: ${inventoryManagers.length}`);
  console.log(`   Customers: ${customers.length}`);
  console.log(`   Products: ${products.length}`);
  console.log(`   Orders: ${orders.length}`);
  console.log(`   Deliveries: ${deliveryCount}`);
  console.log(`   Transactions: ${paidOrders.length}`);
  console.log(`   GL Accounts: 15`);
  console.log('\n🔑 Login credentials:');
  console.log('   Email: admin@codadmin.com');
  console.log('   Password: password123');
  console.log('\n   All other users also use password: password123');
}

seed()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
