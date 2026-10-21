import { randomBytes } from 'crypto';
import prisma, { prismaBase } from '../../../utils/prisma';
import { runInTenant } from '../../../utils/tenantContext';
import { generateAccessToken } from '../../../utils/jwt';
import { hashApiKey } from '../../../mcp/auth';
import { seedTenantDefaults } from '../../../services/tenantDefaultsService';
import glService from '../../../services/glService';
import { clearSystemUserIdCache } from '../../../services/systemUserService';

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

export type SeedUser = { id: number; email: string; role: string; token: string };

export interface TestTenant {
  id: string;
  slug: string;
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

let tenantSeq = 0;

/** One bare tenant for a suite that seeds its own rows. Slug and name are unique per call. Pair with deleteTenantRows. */
export function createTenant(label: string, extra: { currency?: string } = {}) {
  const suffix = `${Date.now()}-${tenantSeq++}`;
  return prismaBase.tenant.create({
    data: { name: `${label} ${suffix}`, slug: `${label.toLowerCase().replace(/\s+/g, '-')}-${suffix}`, ...extra },
  });
}

/** Run one wave of independent creates. Waits for all of them, so a failure never leaves a write in flight behind the cleanup. */
async function wave<T extends readonly unknown[]>(promises: readonly [...{ [K in keyof T]: Promise<T[K]> }]): Promise<T> {
  const results = await Promise.allSettled(promises);
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (failed) throw failed.reason;
  return results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as unknown as T;
}

async function seedTenant(label: string, side: 'a' | 'b', suffix: string): Promise<TestTenant> {
  const tag = `${label}-${side}-${suffix}`.toLowerCase();
  const marker = `mk${side}${suffix}`;
  const digits = suffix.replace(/\D/g, '').slice(-7).padStart(7, '0');
  const phone = `+23324${side === 'a' ? '1' : '2'}${digits}`;
  const amount = side === 'a' ? '111.11' : '222.22';
  const pixelId = `${side === 'a' ? '1111' : '2222'}${digits}`;
  const capiToken = `capi-${marker}`;
  const formSlug = `form-${tag}`;
  const mcpKey = `mcp_${randomBytes(16).toString('hex')}`;
  const downloadToken = randomBytes(16).toString('hex');

  const tenant = await prismaBase.tenant.create({ data: { name: `Two ${side.toUpperCase()} ${tag}`, slug: `two-${tag}`, currency: side === 'a' ? 'GHS' : 'NGN' } });
  const tenantId = tenant.id;
  const ids: Record<string, number> = {};
  /** Create a row and record its id under `key`. */
  const seed = <R extends { id: number }>(key: string, row: Promise<R>): Promise<R> =>
    row.then((r) => { ids[key] = r.id; return r; });

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
    return { id: u.id, email: u.email, role, token };
  };

  // Wave 1: rows that need only the tenant.
  const [admin, salesRep, deliveryAgent, customer, product, webhookConfig, workflow] = await wave([
    mkUser('admin', 'admin'),
    mkUser('rep', 'sales_rep'),
    mkUser('agent', 'delivery_agent'),
    seed('customer', prismaBase.customer.create({
      data: {
        firstName: `Cust${marker}`, lastName: 'Buyer', phoneNumber: phone, email: `cust-${tag}@codadmin.test`,
        address: `1 ${marker} Street`, state: 'Greater Accra', area: 'Accra', tenantId,
      },
    })),
    seed('product', prismaBase.product.create({
      data: { name: `Prod ${marker}`, sku: `SKU-${marker}`, category: 'test', price: 50, stockQuantity: 100, tenantId },
    })),
    seed('webhookConfig', prismaBase.webhookConfig.create({
      data: { name: `Hook ${marker}`, url: `https://example.test/${tag}`, secret: `secret-${marker}`, fieldMapping: {}, tenantId },
    })),
    seed('workflow', prismaBase.workflow.create({
      data: { name: `Flow ${marker}`, triggerType: 'manual', triggerData: {}, actions: [], tenantId },
    })),
    prismaBase.systemConfig.create({
      data: { tenantId, businessName: `Biz ${side.toUpperCase()} ${marker}` },
    }),
    seed('smsTemplate', prismaBase.smsTemplate.create({ data: { name: `SMS ${marker}`, body: `Hello ${marker}`, tenantId } })),
    seed('webhookEvent', prismaBase.webhookEvent.create({
      data: { provider: 'paystack', eventType: 'charge.success', reference: `ref-${tag}`, payloadHash: `hash-${tag}`, tenantId },
    })),
    // Full chart of accounts: suites read it, and the posting in wave 2 needs it.
    seedTenantDefaults(tenantId),
  ]);
  ids.user = admin.id;

  // Wave 2: rows that need a user, the customer, the product, a config or the chart.
  const [form, order, posting] = await wave([
    seed('checkoutForm', prismaBase.checkoutForm.create({
      data: {
        name: `Form ${marker}`, slug: formSlug, productId: product.id, fields: [], styling: {}, regions: [],
        pixelConfig: { facebookPixelId: pixelId }, metaCapiAccessToken: capiToken, tenantId,
      },
    })),
    seed('order', prismaBase.order.create({
      data: {
        customerId: customer.id, customerRepId: salesRep.id, deliveryAgentId: deliveryAgent.id, status: 'out_for_delivery',
        subtotal: amount, shippingCost: 0, totalAmount: amount, codAmount: amount,
        deliveryAddress: `1 ${marker} Street`, deliveryState: 'Greater Accra', deliveryArea: 'Accra',
        notes: `note ${marker}`, tenantId,
        orderItems: { create: [{ productId: product.id, quantity: 1, unitPrice: amount, totalPrice: amount }] },
      },
    })),
    // One posting inside the tenant, like a real request: cash in hand against product revenue.
    runInTenant(tenantId, async () => {
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
    }),
    seed('agentDeposit', prismaBase.agentDeposit.create({
      data: {
        agentId: deliveryAgent.id, amount: '50', depositDate: new Date(), depositMethod: 'cash',
        referenceNumber: `dep-${tag}`, notes: `deposit ${marker}`, tenantId,
      },
    })),
    seed('agentAgingBucket', prismaBase.agentAgingBucket.create({
      data: { agentId: deliveryAgent.id, totalBalance: amount, bucket_8_plus: amount, tenantId },
    })),
    seed('agentBalance', prismaBase.agentBalance.create({
      data: { agentId: deliveryAgent.id, totalCollected: amount, currentBalance: amount, tenantId },
    })),
    seed('payout', prismaBase.payout.create({
      data: { repId: salesRep.id, amount: '20', method: 'cash', notes: `payout ${marker}`, tenantId },
    })),
    seed('webhookLog', prismaBase.webhookLog.create({
      data: { webhookConfigId: webhookConfig.id, endpoint: `/hook/${marker}`, method: 'POST', headers: {}, body: { marker }, tenantId },
    })),
    seed('workflowExecution', prismaBase.workflowExecution.create({
      data: { workflowId: workflow.id, status: 'completed', input: { marker }, tenantId },
    })),
    seed('productCostEntry', prismaBase.product_cost_entries.create({
      data: { product_id: product.id, amount: '30', description: `cost ${marker}`, updated_at: new Date(), tenantId },
    })),
    seed('notification', prismaBase.notification.create({
      data: { userId: admin.id, type: 'info', title: `Note ${marker}`, message: `message ${marker}`, tenantId },
    })),
    // M1 models
    seed('target', prismaBase.target.create({
      data: {
        scope: 'month', metric: `revenue-${marker}`, unit: 'currency', periodStart: new Date('2026-10-01'),
        periodEnd: new Date('2026-10-31'), value: amount, userId: admin.id, tenantId,
      },
    })),
    seed('finding', prismaBase.finding.create({
      data: { type: 'ledger_gap', subjectType: 'day', subjectId: `2026-10-01-${marker}`, amount, note: `finding ${marker}`, tenantId },
    })),
    seed('feeRule', prismaBase.feeRule.create({
      data: { partnerUserId: deliveryAgent.id, outcome: 'delivered', amount: '25', tenantId },
    })),
    seed('fxRate', prismaBase.fxRate.create({
      data: { fromCurrency: 'GHS', toCurrency: 'NGN', rate: '112', date: new Date('2026-10-01'), source: 'auto', createdById: admin.id, tenantId },
    })),
  ]);
  ids.order = order.id;
  ids.journalEntry = posting.id;
  ids.accountTransaction = posting.transactions[0].id;

  // Wave 3: rows that need the order or the form.
  await wave([
    seed('orderHistory', prismaBase.orderHistory.create({
      data: { orderId: order.id, status: 'out_for_delivery', notes: `history ${marker}`, tenantId },
    })),
    seed('delivery', prismaBase.delivery.create({
      data: { orderId: order.id, agentId: deliveryAgent.id, scheduledTime: new Date(), notes: `delivery ${marker}`, tenantId },
    })),
    seed('agentCollection', prismaBase.agentCollection.create({
      data: { orderId: order.id, agentId: deliveryAgent.id, amount, collectionDate: new Date(), notes: `collection ${marker}`, tenantId },
    })),
    seed('call', prismaBase.call.create({
      data: { orderId: order.id, customerId: customer.id, salesRepId: salesRep.id, outcome: 'confirmed', notes: `call ${marker}`, tenantId },
    })),
    seed('downloadToken', prismaBase.downloadToken.create({
      data: { orderId: order.id, token: downloadToken, expiresAt: new Date(Date.now() + 3_600_000), tenantId },
    })),
    seed('formSubmission', prismaBase.formSubmission.create({
      data: {
        formId: form.id, orderId: order.id, formData: { marker }, selectedPackage: { name: 'one' },
        totalAmount: amount, tenantId,
      },
    })),
    seed('pendingCheckout', prismaBase.pendingCheckout.create({
      data: {
        reference: `pc-${tag}`, tenantId, customerId: customer.id, formId: form.id, paymentMethod: 'paystack_full',
        orderType: 'physical', currency: 'GHS', subtotal: amount, totalAmount: amount, paystackChargeMinor: 100,
        orderItems: [], formData: { marker }, selectedPackage: { name: 'one' },
      },
    })),
    seed('auditLog', prismaBase.auditLog.create({
      data: { userId: admin.id, action: 'test_seed', resource: 'order', resourceId: String(order.id), metadata: { marker }, tenantId },
    })),
  ]);

  // Roles come from seedTenantDefaults in wave 1; the harness adds one assignment (admin holds Owner).
  const ownerRole = await prismaBase.role.findFirstOrThrow({ where: { tenantId, name: 'Owner' } });
  ids.role = ownerRole.id;
  await seed('roleAssignment', prismaBase.roleAssignment.create({
    data: { tenantId, roleId: ownerRole.id, holderId: admin.id, fromDate: new Date() },
  }));

  // The MCP key acts as an ai_agent user. super_admin holds every permission cell and the Legacy role lists all
  // 14 tools, so suites that call every tool work. A suite that tests a narrower key makes its own user, role and key.
  const legacyRole = await prismaBase.role.findFirstOrThrow({ where: { tenantId, name: 'Legacy MCP (14 tools)' } });
  const mcpUserRow = await prismaBase.user.create({
    data: {
      email: `mcp-${tag}@codadmin.test`, password: 'x', firstName: `mcp${marker}`, lastName: `Last${marker}`,
      role: 'super_admin', kind: 'ai_agent', tenantId,
    },
  });
  await prismaBase.mcpApiKey.create({
    data: { tenantId, keyHash: hashApiKey(mcpKey), keyPrefix: mcpKey.slice(0, 8), label: `key ${marker}`, userId: mcpUserRow.id, roleId: legacyRole.id },
  });
  ids.mcpUser = mcpUserRow.id;
  ids.legacyRole = legacyRole.id;

  return {
    id: tenantId, slug: tenant.slug, marker, phone, amount,
    users: { admin, salesRep, deliveryAgent },
    formSlug, pixelId, capiToken, mcpKey, downloadToken, ids,
  };
}

/** Await Prisma queries one after another. Prisma queries are lazy, so none starts before its turn. */
async function inSequence(queries: PromiseLike<unknown>[]): Promise<void> {
  for (const query of queries) await query;
}

/** Delete every row of these tenants, one dependency level at a time (children first), then the tenants. */
export async function deleteTenantRows(tenantIds: string[]): Promise<void> {
  clearSystemUserIdCache(); // a cached system user id must not outlive its tenant
  const t = { tenantId: { in: tenantIds } };
  const db = prismaBase;
  // Each level only depends on the ones above it. Deletes run one at a time: rows in the
  // same level can still reference each other, and parallel deletes of linked tables deadlock (COD-130).
  await inSequence([
    db.orderItem.deleteMany({ where: { order: t } }),
    db.formSubmission.deleteMany({ where: t }),
    db.pendingCheckout.deleteMany({ where: t }),
    db.downloadToken.deleteMany({ where: t }),
    db.call.deleteMany({ where: t }),
    db.orderHistory.deleteMany({ where: t }),
    db.agentCollection.deleteMany({ where: t }),
    db.delivery.deleteMany({ where: t }),
    db.messageLog.deleteMany({ where: t }),
    db.payout.deleteMany({ where: t }),
    db.agentDeposit.deleteMany({ where: t }),
    db.agentAgingBucket.deleteMany({ where: t }),
    db.agentBalance.deleteMany({ where: t }),
    db.accountTransaction.deleteMany({ where: t }),
    db.transaction.deleteMany({ where: t }),
    db.product_cost_entries.deleteMany({ where: t }),
    db.webhookLog.deleteMany({ where: t }),
    db.webhookEvent.deleteMany({ where: t }),
    db.workflowExecution.deleteMany({ where: t }),
    db.notification.deleteMany({ where: t }),
    db.auditLog.deleteMany({ where: t }),
    db.smsTemplate.deleteMany({ where: t }),
    db.emailTemplate.deleteMany({ where: t }),
    db.mcpApiKey.deleteMany({ where: t }),
    db.systemConfig.deleteMany({ where: t }),
    db.target.deleteMany({ where: t }),
    db.finding.deleteMany({ where: t }),
    db.feeRule.deleteMany({ where: t }),
    db.fxRate.deleteMany({ where: t }),
    db.roleAssignment.deleteMany({ where: t }),
  ]);
  await inSequence([
    db.order.deleteMany({ where: t }),
    db.checkoutForm.deleteMany({ where: t }),
    db.workflow.deleteMany({ where: t }),
    db.webhookConfig.deleteMany({ where: t }),
    db.account.deleteMany({ where: { ...t, parentId: { not: null } } }),
    db.journalEntry.deleteMany({ where: t }),
    db.role.deleteMany({ where: t }),
  ]);
  await inSequence([
    db.product.deleteMany({ where: t }),
    db.customer.deleteMany({ where: t }),
    db.account.deleteMany({ where: t }),
    db.user.deleteMany({ where: t }),
  ]);
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

export async function createTwoTenants(label: string): Promise<TwoTenants> {
  const suffix = String(Date.now());
  const results = await Promise.allSettled([seedTenant(label, 'a', suffix), seedTenant(label, 'b', suffix)]);
  const [a, b] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
  // A half-built pair must not leave rows behind: find the tenants by slug and wipe them.
  if (!a || !b) {
    const half = await prismaBase.tenant.findMany({ where: { slug: { in: [`two-${label}-a-${suffix}`, `two-${label}-b-${suffix}`].map((s) => s.toLowerCase()) } } });
    await deleteTenantRows(half.map((x) => x.id));
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    throw failed.reason;
  }
  return { a, b, cleanup: () => deleteTenantRows([a.id, b.id]) };
}
