/**
 * Campaign to product mapping (M8-T09, COD-73).
 *
 * A Meta campaign belongs to a product by one of two rules:
 *   campaign  a one-off pick for one (ad account, campaign). It always wins.
 *   prefix    a name rule: the longest prefix that starts the campaign name (trimmed, case-insensitive).
 * No match means the campaign is "Not mapped"; its spend still counts in the totals.
 * An archived product (isActive false) still receives the mapping; `archived` drives a warning in the UI.
 */
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import { withSoftDeleted } from '../../utils/prismaExtensions';
import { resolveTenantId } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { utcDateOfYmd } from '../kpi/dates';

export interface CampaignRef {
  adAccountId: number;
  campaignId: string;
  campaignName: string;
}

export interface ResolvedProduct {
  productId: number;
  productName: string;
  via: 'campaign' | 'prefix';
  archived: boolean;
}

interface ProductInfo { id: number; name: string; isActive: boolean }
export interface PrefixRule { prefix: string; product: ProductInfo }
export interface CampaignPick { adAccountId: number; campaignId: string; product: ProductInfo }

export const campaignKey = (adAccountId: number, campaignId: string): string => `${adAccountId}:${campaignId}`;

const norm = (s: string): string => s.trim().toLowerCase();

const resolved = (product: ProductInfo, via: ResolvedProduct['via']): ResolvedProduct => ({
  productId: product.id,
  productName: product.name,
  via,
  archived: !product.isActive,
});

/** Pure resolution: a pick beats a rule, the longest matching prefix wins, no match gives null. */
export function resolveWith(
  campaigns: CampaignRef[],
  rules: PrefixRule[],
  picks: CampaignPick[],
): Map<string, ResolvedProduct | null> {
  const pickByKey = new Map(picks.map((p) => [campaignKey(p.adAccountId, p.campaignId), p]));
  const sorted = rules
    .map((r) => ({ prefix: norm(r.prefix), product: r.product }))
    .filter((r) => r.prefix !== '')
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const out = new Map<string, ResolvedProduct | null>();
  for (const c of campaigns) {
    const key = campaignKey(c.adAccountId, c.campaignId);
    const pick = pickByKey.get(key);
    if (pick) {
      out.set(key, resolved(pick.product, 'campaign'));
      continue;
    }
    const name = norm(c.campaignName);
    const rule = sorted.find((r) => name.startsWith(r.prefix));
    out.set(key, rule ? resolved(rule.product, 'prefix') : null);
  }
  return out;
}

const productSelect = { select: { id: true, name: true, isActive: true } } as const;

/** Rules and picks of the tenant, with their products (archived ones included). Two reads. */
async function loadMappings() {
  return withSoftDeleted(async () => {
    const [rules, picks] = await Promise.all([
      prisma.metaCampaignMapping.findMany({
        where: { kind: 'prefix' },
        include: { product: productSelect },
        orderBy: { id: 'asc' },
      }),
      prisma.metaCampaignMapping.findMany({
        where: { kind: 'campaign' },
        include: { product: productSelect },
        orderBy: { id: 'asc' },
      }),
    ]);
    return { rules, picks };
  });
}

/** Map of `campaignKey()` to the product a campaign belongs to, or null. One read for rules, one for picks. */
export async function resolveProducts(campaigns: CampaignRef[]): Promise<Map<string, ResolvedProduct | null>> {
  const { rules, picks } = await loadMappings();
  return resolveWith(
    campaigns,
    rules.flatMap((r) => (r.prefix === null ? [] : [{ prefix: r.prefix, product: r.product }])),
    picks.flatMap((p) => (p.adAccountId === null || p.campaignId === null ? [] : [{ adAccountId: p.adAccountId, campaignId: p.campaignId, product: p.product }])),
  );
}

export interface CampaignRow extends CampaignRef {
  currency: string;
  /** Spend over the range, in the ad account currency. */
  spend: string;
  mapped: boolean;
  product: ResolvedProduct | null;
}

/** Distinct campaigns with spend in [from, to] (YYYY-MM-DD, both inclusive), with their product. Highest spend first. */
export async function listCampaigns(range: { from: string; to: string }): Promise<CampaignRow[]> {
  const days = await prisma.metaSpendDay.findMany({
    where: { date: { gte: utcDateOfYmd(range.from), lte: utcDateOfYmd(range.to) } },
    select: { adAccountId: true, campaignId: true, campaignName: true, currency: true, spend: true },
    orderBy: { date: 'desc' }, // newest first: the first name seen is the current one
  });

  const byKey = new Map<string, CampaignRef & { currency: string; spend: Money.Money }>();
  for (const d of days) {
    const key = campaignKey(d.adAccountId, d.campaignId);
    const row = byKey.get(key);
    if (row) row.spend = Money.add(row.spend, d.spend);
    else byKey.set(key, { adAccountId: d.adAccountId, campaignId: d.campaignId, campaignName: d.campaignName, currency: d.currency, spend: Money.parse(d.spend) });
  }

  const products = await resolveProducts([...byKey.values()]);
  return [...byKey.entries()]
    .map(([key, c]) => {
      const product = products.get(key) ?? null;
      return { adAccountId: c.adAccountId, campaignId: c.campaignId, campaignName: c.campaignName, currency: c.currency, spend: c.spend.toFixed(4), mapped: product !== null, product };
    })
    .sort((a, b) => Money.compare(b.spend, a.spend) || a.campaignName.localeCompare(b.campaignName));
}

/** The campaigns of the range with no product, with their spend total (M11 card C-03, the "Not mapped" strip). */
export async function listUnmapped(range: { from: string; to: string }): Promise<CampaignRow[]> {
  return (await listCampaigns(range)).filter((c) => !c.mapped);
}

// ---------------------------------------------------------------------------------------------
// Rules and picks (the tenant comes from the request context; Prisma scopes every query to it)
// ---------------------------------------------------------------------------------------------

const productView = (p: ProductInfo) => ({ id: p.id, name: p.name, archived: !p.isActive });

/** Rules and picks with product names and the archived flag. */
export async function listMappings() {
  const { rules, picks } = await loadMappings();
  return {
    rules: rules.map((r) => ({ id: r.id, prefix: r.prefix, product: productView(r.product), createdAt: r.createdAt })),
    picks: picks.map((p) => ({ id: p.id, adAccountId: p.adAccountId, campaignId: p.campaignId, product: productView(p.product), createdAt: p.createdAt })),
  };
}

/** A product of this tenant that is active. Another tenant's product, or a missing one, is a 404. */
async function assertProduct(productId: number): Promise<void> {
  const product = await prisma.product.findFirst({ where: { id: productId }, select: { id: true } });
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
}

export async function createRule(userId: number | null, input: { prefix: string; productId: number }) {
  const prefix = input.prefix.trim();
  if (prefix.length < 1 || prefix.length > 40) throw new AppError('Prefix must be 1 to 40 characters', 400, 'INVALID_PREFIX');
  await assertProduct(input.productId);
  const taken = await prisma.metaCampaignMapping.findFirst({
    where: { kind: 'prefix', prefix: { equals: prefix, mode: 'insensitive' } },
    select: { id: true },
  });
  if (taken) throw new AppError('This prefix is already mapped.', 409, 'PREFIX_EXISTS');
  try {
    const row = await prisma.metaCampaignMapping.create({
      data: { kind: 'prefix', prefix, productId: input.productId, createdById: userId, tenantId: resolveTenantId() },
    });
    return { id: row.id, prefix, productId: row.productId };
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new AppError('This prefix is already mapped.', 409, 'PREFIX_EXISTS');
    throw e;
  }
}

export async function deleteRule(id: number): Promise<void> {
  const { count } = await prisma.metaCampaignMapping.deleteMany({ where: { id, kind: 'prefix' } });
  if (count === 0) throw new AppError('Rule not found', 404, 'RULE_NOT_FOUND');
}

/** Upsert the one-off pick of a campaign. `productId` null deletes it. */
export async function setPick(userId: number | null, input: { adAccountId: number; campaignId: string; productId: number | null }) {
  const account = await prisma.metaAdAccount.findFirst({ where: { id: input.adAccountId }, select: { id: true } });
  if (!account) throw new AppError('Ad account not found', 404, 'AD_ACCOUNT_NOT_FOUND');

  if (input.productId === null) {
    await prisma.metaCampaignMapping.deleteMany({ where: { kind: 'campaign', adAccountId: input.adAccountId, campaignId: input.campaignId } });
    return null;
  }
  await assertProduct(input.productId);
  const existing = await prisma.metaCampaignMapping.findFirst({
    where: { kind: 'campaign', adAccountId: input.adAccountId, campaignId: input.campaignId },
    select: { id: true },
  });
  const row = existing
    ? await prisma.metaCampaignMapping.update({ where: { id: existing.id }, data: { productId: input.productId } })
    : await prisma.metaCampaignMapping.create({
        data: { kind: 'campaign', adAccountId: input.adAccountId, campaignId: input.campaignId, productId: input.productId, createdById: userId, tenantId: resolveTenantId() },
      });
  return { id: row.id, adAccountId: input.adAccountId, campaignId: input.campaignId, productId: row.productId };
}
