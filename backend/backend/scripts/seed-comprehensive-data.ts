import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Clear existing data
  console.log('Clearing existing data...');
  await prisma.notification.deleteMany();
  await prisma.workflowExecution.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.webhook.deleteMany();
  await prisma.deliveryProof.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.orderItem.deleteMany();
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
      name: 'Super Admin',
      role: 'super_admin',
      phoneNumber: '+233201234567',
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      password: hashedPassword,
      name: 'Admin User',
      role: 'admin',
      phoneNumber: '+233201234568',
    },
  });

  const manager = await prisma.user.create({
    data: {
      email: 'manager@example.com',
      password: hashedPassword,
      name: 'Manager User',
      role: 'manager',
      phoneNumber: '+233201234569',
    },
  });

  const salesRep1 = await prisma.user.create({
    data: {
      email: 'sales1@example.com',
      password: hashedPassword,
      name: 'Sales Rep 1',
      role: 'sales_rep',
      phoneNumber: '+233201234570',
    },
  });

  const salesRep2 = await prisma.user.create({
    data: {
      email: 'sales2@example.com',
      password: hashedPassword,
      name: 'Sales Rep 2',
      role: 'sales_rep',
      phoneNumber: '+233201234571',
    },
  });

  const deliveryAgent1 = await prisma.user.create({
    data: {
      email: 'delivery1@example.com',
      password: hashedPassword,
      name: 'Delivery Agent 1',
      role: 'delivery_agent',
      phoneNumber: '+233201234572',
    },
  });

  const deliveryAgent2 = await prisma.user.create({
    data: {
      email: 'delivery2@example.com',
      password: hashedPassword,
      name: 'Delivery Agent 2',
      role: 'delivery_agent',
      phoneNumber: '+233201234573',
    },
  });

  const accountant = await prisma.user.create({
    data: {
      email: 'accountant@example.com',
      password: hashedPassword,
      name: 'Accountant User',
      role: 'accountant',
      phoneNumber: '+233201234574',
    },
  });

  const inventoryManager = await prisma.user.create({
    data: {
      email: 'inventory@example.com',
      password: hashedPassword,
      name: 'Inventory Manager',
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
        name: 'John Doe',
        email: 'john.doe@example.com',
        phoneNumber: '+233201111111',
        address: '123 Main St, Accra',
        city: 'Accra',
        region: 'Greater Accra',
        ghanaPostGPS: 'GA-123-4567',
      },
    }),
    prisma.customer.create({
      data: {
        name: 'Jane Smith',
        email: 'jane.smith@example.com',
        phoneNumber: '+233202222222',
        address: '456 Oak Ave, Kumasi',
        city: 'Kumasi',
        region: 'Ashanti',
        ghanaPostGPS: 'AK-456-7890',
      },
    }),
    prisma.customer.create({
      data: {
        name: 'Michael Johnson',
        email: 'michael.j@example.com',
        phoneNumber: '+233203333333',
        address: '789 Elm St, Takoradi',
        city: 'Takoradi',
        region: 'Western',
        ghanaPostGPS: 'WR-789-1234',
      },
    }),
    prisma.customer.create({
      data: {
        name: 'Sarah Williams',
        email: 'sarah.w@example.com',
        phoneNumber: '+233204444444',
        address: '321 Pine Rd, Tema',
        city: 'Tema',
        region: 'Greater Accra',
        ghanaPostGPS: 'GA-321-9876',
      },
    }),
    prisma.customer.create({
      data: {
        name: 'David Brown',
        email: 'david.b@example.com',
        phoneNumber: '+233205555555',
        address: '654 Cedar Ln, Cape Coast',
        city: 'Cape Coast',
        region: 'Central',
        ghanaPostGPS: 'CR-654-5432',
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
      status: 'pending_confirmation',
      paymentMethod: 'cash_on_delivery',
      assignedRepId: salesRep1.id,
      deliveryAddress: customers[0].address,
      deliveryCity: customers[0].city,
      deliveryRegion: customers[0].region,
      notes: 'Customer requested morning delivery',
      orderItems: {
        create: [
          {
            productId: products[0].id,
            quantity: 1,
            unitPrice: 150.00,
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
      status: 'confirmed',
      paymentMethod: 'cash_on_delivery',
      assignedRepId: salesRep1.id,
      deliveryAddress: customers[1].address,
      deliveryCity: customers[1].city,
      deliveryRegion: customers[1].region,
      orderItems: {
        create: [
          {
            productId: products[1].id,
            quantity: 1,
            unitPrice: 250.00,
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
      status: 'preparing',
      paymentMethod: 'cash_on_delivery',
      assignedRepId: salesRep2.id,
      deliveryAddress: customers[2].address,
      deliveryCity: customers[2].city,
      deliveryRegion: customers[2].region,
      orderItems: {
        create: [
          {
            productId: products[2].id,
            quantity: 2,
            unitPrice: 80.00,
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
      status: 'ready_for_pickup',
      paymentMethod: 'cash_on_delivery',
      assignedRepId: salesRep2.id,
      deliveryAddress: customers[3].address,
      deliveryCity: customers[3].city,
      deliveryRegion: customers[3].region,
      orderItems: {
        create: [
          {
            productId: products[3].id,
            quantity: 1,
            unitPrice: 120.00,
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
      status: 'out_for_delivery',
      paymentMethod: 'cash_on_delivery',
      assignedRepId: salesRep1.id,
      deliveryAddress: customers[4].address,
      deliveryCity: customers[4].city,
      deliveryRegion: customers[4].region,
      orderItems: {
        create: [
          {
            productId: products[4].id,
            quantity: 2,
            unitPrice: 45.00,
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
      status: 'delivered',
      paymentMethod: 'cash_on_delivery',
      paymentStatus: 'paid',
      assignedRepId: salesRep2.id,
      deliveryAddress: customers[0].address,
      deliveryCity: customers[0].city,
      deliveryRegion: customers[0].region,
      orderItems: {
        create: [
          {
            productId: products[1].id,
            quantity: 1,
            unitPrice: 250.00,
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
      status: 'in_transit',
      scheduledDate: new Date(Date.now() + 86400000), // Tomorrow
      estimatedDeliveryTime: '10:00-12:00',
    },
  });

  await prisma.delivery.create({
    data: {
      orderId: deliveredOrder.id,
      agentId: deliveryAgent2.id,
      status: 'delivered',
      scheduledDate: new Date(Date.now() - 86400000), // Yesterday
      actualDeliveryDate: new Date(Date.now() - 86400000),
      estimatedDeliveryTime: '14:00-16:00',
      deliveryProof: {
        create: {
          recipientName: customers[0].name,
          signatureUrl: 'https://example.com/signatures/sig1.png',
          photoUrl: 'https://example.com/photos/delivery1.jpg',
          notes: 'Package delivered in good condition',
        },
      },
    },
  });

  console.log('Deliveries created successfully');

  // Create Checkout Form
  console.log('Creating checkout form...');
  await prisma.checkoutForm.create({
    data: {
      name: 'Default Checkout Form',
      slug: 'default',
      description: 'Standard checkout form for all products',
      isActive: true,
      allowedProducts: [products[0].id, products[1].id, products[2].id],
      customFields: [
        {
          name: 'Preferred Delivery Time',
          type: 'select',
          required: false,
          options: ['Morning (8AM-12PM)', 'Afternoon (12PM-4PM)', 'Evening (4PM-8PM)'],
        },
        {
          name: 'Gift Message',
          type: 'textarea',
          required: false,
        },
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
      conditions: [
        {
          field: 'status',
          operator: 'equals',
          value: 'pending_confirmation',
        },
      ],
      actions: [
        {
          type: 'assign_to_rep',
          config: {
            method: 'round_robin',
          },
        },
        {
          type: 'send_notification',
          config: {
            recipient: 'assigned_rep',
            message: 'New order assigned to you',
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
