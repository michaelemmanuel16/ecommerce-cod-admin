import { Prisma, UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { Requester, isManagerUp } from '../utils/authUtils';
import { getCurrency } from '../utils/currency';
import { fullName } from '../utils/nameUtils';
import * as Money from '../utils/money';
import { DIGITAL, rates } from './kpi/rates';
import { getStoreTimeZone, monthRange, ymdOfUtc, MONTH_RE, localDate } from './kpi/dates';
import { CONFIRMED_DELIVERED_METRIC } from './teamReportService';
import { NO_DATA_FOR_METRIC, SET_A_TARGET, periodBounds } from './targetService';
import { attainmentPercent, countDistance, displayPercent, rateDistance, tierReached, type TierKey } from './rewardMath';
import type { RewardSettingsInput } from '../validators/rewardSchema';

/**
 * M6-T09 (F-1231, F-1108, F-1110): the reward settings and the attainment of a month. Call inside the tenant context.
 *
 * Settings: the cash tiers live in `RewardTier` (one row per role and threshold, 100 or 120) and the rep pay and the badge
 * switch in `SystemConfig.features.rewards`. Nothing else holds a tier amount or a rep rate. `getRepPay` is the one read of
 * the rep pay: whatever creates commission entries (M7) and the month close (M10) calls it.
 *
 * Attainment: actual / target of the month, on delivery-date numbers.
 *  - Call rep: orders the rep confirmed that got delivered, by delivery date in the month (P7).
 *  - Delivery: the partner's delivery success rate (delivered / closed, closed by delivery date) against the success target.
 *  - Any other metric has no data source here.
 * The 120 tier replaces the 100 tier (the higher one only). Nothing is paid before month close, so an open month reads
 * "On track to earn ..." and a closed month "Earned ...". AI agents and companies show attainment and get no payout.
 */

export const REP_PAY_DEFAULTS = { baseCommission: '8.00', upsellPercent: '10.00' } as const;
export const SETTINGS_NOTICE = 'Saved. Tier changes apply from the next month close. Commission and upsell changes apply to orders delivered after the save.';
export const NO_PAYOUT = 'No payout';
export const TOP_TIER = 'Top tier reached';
export const DELIVERY_SUCCESS_METRIC = 'delivery_success_rate';

interface StoredRewards { baseCommission?: string; upsellPercent?: string; badgesDisplay?: boolean }

const readStored = async (): Promise<StoredRewards> => {
  const config = await prisma.systemConfig.findFirst({ select: { features: true } });
  const features = (config?.features ?? {}) as { rewards?: StoredRewards };
  return features.rewards ?? {};
};

/** The rep pay of the tenant: per delivered order the rep confirmed by call, and the share of the extra value. The one read. */
export async function getRepPay() {
  const stored = await readStored();
  return {
    baseCommission: Money.parse(stored.baseCommission ?? REP_PAY_DEFAULTS.baseCommission),
    upsellPercent: Money.parse(stored.upsellPercent ?? REP_PAY_DEFAULTS.upsellPercent),
  };
}

const tierView = (t: { amount: Prisma.Decimal; dayOff: boolean; payout: boolean } | undefined) =>
  t ? { amount: Money.toApi(t.amount), dayOff: t.dayOff, payout: t.payout } : null;

/** GET /api/rewards/settings. Every role of the tenant with its two tiers (null until set). */
export async function getRewardSettings() {
  const [roles, stored, currency] = await Promise.all([
    prisma.role.findMany({
      select: { id: true, name: true, presetRole: true, rewardTiers: { select: { threshold: true, amount: true, dayOff: true, payout: true } } },
      orderBy: { name: 'asc' },
    }),
    readStored(),
    getCurrency(),
  ]);
  const pay = await getRepPay();
  return {
    currency,
    tiers: roles.map((r) => ({
      roleId: r.id,
      roleName: r.name,
      tier100: tierView(r.rewardTiers.find((t) => t.threshold === 100)),
      tier120: tierView(r.rewardTiers.find((t) => t.threshold === 120)),
    })),
    repPay: { baseCommission: Money.toApi(pay.baseCommission), upsellPercent: Money.toApi(pay.upsellPercent) },
    badgesDisplay: stored.badgesDisplay ?? true,
    // Fixed, not editable (F-1231).
    noPayout: ['ai_agent', 'company'],
    notice: SETTINGS_NOTICE,
  };
}

/** PUT /api/rewards/settings. Saves what is sent; the rest stays. A 120 percent reward below the 100 percent one is refused. */
export async function saveRewardSettings(input: RewardSettingsInput) {
  const tenantId = resolveTenantId();
  const tiers = input.tiers ?? [];
  if (new Set(tiers.map((t) => t.roleId)).size !== tiers.length) throw new AppError('A role is listed twice', 400, 'DUPLICATE_ROLE');

  const roles = await prisma.role.findMany({ where: { id: { in: tiers.map((t) => t.roleId) } }, select: { id: true, name: true } });
  const names = new Map(roles.map((r) => [r.id, r.name]));
  for (const t of tiers) {
    if (!names.has(t.roleId)) throw new AppError('Role not found', 404);
    const low = Money.parse(t.tier100.amount);
    const high = Money.parse(t.tier120.amount);
    if (high.lt(low)) {
      throw new AppError(
        `The 120% reward (${Money.toApi(high)}) cannot be below the 100% reward (${Money.toApi(low)}) for ${names.get(t.roleId)}`,
        400, 'TIER_ORDER',
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const t of tiers) {
      for (const [threshold, tier] of [[100, t.tier100], [120, t.tier120]] as const) {
        const data = { amount: Money.parse(tier.amount), ...(tier.dayOff !== undefined && { dayOff: tier.dayOff }) };
        await tx.rewardTier.upsert({
          where: { tenantId_roleId_threshold: { tenantId, roleId: t.roleId, threshold } },
          create: { tenantId, roleId: t.roleId, threshold, ...data },
          update: data,
        });
      }
    }
    if (input.repPay || input.badgesDisplay !== undefined) {
      const config = await tx.systemConfig.findFirst({ select: { id: true, features: true } });
      const features = (config?.features ?? {}) as Record<string, unknown>;
      const rewards: StoredRewards = {
        ...((features.rewards as StoredRewards | undefined) ?? {}),
        ...(input.repPay && { baseCommission: Money.toApi(input.repPay.baseCommission), upsellPercent: Money.toApi(input.repPay.upsellPercent) }),
        ...(input.badgesDisplay !== undefined && { badgesDisplay: input.badgesDisplay }),
      };
      const next = { ...features, rewards } as unknown as Prisma.InputJsonObject;
      if (config) await tx.systemConfig.update({ where: { id: config.id }, data: { features: next } });
      else await tx.systemConfig.create({ data: { tenantId, features: next } });
    }
  });
  return { ...(await getRewardSettings()), saved: true };
}

// ---- Attainment ---------------------------------------------------------------------------------------------------

type Tiers = Partial<Record<100 | 120, { amount: Prisma.Decimal; dayOff: boolean; payout: boolean }>>;

const currentMonth = () => localDate(new Date(), getStoreTimeZone()).slice(0, 7);

interface Holder { userId: number; roleId: number }

/**
 * Who is judged this month: everyone with a person target for it, and everyone who holds a role now whose role is measured
 * (a call rep or delivery role, a role with a target metric, or a role with a target this month). A holder of the Owner or
 * Finance role is not in the list and gets no "Set a target" warning.
 */
async function peopleOfMonth(monthStart: Date, userId?: number, roleId?: number) {
  const [targets, holders, roles, roleTargets] = await Promise.all([
    prisma.target.findMany({ where: { scope: 'person', periodStart: monthStart, userId: { not: null }, roleId: { not: null } } }),
    prisma.roleAssignment.findMany({ where: { toDate: null }, select: { holderId: true, roleId: true } }),
    prisma.role.findMany({ select: { id: true, presetRole: true, targetMetric: true } }),
    prisma.target.findMany({ where: { scope: 'role', periodStart: monthStart, roleId: { not: null } }, select: { roleId: true } }),
  ]);
  const measured = new Set([
    ...roles.filter((r) => r.presetRole === 'sales_rep' || r.presetRole === 'delivery_agent' || r.targetMetric).map((r) => r.id),
    ...roleTargets.map((t) => t.roleId!),
  ]);
  const pairs = new Map<string, Holder>();
  for (const t of targets) pairs.set(`${t.userId}:${t.roleId}`, { userId: t.userId!, roleId: t.roleId! });
  for (const h of holders) if (measured.has(h.roleId)) pairs.set(`${h.holderId}:${h.roleId}`, { userId: h.holderId, roleId: h.roleId });
  const picked = [...pairs.values()].filter((p) => (userId === undefined || p.userId === userId) && (roleId === undefined || p.roleId === roleId));
  // Several targets of one pair (a changed metric): the newest one judges.
  const targetOf = new Map<string, (typeof targets)[number]>();
  for (const t of [...targets].sort((a, b) => a.id - b.id)) targetOf.set(`${t.userId}:${t.roleId}`, t);
  return { picked, targetOf };
}

type Basis = { kind: 'count' } | { kind: 'rate' } | null;

/** How a target is measured: by its metric, else by the base role of the role. */
const basisOf = (metric: string | null, preset: UserRole | null): Basis => {
  if (metric === CONFIRMED_DELIVERED_METRIC) return { kind: 'count' };
  if (metric === DELIVERY_SUCCESS_METRIC) return { kind: 'rate' };
  if (metric) return null;
  if (preset === 'sales_rep') return { kind: 'count' };
  if (preset === 'delivery_agent') return { kind: 'rate' };
  return null;
};

/**
 * GET /api/rewards/attainment. One row per person and role for the month (default: this month). The Owner and admin level
 * see everyone and may filter; anyone else sees their own rows only.
 */
export async function attainment(actor: Requester, query: { period?: string; userId?: number; roleId?: number }) {
  const tenantId = resolveTenantId();
  const period = query.period ?? currentMonth();
  const match = MONTH_RE.exec(period);
  if (!match) throw new AppError('Period must be a month like 2026-10', 400, 'INVALID_PERIOD');
  const seeAll = isManagerUp(actor);
  if (!seeAll && query.userId !== undefined && query.userId !== actor.id) throw new AppError('You can only see your own attainment', 403);
  const userId = seeAll ? query.userId : actor.id;

  const bounds = periodBounds('month', period);
  const { from, to } = monthRange(Number(match[1]), Number(match[2]), getStoreTimeZone(tenantId));
  const { picked, targetOf } = await peopleOfMonth(bounds.start, userId, query.roleId);

  const [users, roles, tierRows, closedMonth, currency] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(picked.map((p) => p.userId))] } }, select: { id: true, firstName: true, lastName: true, kind: true } }),
    prisma.role.findMany({ where: { id: { in: [...new Set(picked.map((p) => p.roleId))] } }, select: { id: true, name: true, presetRole: true } }),
    prisma.rewardTier.findMany({ where: { roleId: { in: [...new Set(picked.map((p) => p.roleId))] } } }),
    prisma.target.findFirst({ where: { scope: 'month', periodStart: bounds.start, closedAt: { not: null } }, select: { id: true } }),
    getCurrency(),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const tiersOf = (roleId: number): Tiers => Object.fromEntries(tierRows.filter((t) => t.roleId === roleId).map((t) => [t.threshold, t]));
  const closed = closedMonth !== null;

  // Delivered orders per confirming rep, by delivery date: one query for every rep.
  const delivered = await prisma.order.groupBy({
    by: ['confirmedById'],
    where: { deletedAt: null, status: { notIn: DIGITAL }, AND: [{ status: 'delivered', deliveryDate: { gte: from, lt: to } }], confirmedById: { not: null } },
    _count: { _all: true },
  });
  const deliveredBy = new Map(delivered.map((d) => [d.confirmedById!, d._count._all]));

  const money = (v: Money.MoneyInput) => Money.format(v, currency, { symbol: currency === 'GHS' ? 'GH₵' : undefined, wholeIfZero: true });

  const rows = await Promise.all(picked.map(async ({ userId: uid, roleId }) => {
    const user = userById.get(uid);
    const role = roleById.get(roleId);
    if (!user || !role) return null;
    const target = targetOf.get(`${uid}:${roleId}`) ?? null;
    const human = user.kind === 'person';
    const kind = user.kind === 'ai_agent' ? 'ai_agent' : user.kind === 'company' ? 'company' : 'person';
    const base = {
      userId: uid, name: fullName(user), kind, roleId, roleName: role.name, payout: human,
      metric: target?.metric ?? null, unit: target?.unit ?? null,
      target: target ? Money.toApi(target.value) : null,
      actual: null as number | null, percent: null as number | null, tier: 'none' as TierKey,
      reward: null as { amount: string; dayOff: boolean } | null,
      earned: false, distance: null as null | { next: '100' | '120'; amount: number | null; unit: string; message: string },
      warning: null as string | null, message: '' as string,
    };

    if (!target) return { ...base, warning: SET_A_TARGET, message: human ? SET_A_TARGET : `${SET_A_TARGET}. ${NO_PAYOUT}` };

    const basis = basisOf(target.metric, role.presetRole);
    if (!basis) return { ...base, warning: NO_DATA_FOR_METRIC, message: NO_DATA_FOR_METRIC };

    let actual: number;
    let percent: Money.Money | null;
    let rateFacts: { delivered: number; closed: number } | null = null;
    if (basis.kind === 'count') {
      actual = deliveredBy.get(uid) ?? 0;
      percent = attainmentPercent(actual, target.value);
    } else {
      const r = await rates(tenantId, from, to, { basis: 'delivery', partnerId: uid });
      const counts: Record<string, number> = r.deliverySuccessRate.detail ?? {};
      rateFacts = { delivered: counts.delivered ?? 0, closed: counts.closed ?? 0 };
      const successPct = rateFacts.closed > 0 ? Money.div(Money.mul(rateFacts.delivered, 100), rateFacts.closed) : Money.ZERO;
      actual = successPct.toDecimalPlaces(1, 1).toNumber();
      percent = attainmentPercent(successPct, target.value);
    }
    const tier = tierReached(percent);
    const tiers = tiersOf(roleId);
    const row = { ...base, actual, percent: percent === null ? null : displayPercent(percent), tier, earned: false };

    // Distance to the next tier (F-1108). Top tier: none.
    const next: '100' | '120' | null = tier === 'none' ? '100' : tier === '100' ? '120' : null;
    let distance: typeof base.distance = null;
    if (next && basis.kind === 'count') {
      const d = countDistance(actual, target.value);
      const n = next === '100' ? d.to100 : d.to120;
      const prize = tiers[Number(next) as 100 | 120];
      distance = { next, amount: n, unit: 'confirmed orders', message: `${n} more confirmed orders that get delivered to reach ${next}%${prize && human ? ` (${money(prize.amount)})` : ''}` };
    } else if (next && rateFacts) {
      const n = rateDistance(rateFacts.delivered, rateFacts.closed, target.value, Number(next) as 100 | 120);
      distance = { next, amount: n, unit: 'deliveries with no failure', message: n === null ? `${next}% cannot be reached this month` : `${n} more deliveries with no failure to reach ${next}%` };
    }

    if (!human) return { ...row, payout: false, distance: null, message: `${NO_PAYOUT}. Attainment ${row.percent ?? 0}%` };

    const tierRow = tier === 'none' ? undefined : tiers[Number(tier) as 100 | 120];
    const reward = tierRow && tierRow.payout ? { amount: Money.toApi(tierRow.amount), dayOff: tierRow.dayOff } : null;
    let message: string;
    if (tier === 'none') message = distance ? distance.message : 'No tier reached yet';
    else if (!reward) message = tier === '120' ? TOP_TIER : `${tier}% reached`;
    else if (closed) message = `${tier === '120' ? `${TOP_TIER}. ` : ''}Earned ${money(reward.amount)}${reward.dayOff ? ' and a paid day off' : ''}`;
    else message = `${tier === '120' ? `${TOP_TIER}. ` : ''}On track to earn ${money(reward.amount)}${reward.dayOff ? ' and a paid day off' : ''} at month close`;
    return { ...row, reward, earned: closed && reward !== null, distance, message };
  }));

  const results = rows.filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.roleName.localeCompare(b.roleName) || a.name.localeCompare(b.name));
  return { period, monthStart: ymdOfUtc(bounds.start), closed, currency, results };
}
