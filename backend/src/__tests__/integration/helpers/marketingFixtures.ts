import { prismaBase } from '../../../utils/prisma';
import { utcDateOfYmd } from '../../../services/kpi/dates';

/** Seed helpers for the M8 marketing suites (T10 KPI, T11 funnel). Rows go in through the un-extended client with a tenantId. */
export const at = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

export const mkProduct = (tenantId: string, sku: string, cogs: number) =>
  prismaBase.product.create({ data: { tenantId, sku, name: sku, category: 'test', price: 100, stockQuantity: 0, cogs } }).then((p) => p.id);

export const spendRow = (
  tenantId: string, adAccountId: number, ymd: string, campaign: string, spend: number,
  extra: { campaignStatus?: string; purchases?: number; impressions?: number; linkClicks?: number; landingPageViews?: number; checkoutsStarted?: number; currency?: string } = {},
) => prismaBase.metaSpendDay.create({
  data: { adAccountId, campaignId: campaign, campaignName: campaign, date: utcDateOfYmd(ymd), currency: 'NGN', spend, pulledAt: new Date(), tenantId, ...extra },
});

/** Orders of one product with the PRD numbers (total 249, fee 34, landed cost 30), created on `ymd`. Returns their ids. */
export async function seedOrders(
  tenantId: string, customerId: number, productId: number, ymd: string,
  status: 'delivered' | 'failed_delivery' | 'cancelled' | 'confirmed' | 'pending_confirmation', count: number, opts: { total?: number } = {},
) {
  const total = opts.total ?? 249;
  await prismaBase.order.createMany({
    data: Array.from({ length: count }, () => ({
      customerId, tenantId, status, subtotal: total, totalAmount: total, codAmount: total, createdAt: at(ymd),
      deliveryFee: 34, landedCostTotal: 30, ...(status === 'delivered' ? { deliveryDate: at(ymd) } : {}),
    })),
  });
  const ids = (await prismaBase.order.findMany({ where: { tenantId, status, createdAt: at(ymd), totalAmount: total, orderItems: { none: {} } }, select: { id: true }, orderBy: { id: 'desc' }, take: count })).map((o) => o.id);
  await prismaBase.orderItem.createMany({ data: ids.map((orderId) => ({ orderId, productId, quantity: 1, unitPrice: total, totalPrice: total })) });
  return ids;
}
