import { Prisma, UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { Requester, isManagerUp } from '../utils/authUtils';
import { getCurrency } from '../utils/currency';
import { fullName } from '../utils/nameUtils';
import * as Money from '../utils/money';
import { deliveredByRep, outcomesByPartner } from './kpi/rates';
import { getStoreTimeZone, monthRange, ymdOfUtc, MONTH_RE, localDate } from './kpi/dates';
import { METRIC_BASIS, type MeasureBasis } from '../config/targetMetrics';
import { NO_DATA_FOR_METRIC, SET_A_TARGET, isMonthClosed, monthPersonTargets, monthRoleTargets, periodBounds } from './targetService';
import { clearTenantFeaturesCache, getRewardFeatures, mergeFeatureKey, type RewardFeatures } from './tenantFeatures';
import {
  NO_PAYOUT, attainmentPercent, countDistance, displayPercent, nextTier, rateDistance, rewardMessage, tierReached, type Tier,
} from './rewardMath';
import type { RewardSettingsInput } from '../validators/rewardSchema';

/**
 * M6-T09 (F-1231, F-1108, F-1110): the reward settings and the attainment of a month. Call inside the tenant context.
 *
 * Settings: the cash tiers live in `RewardTier` (one row per role and threshold, 100 or 120) and the rep pay and the badge
 * switch in `SystemConfig.features.rewards`. Nothing else holds a tier amount or a rep rate.
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

/** The rep pay of a stored settings object, with the defaults for what is not set. Pure. */
const repPayOf = (stored: RewardFeatures) => ({
  baseCommission: Money.parse(stored.baseCommission ?? REP_PAY_DEFAULTS.baseCommission),
  upsellPercent: Money.parse(stored.upsellPercent ?? REP_PAY_DEFAULTS.upsellPercent),
});

/**
 * The rep pay of the tenant: per delivered order the rep confirmed by call, and the share of the extra value they added.
 * This is the one place the setting is read. GL posting still reads `User.commissionAmount` until M6-T10 / M7 switch commission
 * entries to this function; until then a change here does not move a posted amount.
 */
export async function getRepPay() {
  return repPayOf(await getRewardFeatures());
}

const tierView = (t: { amount: Prisma.Decimal; dayOff: boolean; payout: boolean } | undefined) =>
  t ? { amount: Money.toApi(t.amount), dayOff: t.dayOff, payout: t.payout } : null;

/** GET /api/rewards/settings. Every role of the tenant with its two tiers (null until set). */
export async function getRewardSettings() {
  const [roles, stored, currency] = await Promise.all([
    prisma.role.findMany({
      select: { id: true, name: true, rewardTiers: { select: { threshold: true, amount: true, dayOff: true, payout: true } } },
      orderBy: { name: 'asc' },
    }),
    getRewardFeatures(),
    getCurrency(),
  ]);
  const pay = repPayOf(stored);
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
    await Promise.all(tiers.flatMap((t) => ([[100, t.tier100], [120, t.tier120]] as const).map(([threshold, tier]) => {
      const data = { amount: Money.parse(tier.amount), ...(tier.dayOff !== undefined && { dayOff: tier.dayOff }) };
      return tx.rewardTier.upsert({
        where: { tenantId_roleId_threshold: { tenantId, roleId: t.roleId, threshold } },
        create: { tenantId, roleId: t.roleId, threshold, ...data },
        update: data,
      });
    })));
    if (input.repPay || input.badgesDisplay !== undefined) {
      const rewards: RewardFeatures = {
        ...(await getRewardFeatures()),
        ...(input.repPay && { baseCommission: Money.toApi(input.repPay.baseCommission), upsellPercent: Money.toApi(input.repPay.upsellPercent) }),
        ...(input.badgesDisplay !== undefined && { badgesDisplay: input.badgesDisplay }),
      };
      await mergeFeatureKey(tx, 'rewards', rewards as Prisma.InputJsonObject);
    }
  });
  clearTenantFeaturesCache(tenantId);
  return { ...(await getRewardSettings()), saved: true };
}

// ---- Attainment ---------------------------------------------------------------------------------------------------

type TierRow = { amount: Prisma.Decimal; dayOff: boolean; payout: boolean };
type Tiers = Partial<Record<Tier, TierRow>>;

const currentMonth = () => localDate(new Date(), getStoreTimeZone()).slice(0, 7);
const key = (userId: number, roleId: number) => `${userId}:${roleId}`;

/**
 * Who is judged this month: everyone with a live person target for it, and everyone who holds a role now whose role is
 * measured (a call rep or delivery role, a role with a target metric, or a role with a target this month). A holder of the
 * Owner or Finance role is not in the list and gets no "Set a target" warning. The filters go into the queries.
 */
async function peopleOfMonth(period: string, userId?: number, roleId?: number) {
  const [targets, holders, roles, roleTargets] = await Promise.all([
    monthPersonTargets(period, { userId, roleId }),
    prisma.roleAssignment.findMany({
      where: { toDate: null, ...(userId !== undefined && { holderId: userId }), ...(roleId !== undefined && { roleId }) },
      select: { holderId: true, roleId: true },
    }),
    prisma.role.findMany({ select: { id: true, presetRole: true, targetMetric: true } }),
    monthRoleTargets(period),
  ]);
  const measured = new Set([
    ...roles.filter((r) => r.presetRole === 'sales_rep' || r.presetRole === 'delivery_agent' || r.targetMetric).map((r) => r.id),
    ...roleTargets.map((t) => t.roleId!),
  ]);
  const pairs = new Map<string, { userId: number; roleId: number }>();
  for (const t of targets) pairs.set(key(t.userId!, t.roleId!), { userId: t.userId!, roleId: t.roleId! });
  for (const h of holders) if (measured.has(h.roleId)) pairs.set(key(h.holderId, h.roleId), { userId: h.holderId, roleId: h.roleId });
  // The targets come oldest first: a later one of the same pair (a changed metric) replaces the earlier.
  const targetOf = new Map(targets.map((t) => [key(t.userId!, t.roleId!), t]));
  return { picked: [...pairs.values()], targetOf };
}

/** How a target is measured: by its metric, else by the base role of the role. */
export const basisOf = (metric: string | null, preset: UserRole | null): MeasureBasis | null => {
  if (metric) return METRIC_BASIS[metric] ?? null;
  return preset === 'sales_rep' ? 'count' : preset === 'delivery_agent' ? 'rate' : null;
};

interface Distance { next: '100' | '120'; amount: number | null; unit: string; message: string }

export interface AttainmentRow {
  userId: number;
  name: string;
  kind: string;
  roleId: number;
  roleName: string;
  payout: boolean;
  metric: string | null;
  unit: string | null;
  target: string | null;
  actual: number | null;
  percent: number | null;
  tier: 'none' | '100' | '120';
  reward: { amount: string; dayOff: boolean } | null;
  earned: boolean;
  distance: Distance | null;
  warning: string | null;
  message: string;
}

/** What a measure gives: the actual shown, the exact percent of target, and for a rate the counts behind it. */
export interface Measure { actual: number; percent: Money.Money | null; rate: { delivered: number; closed: number } | null }

/** The actual and percent of one person: a count against a count target, or a success rate against the success target. */
export function measure(
  basis: MeasureBasis, target: Money.Money, delivered: number, outcome: { delivered: number; failed: number; returned: number } | undefined,
): Measure {
  if (basis === 'count') return { actual: delivered, percent: attainmentPercent(delivered, target), rate: null };
  const counts = outcome ?? { delivered: 0, failed: 0, returned: 0 };
  const closed = counts.delivered + counts.failed + counts.returned;
  const success = closed > 0 ? Money.div(Money.mul(counts.delivered, 100), closed) : Money.ZERO;
  return { actual: success.toDecimalPlaces(1, 1).toNumber(), percent: attainmentPercent(success, target), rate: { delivered: counts.delivered, closed } };
}

/** How far the next tier is (F-1108); null at the top. `prize` is the text of what that tier pays. */
export function distanceTo(basis: MeasureBasis, tier: Tier | null, m: Measure, target: Money.Money, prize: string | null): Distance | null {
  const next = nextTier(tier);
  if (next === null) return null;
  if (basis === 'count') {
    const n = countDistance(m.actual, target)[next];
    return { next: String(next) as '100' | '120', amount: n, unit: 'confirmed orders', message: `${n} more confirmed orders that get delivered to reach ${next}%${prize ? ` (${prize})` : ''}` };
  }
  const n = rateDistance(m.rate!.delivered, m.rate!.closed, target, next);
  return {
    next: String(next) as '100' | '120', amount: n, unit: 'deliveries with no failure',
    message: n === null ? `${next}% cannot be reached this month` : `${n} more deliveries with no failure to reach ${next}%`,
  };
}

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
  const [{ picked, targetOf }, closed, currency] = await Promise.all([peopleOfMonth(period, userId, query.roleId), isMonthClosed(period), getCurrency()]);
  const userIds = [...new Set(picked.map((p) => p.userId))];
  const roleIds = [...new Set(picked.map((p) => p.roleId))];

  const [users, roles, tierRows] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, kind: true } }),
    prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true, presetRole: true } }),
    prisma.rewardTier.findMany({ where: { roleId: { in: roleIds } } }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const tiersOf = new Map<number, Tiers>();
  for (const t of tierRows) tiersOf.set(t.roleId, { ...tiersOf.get(t.roleId), [t.threshold as Tier]: t });

  // What each row needs is read once for everyone who needs it, and not at all when no row does.
  const basisByRow = picked.map((p) => {
    const target = targetOf.get(key(p.userId, p.roleId));
    return target ? basisOf(target.metric, roleById.get(p.roleId)?.presetRole ?? null) : null;
  });
  const idsOf = (basis: MeasureBasis) => [...new Set(picked.filter((_, i) => basisByRow[i] === basis).map((p) => p.userId))];
  const countIds = idsOf('count');
  const rateIds = idsOf('rate');
  const [deliveredBy, outcomeBy] = await Promise.all([
    countIds.length ? deliveredByRep(tenantId, from, to, countIds) : new Map<number, number>(),
    rateIds.length ? outcomesByPartner(tenantId, from, to, rateIds) : new Map<number, { delivered: number; failed: number; returned: number }>(),
  ]);

  const money = (v: Money.MoneyInput) => Money.formatWithSign(v, currency);

  const rows: AttainmentRow[] = [];
  picked.forEach(({ userId: uid, roleId }, i) => {
    const user = userById.get(uid);
    const role = roleById.get(roleId);
    if (!user || !role) return;
    const target = targetOf.get(key(uid, roleId)) ?? null;
    const human = user.kind === 'person';
    const row = (over: Partial<AttainmentRow>): AttainmentRow => ({
      userId: uid, name: fullName(user), kind: user.kind, roleId, roleName: role.name, payout: human,
      metric: target?.metric ?? null, unit: target?.unit ?? null, target: target ? Money.toApi(target.value) : null,
      actual: null, percent: null, tier: 'none', reward: null, earned: false, distance: null, warning: null, message: '',
      ...over,
    });

    if (!target) return void rows.push(row({ warning: SET_A_TARGET, message: human ? SET_A_TARGET : `${SET_A_TARGET}. ${NO_PAYOUT}` }));
    const basis = basisByRow[i];
    if (!basis) return void rows.push(row({ warning: NO_DATA_FOR_METRIC, message: NO_DATA_FOR_METRIC }));

    const m = measure(basis, target.value, deliveredBy.get(uid) ?? 0, outcomeBy.get(uid));
    const tier = tierReached(m.percent);
    const shown = { actual: m.actual, percent: m.percent === null ? null : displayPercent(m.percent), tier: tier === null ? 'none' as const : String(tier) as '100' | '120' };
    // An AI agent or a company shows attainment and nothing to pay or to reach.
    if (!human) return void rows.push(row({ ...shown, message: rewardMessage({ tier, reward: null, distance: null, closed, human, percent: shown.percent }) }));

    const tiers = tiersOf.get(roleId) ?? {};
    const next = nextTier(tier);
    const nextRow = next === null ? undefined : tiers[next];
    const distance = distanceTo(basis, tier, m, target.value, nextRow ? money(nextRow.amount) : null);
    const paid = tier === null ? undefined : tiers[tier];
    const reward = paid && paid.payout ? { amount: Money.toApi(paid.amount), dayOff: paid.dayOff } : null;
    rows.push(row({
      ...shown, reward, distance, earned: closed && reward !== null,
      message: rewardMessage({ tier, reward: reward && { ...reward, amount: money(reward.amount) }, distance: distance?.message ?? null, closed, human, percent: shown.percent }),
    }));
  });

  rows.sort((a, b) => a.roleName.localeCompare(b.roleName) || a.name.localeCompare(b.name));
  return { period, monthStart: ymdOfUtc(bounds.start), closed, currency, results: rows };
}
