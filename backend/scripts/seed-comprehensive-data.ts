import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Clear existing data
  console.log('Clearing existing data...');
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
  await prisma.user.deleteMany();

  // Create Users
  console.log('Creating users...');
  const hashedPassword = await bcrypt.hash('password123', 10);

  const superAdmin = await prisma.user.create({
    data: {
      email: 'superadmin@example.com',
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'super_admin',
      phoneNumber: '+233201234567',
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      phoneNumber: '+233201234568',
    },
  });

  const manager = await prisma.user.create({
    data: {
      email: 'manager@example.com',
      password: hashedPassword,
      firstName: 'Manager',
      lastName: 'User',
      role: 'manager',
      phoneNumber: '+233201234569',
    },
  });

  const salesRep1 = await prisma.user.create({
    data: {
      email: 'sales1@example.com',
      password: hashedPassword,
      firstName: 'Sales',
      lastName: 'Rep 1',
      role: 'sales_rep',
      phoneNumber: '+233201234570',
    },
  });

  const salesRep2 = await prisma.user.create({
    data: {
      email: 'sales2@example.com',
      password: hashedPassword,
      firstName: 'Sales',
      lastName: 'Rep 2',
      role: 'sales_rep',
      phoneNumber: '+233201234571',
    },
  });

  const deliveryAgent1 = await prisma.user.create({
    data: {
      email: 'delivery1@example.com',
      password: hashedPassword,
      firstName: 'Delivery',
      lastName: 'Agent 1',
      role: 'delivery_agent',
      phoneNumber: '+233201234572',
      totalCollected: new Decimal(0),
    },
  });

  const deliveryAgent2 = await prisma.user.create({
    data: {
      email: 'delivery2@example.com',
      password: hashedPassword,
      firstName: 'Delivery',
      lastName: 'Agent 2',
      role: 'delivery_agent',
      phoneNumber: '+233201234573',
      totalCollected: new Decimal(0),
    },
  });

  const accountant = await prisma.user.create({
    data: {
      email: 'accountant@example.com',
      password: hashedPassword,
      firstName: 'Accountant',
      lastName: 'User',
      role: 'accountant',
      phoneNumber: '+233201234574',
    },
  });

  const inventoryManager = await prisma.user.create({
    data: {
      email: 'inventory@example.com',
      password: hashedPassword,
      firstName: 'Inventory',
      lastName: 'Manager',
      role: 'inventory_manager',
      phoneNumber: '+233201234575',
    },
  });

  console.log('Users created successfully');

  // Create Products
  console.log('Creating products...');
  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: 'Wireless Headphones',
        description: 'High-quality Bluetooth headphones with noise cancellation',
        price: 150.00,
        sku: 'WH-001',
        category: 'Electronics',
        stockQuantity: 50,
        imageUrl: 'https://picsum.photos/seed/headphones/300/300',
      },
    }),
    prisma.product.create({
      data: {
        name: 'Smart Watch',
        description: 'Fitness tracking smartwatch with heart rate monitor',
        price: 250.00,
        sku: 'SW-001',
        category: 'Electronics',
        stockQuantity: 30,
        imageUrl: 'https://picsum.photos/seed/smartwatch/300/300',
      },
    }),
    prisma.product.create({
      data: {
        name: 'Running Shoes',
        description: 'Comfortable running shoes for all terrains',
        price: 80.00,
        sku: 'RS-001',
        category: 'Sports',
        stockQuantity: 100,
        imageUrl: 'https://picsum.photos/seed/shoes/300/300',
      },
    }),
    prisma.product.create({
      data: {
        name: 'Coffee Maker',
        description: 'Automatic coffee maker with programmable timer',
        price: 120.00,
        sku: 'CM-001',
        category: 'Home Appliances',
        stockQuantity: 25,
        imageUrl: 'https://picsum.photos/seed/coffee/300/300',
      },
    }),
    prisma.product.create({
      data: {
        name: 'Backpack',
        description: 'Durable backpack with laptop compartment',
        price: 45.00,
        sku: 'BP-001',
        category: 'Accessories',
        stockQuantity: 75,
        imageUrl: 'https://picsum.photos/seed/backpack/300/300',
      },
    }),
  ]);

  console.log('Products created successfully');

  // Create Customers
  console.log('Creating customers...');
  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phoneNumber: '+233201111111',
        address: '123 Main St, Accra',
        area: 'Accra',
        state: 'Greater Accra',
      },
    }),
    prisma.customer.create({
      data: {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com',
        phoneNumber: '+233202222222',
        address: '456 Oak Ave, Kumasi',
        area: 'Kumasi',
        state: 'Ashanti',
      },
    }),
    prisma.customer.create({
      data: {
        firstName: 'Michael',
        lastName: 'Johnson',
        email: 'michael.j@example.com',
        phoneNumber: '+233203333333',
        address: '789 Elm St, Takoradi',
        area: 'Takoradi',
        state: 'Western',
      },
    }),
    prisma.customer.create({
      data: {
        firstName: 'Sarah',
        lastName: 'Williams',
        email: 'sarah.w@example.com',
        phoneNumber: '+233204444444',
        address: '321 Pine Rd, Tema',
        area: 'Tema',
        state: 'Greater Accra',
      },
    }),
    prisma.customer.create({
      data: {
        firstName: 'David',
        lastName: 'Brown',
        email: 'david.b@example.com',
        phoneNumber: '+233205555555',
        address: '654 Cedar Ln, Cape Coast',
        area: 'Cape Coast',
        state: 'Central',
      },
    }),
  ]);

  console.log('Customers created successfully');

  // Create Orders with different statuses
  console.log('Creating orders...');

  // Pending orders
  await prisma.order.create({
    data: {
      customerId: customers[0].id,
      totalAmount: 150.00,
      subtotal: 150.00,
      status: 'pending_confirmation',
      customerRepId: salesRep1.id,
      deliveryAddress: customers[0].address,
      deliveryArea: customers[0].area,
      deliveryState: customers[0].state,
      notes: 'Customer requested morning delivery',
      orderItems: {
        create: [
          {
            productId: products[0].id,
            quantity: 1,
            unitPrice: 150.00,
            totalPrice: 150.00,
          },
        ],
      },
    },
  });

  // Confirmed order
  const confirmedOrder = await prisma.order.create({
    data: {
      customerId: customers[1].id,
      totalAmount: 250.00,
      subtotal: 250.00,
      status: 'confirmed',
      customerRepId: salesRep1.id,
      deliveryAddress: customers[1].address,
      deliveryArea: customers[1].area,
      deliveryState: customers[1].state,
      orderItems: {
        create: [
          {
            productId: products[1].id,
            quantity: 1,
            unitPrice: 250.00,
            totalPrice: 250.00,
          },
        ],
      },
    },
  });

  // Preparing order
  await prisma.order.create({
    data: {
      customerId: customers[2].id,
      totalAmount: 160.00,
      subtotal: 160.00,
      status: 'preparing',
      customerRepId: salesRep2.id,
      deliveryAddress: customers[2].address,
      deliveryArea: customers[2].area,
      deliveryState: customers[2].state,
      orderItems: {
        create: [
          {
            productId: products[2].id,
            quantity: 2,
            unitPrice: 80.00,
            totalPrice: 160.00,
          },
        ],
      },
    },
  });

  // Ready for pickup order
  const readyOrder = await prisma.order.create({
    data: {
      customerId: customers[3].id,
      totalAmount: 120.00,
      subtotal: 120.00,
      status: 'ready_for_pickup',
      customerRepId: salesRep2.id,
      deliveryAddress: customers[3].address,
      deliveryArea: customers[3].area,
      deliveryState: customers[3].state,
      orderItems: {
        create: [
          {
            productId: products[3].id,
            quantity: 1,
            unitPrice: 120.00,
            totalPrice: 120.00,
          },
        ],
      },
    },
  });

  // Out for delivery order
  const outForDeliveryOrder = await prisma.order.create({
    data: {
      customerId: customers[4].id,
      totalAmount: 90.00,
      subtotal: 90.00,
      status: 'out_for_delivery',
      customerRepId: salesRep1.id,
      deliveryAddress: customers[4].address,
      deliveryArea: customers[4].area,
      deliveryState: customers[4].state,
      codAmount: 90.00,
      orderItems: {
        create: [
          {
            productId: products[4].id,
            quantity: 2,
            unitPrice: 45.00,
            totalPrice: 90.00,
          },
        ],
      },
    },
  });

  // Delivered order
  const deliveredOrder = await prisma.order.create({
    data: {
      customerId: customers[0].id,
      totalAmount: 250.00,
      subtotal: 250.00,
      status: 'delivered',
      paymentStatus: 'collected',
      customerRepId: salesRep2.id,
      deliveryAddress: customers[0].address,
      deliveryArea: customers[0].area,
      deliveryState: customers[0].state,
      codAmount: 250.00,
      orderItems: {
        create: [
          {
            productId: products[1].id,
            quantity: 1,
            unitPrice: 250.00,
            totalPrice: 250.00,
          },
        ],
      },
    },
  });

  console.log('Orders created successfully');

  // Create Deliveries
  console.log('Creating deliveries...');

  await prisma.delivery.create({
    data: {
      orderId: outForDeliveryOrder.id,
      agentId: deliveryAgent1.id,
      scheduledTime: new Date(Date.now() + 86400000), // Tomorrow
    },
  });

  await prisma.delivery.create({
    data: {
      orderId: deliveredOrder.id,
      agentId: deliveryAgent2.id,
      actualDeliveryTime: new Date(Date.now() - 86400000), // Yesterday
      proofType: 'signature',
      recipientName: customers[0].firstName + ' ' + customers[0].lastName,
      notes: 'Package delivered in good condition',
    },
  });

  console.log('Deliveries created successfully');

  // Create Checkout Form
  console.log('Creating checkout form...');
  await prisma.checkoutForm.create({
    data: {
      name: 'Default Checkout Form',
      slug: 'default',
      productId: products[0].id,
      description: 'Standard checkout form for all products',
      isActive: true,
      fields: {
        shipping: {
          fullName: true,
          phoneNumber: true,
          email: false,
          address: true,
          state: true,
          area: true
        }
      },
      styling: {
        primaryColor: '#000000',
        buttonText: 'Order Now'
      },
      regions: [
        {
          name: 'Greater Accra',
          areas: ['Accra', 'Tema']
        }
      ],
    },
  });

  console.log('Checkout form created successfully');

  // Create Workflow
  console.log('Creating workflow...');
  await prisma.workflow.create({
    data: {
      name: 'Auto-Assign Orders to Sales Reps',
      description: 'Automatically assigns new orders to available sales representatives',
      isActive: true,
      triggerType: 'order_created',
      triggerData: {},
      actions: [
        {
          type: 'assign_to_rep',
          config: {
            method: 'round_robin',
          },
        },
      ],
    },
  });

  console.log('Workflow created successfully');

  console.log('Database seeded successfully!');
  console.log('\nDefault credentials:');
  console.log('Super Admin: superadmin@example.com / password123');
  console.log('Admin: admin@example.com / password123');
  console.log('Manager: manager@example.com / password123');
  console.log('Sales Rep 1: sales1@example.com / password123');
  console.log('Sales Rep 2: sales2@example.com / password123');
  console.log('Delivery Agent 1: delivery1@example.com / password123');
  console.log('Delivery Agent 2: delivery2@example.com / password123');
  console.log('Accountant: accountant@example.com / password123');
  console.log('Inventory Manager: inventory@example.com / password123');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
