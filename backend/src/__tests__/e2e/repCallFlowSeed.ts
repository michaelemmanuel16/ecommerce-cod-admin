import bcrypt from 'bcrypt';
import { prismaBase } from '../../utils/prisma';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { deleteTenantRows } from '../integration/helpers/twoTenants';

export interface SeedResult {
  tenantId: string;
  adminEmail: string;
  repEmail: string;
  password: string;
  order1Id: number;
  order2Id: number;
  pkg1Id: number;
  pkg2Id: number;
  pkg3Id: number;
  addon1Id: number;
  addon2Id: number;
}

export const SEED_PASSWORD = 'password123';

export async function seedRepCallFlow(): Promise<SeedResult> {
  const stamp = Date.now();
  const tenant = await prismaBase.tenant.create({
    data: {
      name: `E2E Rep Flow ${stamp}`,
      slug: `e2e-rep-flow-${stamp}`,
      currency: 'GHS',
    },
  });

  const adminEmail = `e2e-admin-${stamp}@codadmin.test`;
  const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  const admin = await prismaBase.user.create({
    data: {
      email: adminEmail,
      password: hashedPassword,
      firstName: 'Esi',
      lastName: 'Admin',
      role: 'super_admin',
      tenantId: tenant.id,
      preferences: { onboardingCompleted: true },
    },
  });

  await seedTenantDefaults(tenant.id, admin.id);

  // Enable repApp (no workflows are seeded, so no real SMS/WhatsApp is sent)
  await prismaBase.systemConfig.upsert({
    where: { tenantId: tenant.id },
    update: {
      features: { repApp: true },
    },
    create: {
      tenantId: tenant.id,
      features: { repApp: true },
    },
  });

  const repEmail = `e2e-rep-${stamp}@codadmin.test`;
  const rep = await prismaBase.user.create({
    data: {
      email: repEmail,
      password: hashedPassword,
      firstName: 'Adwoa',
      lastName: 'Rep',
      role: 'sales_rep',
      kind: 'person',
      commissionAmount: 8,
      tenantId: tenant.id,
      preferences: { onboardingCompleted: true },
    } as any,
  });

  const agent = await prismaBase.user.create({
    data: {
      email: `e2e-agent-${stamp}@codadmin.test`,
      password: hashedPassword,
      firstName: 'Kofi',
      lastName: 'Agent',
      role: 'delivery_agent',
      tenantId: tenant.id,
      preferences: { onboardingCompleted: true },
    },
  });

  const customer = await prismaBase.customer.create({
    data: {
      firstName: 'Akua',
      lastName: 'Mensah',
      phoneNumber: `+23324${String(stamp).slice(-7)}`,
      alternatePhone: `+23320${String(stamp + 1).slice(-7)}`,
      address: '12 Ring Road Central',
      area: 'Osu',
      state: 'Greater Accra',
      tenantId: tenant.id,
    },
  });

  const product = await prismaBase.product.create({
    data: {
      name: 'Magic Writing Set',
      sku: `MWS-${stamp}`,
      category: 'Stationery',
      price: 249,
      cogs: 80,
      stockQuantity: 500,
      tenantId: tenant.id,
    },
  });

  const form = await prismaBase.checkoutForm.create({
    data: {
      name: 'Magic Writing Set Form',
      slug: `magic-set-${stamp}`,
      productId: product.id,
      fields: {},
      styling: {},
      regions: {},
      tenantId: tenant.id,
    },
  });

  const pkg1 = await prismaBase.formPackage.create({
    data: { formId: form.id, name: '1 Set', price: 249, quantity: 1, isDefault: true, sortOrder: 1 },
  });
  const pkg2 = await prismaBase.formPackage.create({
    data: { formId: form.id, name: '2 Sets', price: 449, quantity: 2, sortOrder: 2 },
  });
  const pkg3 = await prismaBase.formPackage.create({
    data: { formId: form.id, name: '3 Sets', price: 629, quantity: 3, sortOrder: 3 },
  });

  const addon1 = await prismaBase.formUpsell.create({
    data: { formId: form.id, name: 'Refill Pens', price: 40, isActive: true, sortOrder: 1 },
  });
  const addon2 = await prismaBase.formUpsell.create({
    data: { formId: form.id, name: 'Pencil Grip Trainer', price: 35, isActive: true, sortOrder: 2 },
  });

  // Order 1 (Priority 10 so it's first in queue)
  const order1 = await prismaBase.order.create({
    data: {
      customerId: customer.id,
      status: 'pending_confirmation',
      subtotal: 249,
      totalAmount: 249,
      codAmount: 249,
      customerRepId: rep.id,
      deliveryAgentId: agent.id,
      deliveryAddress: '12 Ring Road Central',
      deliveryArea: 'Osu',
      deliveryState: 'Greater Accra',
      priority: 10,
      tenantId: tenant.id,
      orderItems: {
        create: [
          {
            productId: product.id,
            quantity: 1,
            unitPrice: 249,
            totalPrice: 249,
          },
        ],
      },
      formSubmissions: {
        create: [
          {
            formId: form.id,
            selectedPackage: { id: pkg1.id, name: '1 Set', price: 249, quantity: 1 },
            totalAmount: 249,
            formData: {},
            tenantId: tenant.id,
          },
        ],
      },
    } as any,
  });

  // Order 2 (Priority 5, will be next in queue)
  const order2 = await prismaBase.order.create({
    data: {
      customerId: customer.id,
      status: 'pending_confirmation',
      subtotal: 249,
      totalAmount: 249,
      codAmount: 249,
      customerRepId: rep.id,
      deliveryAgentId: agent.id,
      deliveryAddress: '12 Ring Road Central',
      deliveryArea: 'Osu',
      deliveryState: 'Greater Accra',
      priority: 5,
      tenantId: tenant.id,
      orderItems: {
        create: [
          {
            productId: product.id,
            quantity: 1,
            unitPrice: 249,
            totalPrice: 249,
          },
        ],
      },
      formSubmissions: {
        create: [
          {
            formId: form.id,
            selectedPackage: { id: pkg1.id, name: '1 Set', price: 249, quantity: 1 },
            totalAmount: 249,
            formData: {},
            tenantId: tenant.id,
          },
        ],
      },
    } as any,
  });

  return {
    tenantId: tenant.id,
    adminEmail,
    repEmail,
    password: SEED_PASSWORD,
    order1Id: order1.id,
    order2Id: order2.id,
    pkg1Id: pkg1.id,
    pkg2Id: pkg2.id,
    pkg3Id: pkg3.id,
    addon1Id: addon1.id,
    addon2Id: addon2.id,
  };
}

export async function cleanupRepCallFlow(tenantId: string): Promise<void> {
  await deleteTenantRows([tenantId]);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'seed') {
    const result = await seedRepCallFlow();
    console.log(JSON.stringify(result));
  } else if (cmd === 'cleanup' && arg) {
    await cleanupRepCallFlow(arg);
    console.log(`cleaned up ${arg}`);
  } else if (cmd === 'cleanup-all') {
    const left = await prismaBase.tenant.findMany({
      where: { slug: { startsWith: 'e2e-rep-flow-' } },
      select: { id: true },
    });
    if (left.length) {
      await deleteTenantRows(left.map((t) => t.id));
    }
    console.log(`removed ${left.length}`);
  } else {
    throw new Error('usage: seed | cleanup <tenantId> | cleanup-all');
  }
}

if (require.main === module) {
  main()
    .then(() => prismaBase.$disconnect())
    .then(
      () => process.exit(0),
      (e) => {
        console.error(e);
        process.exit(1);
      }
    );
}
