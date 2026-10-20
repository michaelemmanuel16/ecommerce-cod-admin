import { randomBytes } from 'crypto';
import prisma, { prismaBase } from '../../../utils/prisma';
import { runInTenant } from '../../../utils/tenantContext';
import { generateAccessToken } from '../../../utils/jwt';
import { hashApiKey } from '../../../mcp/auth';
import { seedTenantDefaults } from '../../../services/tenantDefaultsService';
import glService from '../../../services/glService';

/**
 * Two-tenant test harness (M0-T27). `createTwoTenants(label)` builds tenants A and B
 * with one row in every tenant-scoped model that has a public or admin read path,
 * so a suite can prove that B's data never reaches A. Rows are written through the
 * un-extended client with an explicit tenantId, the way the migration backfill does.
 * The one posting goes through glService inside the tenant, like a real request.
 *
 * Always call `cleanup()` in afterAll; it deletes only rows of these two tenants.
 *
 * "Partner" has no model of its own: a partner is a `delivery_agent` user.
 */

export type SeedUser = { id: number; email: string; role: string; tenantId: string; token: string };

export interface TestTenant {
  id: string;
  slug: string;
  name: string;
  /** Unique string inside names, SKU, address and notes: scan outputs for it to prove a leak. */
  marker: string;
  phone: string;
  /** Value of the one order, as a string to scan JSON for it. */
  amount: string;
  users: { admin: SeedUser; salesRep: SeedUser; deliveryAgent: SeedUser };
  formSlug: string;
  pixelId: string;
  capiToken: string;
  /** Plain MCP key. Only its hash is stored. */
  mcpKey: string;
  downloadToken: string;
  /** Row ids by model name, as in `ids.order`. */
  ids: Record<string, number>;
}

export interface TwoTenants {
  a: TestTenant;
  b: TestTenant;
  cleanup: () => Promise<void>;
}

/** Run `fn` inside this tenant's context, the way authenticate does for a request. */
export function asTenant<T>(tenant: Pick<TestTenant, 'id'>, fn: () => T | Promise<T>): Promise<T> {
  return runInTenant(tenant.id, fn);
}

async function seedTenant(label: string, side: 'a' | 'b', suffix: string): Promise<TestTenant> {
  const tag = `${label}-${side}-${suffix}`.toLowerCase();
  const marker = `mk${side}${suffix}`;
  const digits = suffix.replace(/\D/g, '').slice(-7).padStart(7, '0');
  const phone = `+23324${side === 'a' ? '1' : '2'}${digits}`;
  const amount = side === 'a' ? '111.11' : '222.22';

  const tenant = await prismaBase.tenant.create({ data: { name: `Two ${side.toUpperCase()} ${tag}`, slug: `two-${tag}` } });
  const tenantId = tenant.id;
  const ids: Record<string, number> = {};

  const mkUser = async (kind: string, role: 'admin' | 'sales_rep' | 'delivery_agent'): Promise<SeedUser> => {
    const u = await prismaBase.user.create({
      data: {
        email: `${kind}-${tag}@codadmin.test`,
        password: 'x',
        firstName: `${kind}${marker}`,
        lastName: `Last${marker}`,
        role,
        tenantId,
      },
    });
    const token = generateAccessToken({ id: u.id, email: u.email, role, tenantId });
    return { id: u.id, email: u.email, role, tenantId, token };
  };
  const admin = await mkUser('admin', 'admin');
  const salesRep = await mkUser('rep', 'sales_rep');
  const deliveryAgent = await mkUser('agent', 'delivery_agent');
  ids.user = admin.id;

  await prismaBase.systemConfig.create({
    data: { tenantId, businessName: `Biz ${side.toUpperCase()} ${marker}`, currency: side === 'a' ? 'GHS' : 'NGN' },
  });

  const customer = await prismaBase.customer.create({
    data: {
      firstName: `Cust${marker}`, lastName: 'Buyer', phoneNumber: phone, email: `cust-${tag}@codadmin.test`,
      address: `1 ${marker} Street`, state: 'Greater Accra', area: 'Accra', tenantId,
    },
  });
  ids.customer = customer.id;

  const product = await prismaBase.product.create({
    data: { name: `Prod ${marker}`, sku: `SKU-${marker}`, category: 'test', price: 50, stockQuantity: 100, tenantId },
  });
  ids.product = product.id;

  const pixelId = `${side === 'a' ? '1111' : '2222'}${digits}`;
  const capiToken = `capi-${marker}`;
  const formSlug = `form-${tag}`;
  const form = await prismaBase.checkoutForm.create({
    data: {
      name: `Form ${marker}`, slug: formSlug, productId: product.id, fields: [], styling: {}, regions: [],
      pixelConfig: { facebookPixelId: pixelId }, metaCapiAccessToken: capiToken, tenantId,
    },
  });
  ids.checkoutForm = form.id;

  const order = await prismaBase.order.create({
    data: {
      customerId: customer.id, customerRepId: salesRep.id, deliveryAgentId: deliveryAgent.id, status: 'out_for_delivery',
      subtotal: amount, shippingCost: 0, totalAmount: amount, codAmount: amount,
      deliveryAddress: `1 ${marker} Street`, deliveryState: 'Greater Accra', deliveryArea: 'Accra',
      notes: `note ${marker}`, tenantId,
      orderItems: { create: [{ productId: product.id, quantity: 1, unitPrice: amount, totalPrice: amount }] },
    },
  });
  ids.order = order.id;

  ids.orderHistory = (await prismaBase.orderHistory.create({
    data: { orderId: order.id, status: 'out_for_delivery', notes: `history ${marker}`, tenantId },
  })).id;
  ids.delivery = (await prismaBase.delivery.create({
    data: { orderId: order.id, agentId: deliveryAgent.id, scheduledTime: new Date(), notes: `delivery ${marker}`, tenantId },
  })).id;
  ids.agentCollection = (await prismaBase.agentCollection.create({
    data: { orderId: order.id, agentId: deliveryAgent.id, amount, collectionDate: new Date(), notes: `collection ${marker}`, tenantId },
  })).id;
  ids.agentDeposit = (await prismaBase.agentDeposit.create({
    data: {
      agentId: deliveryAgent.id, amount: '50', depositDate: new Date(), depositMethod: 'cash',
      referenceNumber: `dep-${tag}`, notes: `deposit ${marker}`, tenantId,
    },
  })).id;
  ids.agentAgingBucket = (await prismaBase.agentAgingBucket.create({
    data: { agentId: deliveryAgent.id, totalBalance: amount, bucket_8_plus: amount, tenantId },
  })).id;
  ids.agentBalance = (await prismaBase.agentBalance.create({
    data: { agentId: deliveryAgent.id, totalCollected: amount, currentBalance: amount, tenantId },
  })).id;
  ids.payout = (await prismaBase.payout.create({
    data: { repId: salesRep.id, amount: '20', method: 'cash', notes: `payout ${marker}`, tenantId },
  })).id;
  ids.call = (await prismaBase.call.create({
    data: { orderId: order.id, customerId: customer.id, salesRepId: salesRep.id, outcome: 'confirmed', notes: `call ${marker}`, tenantId },
  })).id;

  const webhookConfig = await prismaBase.webhookConfig.create({
    data: { name: `Hook ${marker}`, url: `https://example.test/${tag}`, secret: `secret-${marker}`, fieldMapping: {}, tenantId },
  });
  ids.webhookConfig = webhookConfig.id;
  ids.webhookLog = (await prismaBase.webhookLog.create({
    data: { webhookConfigId: webhookConfig.id, endpoint: `/hook/${marker}`, method: 'POST', headers: {}, body: { marker }, tenantId },
  })).id;
  ids.webhookEvent = (await prismaBase.webhookEvent.create({
    data: { provider: 'paystack', eventType: 'charge.success', reference: `ref-${tag}`, payloadHash: `hash-${tag}`, tenantId },
  })).id;
  ids.smsTemplate = (await prismaBase.smsTemplate.create({
    data: { name: `SMS ${marker}`, body: `Hello ${marker}`, tenantId },
  })).id;

  const downloadToken = randomBytes(16).toString('hex');
  ids.downloadToken = (await prismaBase.downloadToken.create({
    data: { orderId: order.id, token: downloadToken, expiresAt: new Date(Date.now() + 3_600_000), tenantId },
  })).id;
  ids.formSubmission = (await prismaBase.formSubmission.create({
    data: {
      formId: form.id, orderId: order.id, formData: { marker }, selectedPackage: { name: 'one' },
      totalAmount: amount, tenantId,
    },
  })).id;
  ids.productCostEntry = (await prismaBase.product_cost_entries.create({
    data: { product_id: product.id, amount: '30', description: `cost ${marker}`, updated_at: new Date(), tenantId },
  })).id;
  ids.notification = (await prismaBase.notification.create({
    data: { userId: admin.id, type: 'info', title: `Note ${marker}`, message: `message ${marker}`, tenantId },
  })).id;
  ids.pendingCheckout = (await prismaBase.pendingCheckout.create({
    data: {
      reference: `pc-${tag}`, tenantId, customerId: customer.id, formId: form.id, paymentMethod: 'paystack_full',
      orderType: 'physical', currency: 'GHS', subtotal: amount, totalAmount: amount, paystackChargeMinor: 100,
      orderItems: [], formData: { marker }, selectedPackage: { name: 'one' },
    },
  })).id;
  const workflow = await prismaBase.workflow.create({
    data: { name: `Flow ${marker}`, triggerType: 'manual', triggerData: {}, actions: [], tenantId },
  });
  ids.workflow = workflow.id;
  ids.workflowExecution = (await prismaBase.workflowExecution.create({
    data: { workflowId: workflow.id, status: 'completed', input: { marker }, tenantId },
  })).id;

  const mcpKey = `mcp_${randomBytes(16).toString('hex')}`;
  await prismaBase.mcpApiKey.create({
    data: { tenantId, keyHash: hashApiKey(mcpKey), keyPrefix: mcpKey.slice(0, 8), label: `key ${marker}` },
  });

  // Chart of accounts, then one posting: cash in hand against product revenue.
  await seedTenantDefaults(tenantId);
  const posting = await runInTenant(tenantId, async () => {
    const accounts = await prisma.account.findMany({ where: { code: { in: ['1010', '4010'] } } });
    const byCode = (code: string) => accounts.find((x) => x.code === code)!.id;
    ids.account = byCode('4010');
    return glService.createJournalEntry(
      {
        entryDate: new Date(),
        description: `Sale ${marker}`,
        sourceType: 'manual',
        transactions: [
          { accountId: byCode('1010'), debitAmount: amount, creditAmount: 0 },
          { accountId: byCode('4010'), debitAmount: 0, creditAmount: amount },
        ],
      },
      { id: admin.id } as any
    );
  });
  ids.journalEntry = posting.id;
  ids.accountTransaction = posting.transactions[0].id;
  ids.auditLog = (await prismaBase.auditLog.create({
    data: { userId: admin.id, action: 'test_seed', resource: 'order', resourceId: String(order.id), metadata: { marker }, tenantId },
  })).id;

  return {
    id: tenantId, slug: tenant.slug, name: tenant.name, marker, phone, amount,
    users: { admin, salesRep, deliveryAgent },
    formSlug, pixelId, capiToken, mcpKey, downloadToken, ids,
  };
}

/** Delete every row of these tenants, children first, then the tenants. */
async function deleteTenants(tenantIds: string[]): Promise<void> {
  const t = { tenantId: { in: tenantIds } };
  await prismaBase.orderItem.deleteMany({ where: { order: t } });
  await prismaBase.formSubmission.deleteMany({ where: t });
  await prismaBase.downloadToken.deleteMany({ where: t });
  await prismaBase.call.deleteMany({ where: t });
  await prismaBase.orderHistory.deleteMany({ where: t });
  await prismaBase.agentCollection.deleteMany({ where: t });
  await prismaBase.delivery.deleteMany({ where: t });
  await prismaBase.messageLog.deleteMany({ where: t });
  await prismaBase.order.deleteMany({ where: t });
  await prismaBase.payout.deleteMany({ where: t });
  await prismaBase.agentDeposit.deleteMany({ where: t });
  await prismaBase.agentAgingBucket.deleteMany({ where: t });
  await prismaBase.agentBalance.deleteMany({ where: t });
  await prismaBase.accountTransaction.deleteMany({ where: t });
  await prismaBase.journalEntry.deleteMany({ where: t });
  await prismaBase.account.deleteMany({ where: { tenantId: { in: tenantIds }, parentId: { not: null } } });
  await prismaBase.account.deleteMany({ where: t });
  await prismaBase.product_cost_entries.deleteMany({ where: t });
  await prismaBase.pendingCheckout.deleteMany({ where: t });
  await prismaBase.checkoutForm.deleteMany({ where: t });
  await prismaBase.product.deleteMany({ where: t });
  await prismaBase.customer.deleteMany({ where: t });
  await prismaBase.webhookLog.deleteMany({ where: t });
  await prismaBase.webhookConfig.deleteMany({ where: t });
  await prismaBase.webhookEvent.deleteMany({ where: t });
  await prismaBase.workflowExecution.deleteMany({ where: t });
  await prismaBase.workflow.deleteMany({ where: t });
  await prismaBase.notification.deleteMany({ where: t });
  await prismaBase.auditLog.deleteMany({ where: t });
  await prismaBase.smsTemplate.deleteMany({ where: t });
  await prismaBase.emailTemplate.deleteMany({ where: t });
  await prismaBase.mcpApiKey.deleteMany({ where: t });
  await prismaBase.systemConfig.deleteMany({ where: t });
  await prismaBase.user.deleteMany({ where: t });
  await prismaBase.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

export async function createTwoTenants(label: string): Promise<TwoTenants> {
  const suffix = String(Date.now());
  const tenantIds: string[] = [];
  const results = await Promise.allSettled([seedTenant(label, 'a', suffix), seedTenant(label, 'b', suffix)]);
  const [a, b] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
  // A half-built pair must not leave rows behind: find the tenants by slug and wipe them.
  if (!a || !b) {
    const half = await prismaBase.tenant.findMany({ where: { slug: { in: [`two-${label}-a-${suffix}`, `two-${label}-b-${suffix}`].map((s) => s.toLowerCase()) } } });
    await deleteTenants(half.map((x) => x.id));
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    throw failed.reason;
  }
  tenantIds.push(a.id, b.id);
  return { a, b, cleanup: () => deleteTenants(tenantIds) };
}
