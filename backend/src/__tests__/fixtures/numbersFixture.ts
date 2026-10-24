/**
 * M1-T23 (COD-11, decision D15): the canonical fixture that reproduces docs/mockups/v2/NUMBERS.md.
 *
 * One dedicated tenant (`fixture-numbers`) holds 1,445 orders placed 1 to 17 October 2026 (Africa/Accra is
 * UTC+0, so every timestamp here is UTC). `seedFixture` deletes that tenant's rows and builds them again, so a
 * re-run gives the same rows. It never reads or writes another tenant. Order ids come from the database and
 * differ between runs; the order number (`externalOrderId`, 23001 up) and the hash do not.
 *
 * How each NUMBERS.md number is read is written in docs/plan/M1-fixture-notes.md.
 *
 * Part 2 (M1-T24, F-114) adds, in the same tenant: delivered orders for January to September 2026 (revenue by
 * delivery month exact), seeded expenses for margin history, `Target` rows, cash held by partners (`AgentBalance`)
 * and, in `meta-spend.json` next to this file, the five Meta campaigns (no spend model exists before M8).
 * They come from their own random seed (FIXTURE_SEED + 1), so the October plan is unchanged.
 *
 * Part 3 (M4-T05, F-651 to F-656) adds the stock of docs/mockups/v2/inventory.html: locations, levels, the 9 October
 * shipment received 288 of 300, a 3PL count of 188 on 15 October (system 200), 20 copybook sets in transit to Kofi, and the
 * returns sent 41 / received 36. Reserved is never stored: it comes from the orders (see STOCK_AT).
 *
 * `buildFixturePlan()` is pure (no database): it makes every row in memory from a fixed random seed.
 * `seedFixture(prisma, opts)` writes the plan. Integration tests call it in beforeAll; the script
 * `backend/scripts/seed-fixture.ts` calls it from the command line.
 */
import type { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { runInTenant } from '../../utils/tenantContext';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { GLAutomationService, ORDER_GL_INCLUDE } from '../../services/glAutomationService';
import { GLAccountService } from '../../services/glAccountService';
import { CASH_OVERDUE_DAYS } from '../../services/kpi/cash';

export const FIXTURE_SLUG = 'fixture-numbers';
const FIXTURE_NAME = 'Fixture (NUMBERS.md)';
const FIXTURE_SEED = 20261017;
const EMAIL_DOMAIN = 'fixture-numbers.test';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 1);
/** "Now" in the fixture: 17 October 2026, 13:00 Accra. The oldest pending order is 3 h 10 min older. */
const FIXTURE_NOW = Date.UTC(2026, 9, 17, 13, 0, 0);

// ---------------------------------------------------------------------------------------------------------
// Constants from NUMBERS.md
// ---------------------------------------------------------------------------------------------------------

type RepKey = 'adwoa' | 'confirm' | 'nana';
type PartnerKey = 'logiswift' | 'kofi' | 'esi' | 'kwesi' | 'kasapa';
type Group = 'pending' | 'cancelled' | 'waiting' | 'out' | 'delivered' | 'failed' | 'returned';

const REPS: Record<RepKey, { first: string; last: string; calls: number; medianFirstCallMin: number }> = {
  adwoa: { first: 'Adwoa', last: 'Darko', calls: 1360, medianFirstCallMin: 12 },
  confirm: { first: 'Confirm', last: 'agent', calls: 780, medianFirstCallMin: 2 },
  nana: { first: 'Nana', last: 'Kyei', calls: 170, medianFirstCallMin: 41 },
};
const REP_KEYS = Object.keys(REPS) as RepKey[];

const PARTNERS: Record<PartnerKey, {
  first: string; last: string; state: string; areas: string[];
  confirmedToDispatchedDays: number; dispatchedToDeliveredDays: number;
}> = {
  logiswift: { first: 'Logiswift', last: '3PL', state: 'Greater Accra', areas: ['Accra', 'Tema', 'Osu', 'Spintex', 'Lapaz', 'Teshie'], confirmedToDispatchedDays: 1.4, dispatchedToDeliveredDays: 3.8 },
  kofi: { first: 'Kofi', last: 'Appiah', state: 'Ashanti', areas: ['Adum', 'Asokwa', 'Kejetia', 'Ahodwo'], confirmedToDispatchedDays: 0.6, dispatchedToDeliveredDays: 1.2 },
  esi: { first: 'Esi', last: 'Badu', state: 'Greater Accra', areas: ['Osu', 'Madina', 'East Legon', 'Dansoman'], confirmedToDispatchedDays: 0.7, dispatchedToDeliveredDays: 1.5 },
  kwesi: { first: 'Kwesi', last: 'Amoah', state: 'Western', areas: ['Takoradi', 'Market Circle', 'Anaji'], confirmedToDispatchedDays: 0.9, dispatchedToDeliveredDays: 1.9 },
  kasapa: { first: 'Kasapa', last: 'Express', state: 'Central', areas: ['Cape Coast', 'Abura', 'Pedu'], confirmedToDispatchedDays: 1.0, dispatchedToDeliveredDays: 1.5 },
};
const PARTNER_KEYS = Object.keys(PARTNERS) as PartnerKey[];

/** Orders by group and rep. Confirmed = delivered + failed + returned + out + waiting = 640 / 328 / 58. */
const BY_REP: Record<Exclude<Group, 'pending' | 'cancelled'>, Record<RepKey, number>> = {
  delivered: { adwoa: 253, confirm: 110, nana: 13 },
  failed: { adwoa: 209, confirm: 119, nana: 26 },
  returned: { adwoa: 24, confirm: 20, nana: 4 },
  out: { adwoa: 91, confirm: 47, nana: 10 },
  waiting: { adwoa: 63, confirm: 32, nana: 5 },
};
/** Not confirmed. Pending has 9 orders with no rep. Reps' assigned totals: 871 / 465 / 100. */
const PENDING_BY_REP: Record<RepKey | 'none', number> = { adwoa: 20, confirm: 25, nana: 10, none: 9 };
const CANCELLED_BY_REP: Record<RepKey, number> = { adwoa: 211, confirm: 112, nana: 32 };

/** Orders by partner and group (assigned = delivered + failed + returned + out = 590 / 172 / 102 / 54 / 8). */
const BY_PARTNER: Record<'delivered' | 'failed' | 'returned' | 'out', Record<PartnerKey, number>> = {
  delivered: { logiswift: 220, kofi: 82, esi: 48, kwesi: 26, kasapa: 0 },
  failed: { logiswift: 229, kofi: 66, esi: 38, kwesi: 21, kasapa: 0 },
  returned: { logiswift: 41, kofi: 4, esi: 2, kwesi: 1, kasapa: 0 },
  out: { logiswift: 100, kofi: 20, esi: 14, kwesi: 6, kasapa: 8 },
};

/** Calls (2,310 in all) are set per rep in REPS. Decline reasons (301 of the 355 cancelled) and failure reasons (402). */
const DECLINE_REASONS: Array<[string | null, number]> = [
  ['price_too_high', 102], ['prank_or_mistake', 66], ['changed_mind', 60], ['bought_elsewhere', 42], ['other', 31], [null, 54],
];
const FAILURE_REASONS: Array<[string, number]> = [
  ['not_reachable', 165], ['refused', 96], ['wrong_address', 84], ['rescheduled', 57],
];

const PRODUCTS = [
  { sku: 'MG-COPYBOOK-SET', name: 'Magic Groove copybook set', price: 249, cogs: 30, category: 'copybook' },
  { sku: 'MG-REFILL-PENS', name: 'Refill pens', price: 40, cogs: 12, category: 'add-on' },
  { sku: 'MG-GRIP-TRAINER', name: 'Pencil grip trainer', price: 35, cogs: 11, category: 'add-on' },
  { sku: 'MG-PARENT-GUIDE', name: "Smart Parent's guide", price: 59, cogs: 3, category: 'add-on' },
  { sku: 'DT-CREAM', name: 'Dictamni cream', price: 250, cogs: 0, category: 'cream' },
] as const;
type Sku = (typeof PRODUCTS)[number]['sku'];
const PRICE: Record<Sku, number> = Object.fromEntries(PRODUCTS.map((p) => [p.sku, p.price])) as Record<Sku, number>;

/** Delivered units: 306 + 172 + 89 + 58 + 10 = 635 over 376 delivered orders; revenue exactly 92,000. */
const DELIVERED_UNITS: Record<Sku, number> = { 'MG-COPYBOOK-SET': 306, 'MG-REFILL-PENS': 172, 'MG-GRIP-TRAINER': 89, 'MG-PARENT-GUIDE': 58, 'DT-CREAM': 10 };
const DELIVERED_REVENUE = 92000;
const FIRST_ORDER_NUMBER = 23001;

/**
 * On hand at the two stock holders of F-652 (inventory.html). Products not listed hold 0 and have no level row.
 * Reserved is not stored; it is read from the orders at each holder: 148 orders are out for delivery (100 at Logiswift,
 * 20 at Kofi) and each holds at least one copybook set, so reserved copybooks are 116 at Logiswift and 21 at Kofi.
 * The mockup's samples (Logiswift on hand 100, reserved 34) cannot hold with those orders. Logiswift copybook on hand is
 * therefore 200, so that available to sell (on hand less reserved) stays above 0 and the public checkout accepts an order.
 */
export const STOCK_AT: Record<'logiswift' | 'kofi', Partial<Record<Sku, number>>> = {
  logiswift: { 'MG-COPYBOOK-SET': 200, 'MG-REFILL-PENS': 62, 'MG-GRIP-TRAINER': 180 },
  kofi: { 'MG-COPYBOOK-SET': 36, 'MG-REFILL-PENS': 18, 'MG-GRIP-TRAINER': 45 },
};
/** Product.stockQuantity is the cached sum of on-hand over active physical locations (F-651). */
const stockCache = (sku: Sku) => (STOCK_AT.logiswift[sku] ?? 0) + (STOCK_AT.kofi[sku] ?? 0);
const STOCK_LOCATIONS: Array<{ key: string; name: string; type: 'partner_3pl' | 'agent' | 'in_transit'; partner: PartnerKey | null; address: string | null }> = [
  { key: 'logiswift', name: 'Logiswift', type: 'partner_3pl', partner: 'logiswift', address: 'Tema' },
  { key: 'kasapa', name: 'Kasapa Express', type: 'partner_3pl', partner: 'kasapa', address: 'Cape Coast' },
  { key: 'kofi', name: 'Kofi Appiah', type: 'agent', partner: 'kofi', address: 'Kumasi' },
  { key: 'esi', name: 'Esi Badu', type: 'agent', partner: 'esi', address: 'Accra' },
  { key: 'kwesi', name: 'Kwesi Amoah', type: 'agent', partner: 'kwesi', address: 'Takoradi' },
  { key: 'transit', name: 'In transit', type: 'in_transit', partner: null, address: null },
];

// ---------------------------------------------------------------------------------------------------------
// Seeded random numbers (mulberry32). No Math.random anywhere in this file.
// ---------------------------------------------------------------------------------------------------------

function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    between: (lo: number, hi: number) => lo + next() * (hi - lo),
    normal: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    shuffle<T>(items: T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
type Rng = ReturnType<typeof makeRng>;

// ---------------------------------------------------------------------------------------------------------
// The plan: every row in memory
// ---------------------------------------------------------------------------------------------------------

type OrderStatusName =
  | 'pending_confirmation' | 'cancelled' | 'confirmed' | 'preparing' | 'ready_for_pickup'
  | 'out_for_delivery' | 'delivered' | 'failed_delivery' | 'returned';

interface PlannedCall { at: number; outcome: string; durationSec: number; declineReason: string | null }
interface PlannedHistory { status: OrderStatusName; from: OrderStatusName | null; at: number; by: 'system' | 'rep' | 'partner' | 'admin' }
export interface PlannedOrder {
  orderNumber: string;
  group: Group;
  status: OrderStatusName;
  rep: RepKey | null;
  partner: PartnerKey | null;
  items: Array<{ sku: Sku; qty: number }>;
  subtotal: number;
  discount: number;
  total: number;
  state: string;
  area: string;
  createdAt: number;
  firstContactAt: number | null;
  confirmedAt: number | null;
  dispatchedAt: number | null;
  deliveryDate: number | null;
  returnedAt: number | null;
  failureReason: string | null;
  declineReason: string | null;
  calls: PlannedCall[];
  history: PlannedHistory[];
}

interface Draft {
  group: Group;
  status: OrderStatusName;
  rep: RepKey | null;
  partner: PartnerKey | null;
  callCount: number;
  failureReason: string | null;
  declineReason: string | null;
}

const repeat = <T>(value: T, n: number): T[] => Array.from({ length: n }, () => value);

function expandCounts<K extends string>(counts: Record<K, number>): K[] {
  const out: K[] = [];
  for (const key of Object.keys(counts) as K[]) out.push(...repeat(key, counts[key]));
  return out;
}

function makeDrafts(rng: Rng): Draft[] {
  const drafts: Draft[] = [];
  const add = (group: Group, status: OrderStatusName, rep: RepKey | null, partner: PartnerKey | null) =>
    drafts.push({ group, status, rep, partner, callCount: 0, failureReason: null, declineReason: null });

  for (const rep of expandCounts(PENDING_BY_REP)) add('pending', 'pending_confirmation', rep === 'none' ? null : rep, null);
  for (const rep of expandCounts(CANCELLED_BY_REP)) add('cancelled', 'cancelled', rep, null);

  // Waiting to dispatch: 100 = 40 confirmed + 35 preparing + 25 ready for pickup, spread over the reps.
  const waitingStatus = rng.shuffle<OrderStatusName>([...repeat<OrderStatusName>('confirmed', 40), ...repeat<OrderStatusName>('preparing', 35), ...repeat<OrderStatusName>('ready_for_pickup', 25)]);
  expandCounts(BY_REP.waiting).forEach((rep, i) => add('waiting', waitingStatus[i], rep, null));

  const dispatched: Array<[Exclude<Group, 'pending' | 'cancelled' | 'waiting'>, OrderStatusName]> = [
    ['out', 'out_for_delivery'], ['delivered', 'delivered'], ['failed', 'failed_delivery'], ['returned', 'returned'],
  ];
  for (const [group, status] of dispatched) {
    const reps = expandCounts(BY_REP[group]);
    const partners = rng.shuffle(expandCounts(BY_PARTNER[group]));
    reps.forEach((rep, i) => add(group, status, rep, partners[i]));
  }

  // Reasons: decline on the 355 cancelled (301 have one), failure on the 402 failed or returned.
  const declines = rng.shuffle(DECLINE_REASONS.flatMap(([reason, n]) => repeat(reason, n)));
  drafts.filter((d) => d.group === 'cancelled').forEach((d, i) => { d.declineReason = declines[i]; });
  const failures = rng.shuffle(FAILURE_REASONS.flatMap(([reason, n]) => repeat(reason, n)));
  drafts.filter((d) => d.group === 'failed' || d.group === 'returned').forEach((d, i) => { d.failureReason = failures[i]; });

  // Calls: every order a rep worked (all but pending) gets one call; the rest of the rep's calls go to random orders.
  for (const rep of REP_KEYS) {
    const worked = drafts.filter((d) => d.rep === rep && d.group !== 'pending');
    worked.forEach((d) => { d.callCount = 1; });
    for (let extra = REPS[rep].calls - worked.length; extra > 0; extra--) worked[rng.int(worked.length)].callCount++;
  }
  return drafts;
}

interface Timeline {
  createdAt: number;
  firstContactAt: number | null;
  confirmedAt: number | null;
  dispatchedAt: number | null;
  endAt: number | null; // delivered, failed or returned time
  calls: PlannedCall[];
  cancelledAt: number | null;
}

/** One attempt at a timeline from a placement time. Returns null when it does not fit the group's window. */
function attemptTimeline(d: Draft, placedAt: number, rng: Rng): Timeline | null {
  const rep = d.rep as RepKey;
  const delayMin = Math.min(20 * 60, Math.max(1, REPS[rep].medianFirstCallMin * Math.exp(0.9 * rng.normal())));
  const firstContactAt = Math.round(placedAt + delayMin * MIN);

  // Calls: the first at firstContactAt, then every 15 to 60 minutes; the last one decides the order.
  const calls: PlannedCall[] = [];
  let at = firstContactAt;
  for (let i = 0; i < d.callCount; i++) {
    const last = i === d.callCount - 1;
    let outcome: string;
    let declineReason: string | null = null;
    if (!last) outcome = ['no_answer', 'not_reachable', 'rescheduled'][rng.int(3)];
    else if (d.group === 'cancelled') {
      outcome = d.declineReason ? 'declined' : 'cancelled';
      declineReason = d.declineReason;
    } else outcome = 'confirmed';
    calls.push({ at, outcome, durationSec: outcome === 'no_answer' || outcome === 'not_reachable' ? 0 : 30 + rng.int(240), declineReason });
    if (!last) at += Math.round(rng.between(15, 60) * MIN);
  }
  const resolvedAt = at + (rep === 'confirm' ? 1 : 2) * MIN;
  if (resolvedAt > FIXTURE_NOW - 30 * MIN) return null;

  if (d.group === 'cancelled') {
    return { createdAt: placedAt, firstContactAt, confirmedAt: null, dispatchedAt: null, endAt: null, calls, cancelledAt: resolvedAt };
  }
  const confirmedAt = resolvedAt;
  const base = { createdAt: placedAt, firstContactAt, confirmedAt, calls, cancelledAt: null };
  if (d.group === 'waiting') {
    return confirmedAt >= FIXTURE_NOW - 3 * DAY && confirmedAt <= FIXTURE_NOW - HOUR ? { ...base, dispatchedAt: null, endAt: null } : null;
  }

  const partner = PARTNERS[d.partner as PartnerKey];
  const jitter = () => rng.between(0.6, 1.4);
  const dispatchedAt = Math.round(confirmedAt + partner.confirmedToDispatchedDays * DAY * jitter());
  if (d.group === 'out') {
    const earliestDelivery = partner.dispatchedToDeliveredDays * 0.6 * DAY;
    return dispatchedAt <= FIXTURE_NOW - 2 * HOUR && dispatchedAt + earliestDelivery > FIXTURE_NOW ? { ...base, dispatchedAt, endAt: null } : null;
  }
  const endAt = Math.round(dispatchedAt + partner.dispatchedToDeliveredDays * DAY * jitter());
  return endAt <= FIXTURE_NOW - HOUR ? { ...base, dispatchedAt, endAt } : null;
}

function placementTime(group: Group, rng: Rng): number {
  // Orders of the last 3 days sit in the "waiting" and "out" groups; the older ones are closed or cancelled.
  const [firstDay, days] = group === 'waiting' ? [13, 3] : group === 'out' ? [8, 8] : [0, 16];
  return START + (firstDay + rng.int(days)) * DAY + 6 * HOUR + Math.floor(rng.next() * 16 * HOUR);
}

function makeTimeline(d: Draft, rng: Rng): Timeline {
  for (let tries = 0; tries < 50_000; tries++) {
    const t = attemptTimeline(d, placementTime(d.group, rng), rng);
    if (t) return t;
  }
  throw new Error(`fixture: no timeline fits group ${d.group}`);
}

/** Delivered orders: 10 Dictamni-only, 60 add-on-only, 306 with one copybook set; add-ons make the unit totals. */
function deliveredItems(count: number, rng: Rng): { items: Array<Array<{ sku: Sku; qty: number }>>; discounts: number[] } {
  const items: Array<Array<{ sku: Sku; qty: number }>> = Array.from({ length: count }, () => []);
  const kinds = rng.shuffle<'cream' | 'addon' | 'set'>([
    ...repeat<'cream' | 'addon' | 'set'>('cream', DELIVERED_UNITS['DT-CREAM']),
    ...repeat<'cream' | 'addon' | 'set'>('set', DELIVERED_UNITS['MG-COPYBOOK-SET']),
  ].concat(repeat('addon', count - DELIVERED_UNITS['DT-CREAM'] - DELIVERED_UNITS['MG-COPYBOOK-SET'])));
  const addOnOnly: number[] = [];
  const sets: number[] = [];
  kinds.forEach((kind, i) => {
    if (kind === 'cream') items[i].push({ sku: 'DT-CREAM', qty: 1 });
    else if (kind === 'set') { items[i].push({ sku: 'MG-COPYBOOK-SET', qty: 1 }); sets.push(i); }
    else addOnOnly.push(i);
  });

  const addOns: Sku[] = ['MG-REFILL-PENS', 'MG-GRIP-TRAINER', 'MG-PARENT-GUIDE'];
  const need: Record<string, number> = Object.fromEntries(addOns.map((s) => [s, DELIVERED_UNITS[s]]));
  const has = (i: number, sku: Sku) => items[i].some((it) => it.sku === sku);
  // Every add-on-only order gets one add-on first (chosen by what is still needed), then each add-on goes to distinct orders.
  for (const i of addOnOnly) {
    const pool = addOns.flatMap((s) => repeat(s, need[s]));
    const sku = pool[rng.int(pool.length)];
    items[i].push({ sku, qty: 1 });
    need[sku]--;
  }
  const carriers = [...addOnOnly, ...sets];
  for (const sku of addOns) {
    const candidates = rng.shuffle(carriers.filter((i) => !has(i, sku)));
    candidates.slice(0, need[sku]).forEach((i) => items[i].push({ sku, qty: 1 }));
    if (candidates.length < need[sku]) throw new Error(`fixture: not enough orders to carry ${sku}`);
  }

  // Line prices add up to 92,111; three copybook orders carry a GH₵37 discount so the total is exactly 92,000.
  const gross = items.flat().reduce((sum, it) => sum + PRICE[it.sku] * it.qty, 0);
  const discounts = repeat(0, count);
  const extra = gross - DELIVERED_REVENUE;
  if (extra < 0 || extra % 3 !== 0) throw new Error(`fixture: cannot reach ${DELIVERED_REVENUE} from ${gross}`);
  sets.slice(0, 3).forEach((i) => { discounts[i] = extra / 3; });
  return { items, discounts };
}

export function buildFixturePlan(): PlannedOrder[] {
  const rng = makeRng(FIXTURE_SEED);
  const drafts = makeDrafts(rng);

  const deliveredDrafts = drafts.filter((d) => d.group === 'delivered');
  const delivered = deliveredItems(deliveredDrafts.length, rng);
  const deliveredIndex = new Map(deliveredDrafts.map((d, i) => [d, i]));

  const pendingStart = FIXTURE_NOW - 190 * MIN; // oldest pending order waits 3 h 10 min
  let pendingSeen = 0;

  const orders: PlannedOrder[] = drafts.map((d) => {
    let createdAt: number;
    let t: Timeline | null = null;
    if (d.group === 'pending') {
      createdAt = pendingSeen++ === 0 ? pendingStart : pendingStart + Math.floor(rng.next() * 185 * MIN);
    } else {
      t = makeTimeline(d, rng);
      createdAt = t.createdAt;
    }

    let items: Array<{ sku: Sku; qty: number }>;
    let discount = 0;
    if (d.group === 'delivered') {
      const i = deliveredIndex.get(d) as number;
      items = delivered.items[i];
      discount = delivered.discounts[i];
    } else {
      items = [{ sku: 'MG-COPYBOOK-SET', qty: rng.next() < 0.85 ? 1 : 2 }];
    }
    const subtotal = items.reduce((sum, it) => sum + PRICE[it.sku] * it.qty, 0);

    const region = d.partner ? PARTNERS[d.partner] : PARTNERS[PARTNER_KEYS[rng.int(PARTNER_KEYS.length)]];
    const area = region.areas[rng.int(region.areas.length)];

    const history: PlannedHistory[] = [{ status: 'pending_confirmation', from: null, at: createdAt, by: 'system' }];
    if (t && d.group === 'cancelled') history.push({ status: 'cancelled', from: 'pending_confirmation', at: t.cancelledAt as number, by: 'rep' });
    if (t && t.confirmedAt !== null) {
      history.push({ status: 'confirmed', from: 'pending_confirmation', at: t.confirmedAt, by: 'rep' });
      let from: OrderStatusName = 'confirmed';
      if (d.group === 'waiting') {
        // Waiting orders may have moved on to preparing or ready for pickup, somewhere between the confirmation and now.
        const stages: OrderStatusName[] = d.status === 'ready_for_pickup' ? ['preparing', 'ready_for_pickup'] : d.status === 'preparing' ? ['preparing'] : [];
        stages.forEach((status, k) => {
          const span = FIXTURE_NOW - t.confirmedAt!;
          history.push({ status, from, at: t.confirmedAt! + Math.floor((span * (k + 1)) / (stages.length + 1) * 0.5), by: 'admin' });
          from = status;
        });
      } else {
        history.push({ status: 'out_for_delivery', from, at: t.dispatchedAt as number, by: 'admin' });
        if (t.endAt !== null) history.push({ status: d.status, from: 'out_for_delivery', at: t.endAt, by: 'partner' });
      }
    }

    return {
      orderNumber: '',
      group: d.group,
      status: d.status,
      rep: d.rep,
      partner: d.partner,
      items,
      subtotal,
      discount,
      total: subtotal - discount,
      state: region.state,
      area,
      createdAt,
      firstContactAt: t?.firstContactAt ?? null,
      confirmedAt: t?.confirmedAt ?? null,
      dispatchedAt: t?.dispatchedAt ?? null,
      deliveryDate: d.group === 'delivered' ? (t?.endAt ?? null) : null,
      returnedAt: d.group === 'returned' ? (t?.endAt ?? null) : null,
      failureReason: d.failureReason,
      declineReason: d.declineReason,
      calls: t?.calls ?? [],
      history,
    };
  });

  // Order numbers run in placement order.
  orders
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.createdAt - b.o.createdAt || a.i - b.i)
    .forEach(({ o }, n) => { o.orderNumber = String(FIRST_ORDER_NUMBER + n); });
  return orders;
}

/** Counts the plan carries, printed by `--dry-run` in scripts/seed-fixture.ts. */
export function summarizePlan(orders: PlannedOrder[]) {
  const by = <K extends string>(key: (o: PlannedOrder) => K | null | undefined, filter: (o: PlannedOrder) => boolean = () => true) => {
    const out: Record<string, number> = {};
    for (const o of orders.filter(filter)) { const k = key(o); if (k) out[k] = (out[k] ?? 0) + 1; }
    return out;
  };
  const delivered = orders.filter((o) => o.status === 'delivered');
  return {
    orders: orders.length,
    byStatus: by((o) => o.status),
    confirmed: orders.filter((o) => o.confirmedAt !== null).length,
    byPartner: by((o) => o.partner, (o) => o.partner !== null),
    deliveredByPartner: by((o) => o.partner, (o) => o.status === 'delivered'),
    confirmedByRep: by((o) => o.rep, (o) => o.confirmedAt !== null),
    deliveredByRep: by((o) => o.rep, (o) => o.status === 'delivered'),
    calls: orders.reduce((sum, o) => sum + o.calls.length, 0),
    deliveredUnits: delivered.flatMap((o) => o.items).reduce<Record<string, number>>((acc, it) => { acc[it.sku] = (acc[it.sku] ?? 0) + it.qty; return acc; }, {}),
    deliveredRevenue: delivered.reduce((sum, o) => sum + o.total, 0).toFixed(2),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Part 2: January to September history (M1-T24)
// ---------------------------------------------------------------------------------------------------------

/** Delivered revenue by delivery month, January to September 2026, in GH₵ (the Targets mockup). Exact. */
export const HISTORY_MONTH_REVENUE = [118_000, 121_000, 133_000, 131_000, 142_000, 148_000, 158_000, 166_000, 173_000];
/** Net margin of each month (Q1 11%, Q2 12%, Q3 12%), made by the seeded expenses. */
export const HISTORY_MONTH_MARGIN = [0.11, 0.11, 0.11, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12];
/**
 * Average order value of the history orders. January to August are a few large synthetic orders (F-114 allows it);
 * September is ordinary (about GH₵245) so the "last 30 days" AOV on 17 October stays 245 (R12): 18 to 30 September
 * orders are in that window together with October's.
 */
const HISTORY_AVG_ORDER = [2450, 2450, 2450, 2450, 2450, 2450, 2450, 2450, 245];
const HISTORY_FIRST_ORDER_NUMBER = 10001;
const HISTORY_CUSTOMERS = 300;
const COPYBOOK_PRICE = 249;
const COPYBOOK_COGS = 30;
/** Cash held by partners, net of fees (NUMBERS.md): Logiswift 17,300, Kofi 2,900, Esi 2,100, Kwesi 1,100, Kasapa 0. */
export const PARTNER_CASH_HELD: Record<PartnerKey, number> = { logiswift: 17300, kofi: 2900, esi: 2100, kwesi: 1100, kasapa: 0 };
/** Open (draft, verified, approved) collections older than 8 days: the Dashboard's "38 orders unpaid over 8 days" (NUMBERS.md, DESIGN-SPEC rule 7). */
export const OVERDUE_OPEN_COLLECTIONS = 38;
/** How the 38 split across partners; the rest of the collection rows are the ones that must not count (see seedFixture). */
const OVERDUE_OPEN_BY_PARTNER: Partial<Record<PartnerKey, number>> = { logiswift: 20, kofi: 8, esi: 6, kwesi: 4 };
const OPEN_RECENT_COLLECTIONS = 6;
const DEPOSITED_COLLECTIONS = 4;
const RECONCILED_COLLECTIONS = 3;
/** How each month's expense pool is split. */
const EXPENSE_SHARES: Array<[string, number]> = [['Meta ads', 0.62], ['Delivery fees', 0.2], ['Rep commission', 0.06], ['Other expenses', 0.12]];

export interface HistoryOrder {
  orderNumber: string;
  /** 0 = January. */
  monthIndex: number;
  total: number;
  /** Copybook sets on the order; the discount makes the total exact. */
  sets: number;
  discount: number;
  area: string;
  createdAt: number;
  firstContactAt: number;
  confirmedAt: number;
  dispatchedAt: number;
  deliveryDate: number;
}

export interface HistoryExpense { monthIndex: number; category: string; amount: number; expenseDate: number }

/** Delivered orders of January to September 2026, from their own seed. Revenue per delivery month is HISTORY_MONTH_REVENUE exactly. */
export function buildHistoryPlan(): { orders: HistoryOrder[]; expenses: HistoryExpense[] } {
  const rng = makeRng(FIXTURE_SEED + 1);
  const orders: HistoryOrder[] = [];
  const areas = PARTNER_KEYS.flatMap((key) => PARTNERS[key].areas);

  HISTORY_MONTH_REVENUE.forEach((revenue, monthIndex) => {
    const n = Math.round(revenue / HISTORY_AVG_ORDER[monthIndex]);
    const base = Math.floor(revenue / n);
    const totals = Array.from({ length: n }, (_, i) => base + (i < revenue - base * n ? 1 : 0));
    // Spread the totals: move an amount from one order to another, so the month still adds up to the dot.
    const spread = Math.floor(HISTORY_AVG_ORDER[monthIndex] * (monthIndex === 8 ? 0.16 : 0.3));
    for (let i = 0; i + 1 < n; i += 2) {
      const delta = rng.int(2 * spread + 1) - spread;
      totals[i] += delta;
      totals[i + 1] -= delta;
    }
    const days = new Date(Date.UTC(2026, monthIndex + 1, 0)).getUTCDate();
    for (const total of totals) {
      const deliveryDate = Date.UTC(2026, monthIndex, 1 + rng.int(days)) + 8 * HOUR + Math.floor(rng.next() * 10 * HOUR);
      const createdAt = deliveryDate - Math.round(rng.between(3, 5) * DAY);
      const sets = Math.ceil(total / COPYBOOK_PRICE);
      orders.push({
        orderNumber: '', monthIndex, total, sets, discount: sets * COPYBOOK_PRICE - total,
        area: areas[rng.int(areas.length)],
        createdAt,
        firstContactAt: createdAt + Math.round(rng.between(2, 9) * MIN),
        confirmedAt: createdAt + Math.round(rng.between(10, 180) * MIN),
        dispatchedAt: deliveryDate - Math.round(rng.between(0.8, 2) * DAY),
        deliveryDate,
      });
    }
  });
  orders
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.createdAt - b.o.createdAt || a.i - b.i)
    .forEach(({ o }, n) => { o.orderNumber = String(HISTORY_FIRST_ORDER_NUMBER + n); });

  // Expenses: each month's pool = revenue x (1 - margin) - product cost of that month's orders, so the month's net
  // margin (revenue - product cost - expenses) / revenue is the margin above. Whole GH₵; the last share takes the rest.
  const expenses: HistoryExpense[] = [];
  HISTORY_MONTH_REVENUE.forEach((revenue, monthIndex) => {
    const cogs = orders.filter((o) => o.monthIndex === monthIndex).reduce((sum, o) => sum + o.sets * COPYBOOK_COGS, 0);
    const pool = Math.round(revenue * (1 - HISTORY_MONTH_MARGIN[monthIndex])) - cogs;
    let left = pool;
    EXPENSE_SHARES.forEach(([category, share], k) => {
      const amount = k === EXPENSE_SHARES.length - 1 ? left : Math.round(pool * share);
      left -= amount;
      expenses.push({ monthIndex, category, amount, expenseDate: Date.UTC(2026, monthIndex, 25, 12) });
    });
  });
  return { orders, expenses };
}

/** Targets of the fixture (NUMBERS.md North Star: GH₵1.8M a year, 180k in October, 70% confirmation, 60% success). */
function fixtureTargets() {
  const date = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  const year = { periodStart: date(2026, 1, 1), periodEnd: date(2026, 12, 31) };
  return {
    northStar: { scope: 'north_star' as const, metric: 'revenue', unit: 'money', ...year, value: '1800000.0000' },
    // "Grow each quarter" (F-1112): Q1 360k, Q2 420k, Q3 480k, Q4 540k.
    quarters: [360_000, 420_000, 480_000, 540_000].map((v, q) => ({
      scope: 'quarter' as const, metric: 'revenue', unit: 'money',
      periodStart: date(2026, q * 3 + 1, 1), periodEnd: date(2026, q * 3 + 4, 0), value: `${v}.0000`,
    })),
    october: { scope: 'month' as const, metric: 'revenue', unit: 'money', periodStart: date(2026, 10, 1), periodEnd: date(2026, 10, 31), value: '180000.0000' },
    rates: [
      { scope: 'north_star' as const, metric: 'confirmation_rate', unit: 'percent', ...year, value: '70.0000' },
      { scope: 'north_star' as const, metric: 'delivery_success_rate', unit: 'percent', ...year, value: '60.0000' },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------------------------------

interface SeedFixtureOptions {
  /** Called with progress lines. Silent when absent. */
  log?: (line: string) => void;
}

export interface SeedFixtureResult {
  tenantId: string;
  hash: string;
  /** October orders (placed 1 to 17 October). */
  orders: number;
  /** Delivered revenue of those October orders. */
  deliveredRevenue: string;
  /** Delivered orders of January to September (part 2). */
  historyOrders: number;
  expenses: number;
}

const money = (n: number) => n.toFixed(4);
const at = (ms: number | null) => (ms === null ? null : new Date(ms));
const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Deletes every row of the fixture tenant (children first). Touches no other tenant. Keeps the tenant row. */
export async function deleteFixtureRows(prisma: PrismaClient, tenantId: string): Promise<void> {
  const t = { tenantId };
  await prisma.stockCountLine.deleteMany({ where: t });
  await prisma.stockCount.deleteMany({ where: t });
  await prisma.inventoryTransfer.deleteMany({ where: t });
  await prisma.inventoryShipment.deleteMany({ where: t });
  await prisma.stockLevel.deleteMany({ where: t });
  await prisma.stockLocation.deleteMany({ where: t });
  await prisma.target.deleteMany({ where: { ...t, parentId: { not: null } } });
  await prisma.target.deleteMany({ where: t });
  await prisma.expense.deleteMany({ where: t });
  await prisma.agentBalance.deleteMany({ where: t });
  await prisma.agentCollection.deleteMany({ where: t }); // something else may have written drafts for fixture orders
  // Rows the e2e setup step adds (delivery proofs, partner profiles) hang on fixture orders and users
  await prisma.deliveryAttempt.deleteMany({ where: t });
  await prisma.delivery.deleteMany({ where: t });
  await prisma.deliveryPartnerProfile.deleteMany({ where: t });
  await prisma.feeRule.deleteMany({ where: t });
  await prisma.orderItem.deleteMany({ where: { order: t } });
  await prisma.orderHistory.deleteMany({ where: t });
  await prisma.call.deleteMany({ where: t });
  await prisma.accountTransaction.deleteMany({ where: t });
  await prisma.order.deleteMany({ where: t });
  await prisma.journalEntry.deleteMany({ where: t });
  await prisma.emailTemplate.deleteMany({ where: t });
  await prisma.account.deleteMany({ where: { ...t, parentId: { not: null } } });
  await prisma.account.deleteMany({ where: t });
  await prisma.product.deleteMany({ where: t });
  await prisma.customer.deleteMany({ where: t });
  await prisma.user.deleteMany({ where: t });
}

const FIRST_NAMES = ['Ama', 'Kwame', 'Akosua', 'Yaw', 'Abena', 'Kofi', 'Efua', 'Kojo', 'Gifty', 'Nii', 'Mercy', 'Selina', 'Kwabena', 'Adjoa', 'Fiifi', 'Araba'];
const LAST_NAMES = ['Mensah', 'Owusu', 'Asante', 'Boateng', 'Addo', 'Annan', 'Frimpong', 'Tetteh', 'Lamptey', 'Agyeman', 'Nkrumah', 'Osei', 'Amoah', 'Quaye', 'Darko', 'Ofori'];

/** Hash of the order data (order numbers, statuses, totals, people, dates) read back from the database. No row ids. */
async function fixtureHash(prisma: PrismaClient, tenantId: string): Promise<string> {
  const rows = await prisma.order.findMany({
    where: { tenantId },
    orderBy: { externalOrderId: 'asc' },
    select: {
      externalOrderId: true, status: true, totalAmount: true, createdAt: true, confirmedAt: true, deliveryDate: true,
      customerRep: { select: { email: true } }, deliveryAgent: { select: { email: true } },
    },
  });
  const hash = createHash('sha256');
  let revenue = 0;
  let delivered = 0;
  for (const r of rows) {
    hash.update([
      r.externalOrderId, r.status, r.totalAmount.toFixed(4), r.createdAt.toISOString(), r.confirmedAt?.toISOString() ?? '',
      r.deliveryDate?.toISOString() ?? '', r.customerRep?.email ?? '', r.deliveryAgent?.email ?? '',
    ].join('|') + '\n');
    if (r.status === 'delivered') { delivered++; revenue += Number(r.totalAmount); }
  }
  hash.update(`totals|${rows.length}|${delivered}|${revenue.toFixed(2)}`);
  // Part 2 rows: expenses, targets and partner cash (no ids).
  const [expenses, targets, balances, collections] = await Promise.all([
    prisma.expense.findMany({ where: { tenantId }, orderBy: [{ expenseDate: 'asc' }, { category: 'asc' }], select: { category: true, amount: true, expenseDate: true } }),
    prisma.target.findMany({ where: { tenantId }, orderBy: [{ scope: 'asc' }, { metric: 'asc' }, { periodStart: 'asc' }], select: { scope: true, metric: true, periodStart: true, value: true } }),
    prisma.agentBalance.findMany({ where: { tenantId }, orderBy: { currentBalance: 'desc' }, select: { currentBalance: true, agent: { select: { email: true } } } }),
    prisma.agentCollection.findMany({ where: { tenantId }, orderBy: { order: { externalOrderId: 'asc' } }, select: { status: true, amount: true, allocatedAmount: true, collectionDate: true, order: { select: { externalOrderId: true } } } }),
  ]);
  for (const e of expenses) hash.update(`expense|${e.category}|${e.amount.toFixed(4)}|${e.expenseDate.toISOString()}\n`);
  for (const t of targets) hash.update(`target|${t.scope}|${t.metric}|${t.periodStart.toISOString()}|${t.value.toFixed(4)}\n`);
  for (const b of balances) hash.update(`balance|${b.agent.email}|${b.currentBalance.toFixed(4)}\n`);
  for (const c of collections) hash.update(`collection|${c.order.externalOrderId}|${c.status}|${c.amount.toFixed(4)}|${c.allocatedAmount.toFixed(4)}|${c.collectionDate.toISOString()}\n`);
  // Product prices and costs (F-600 margins).
  for (const x of await prisma.product.findMany({ where: { tenantId }, orderBy: { sku: 'asc' }, select: { sku: true, price: true, cogs: true } })) hash.update(`product|${x.sku}|${x.price.toFixed(4)}|${x.cogs?.toFixed(4)}\n`);
  // Part 3 rows: locations, levels, shipments, counts and movements (no ids).
  const [locations, levels, shipments, counts, movements] = await Promise.all([
    prisma.stockLocation.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: { name: true, type: true, user: { select: { email: true } } } }),
    prisma.stockLevel.findMany({ where: { tenantId }, orderBy: [{ location: { name: 'asc' } }, { product: { sku: 'asc' } }], select: { quantity: true, location: { select: { name: true } }, product: { select: { sku: true } } } }),
    prisma.inventoryShipment.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { supplier: true, quantity: true, totalCost: true, status: true, currency: true, expectedArrivalDate: true, quantityCounted: true, shortQuantity: true, landedCostPerUnit: true, claimStatus: true, claimAmount: true, receivedAt: true } }),
    prisma.stockCountLine.findMany({ where: { tenantId }, orderBy: [{ count: { countDate: 'asc' } }, { product: { sku: 'asc' } }], select: { systemQuantity: true, countedQuantity: true, difference: true, count: { select: { countDate: true, source: true, location: { select: { name: true } } } }, product: { select: { sku: true } } } }),
    prisma.inventoryTransfer.findMany({ where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { transferType: 'asc' }, { productId: 'asc' }, { quantity: 'asc' }], select: { transferType: true, status: true, quantity: true, receivedQuantity: true, createdAt: true, product: { select: { sku: true } }, fromLocation: { select: { name: true } }, toLocation: { select: { name: true } } } }),
  ]);
  for (const l of locations) hash.update(`location|${l.name}|${l.type}|${l.user?.email ?? ''}\n`);
  for (const l of levels) hash.update(`level|${l.location.name}|${l.product.sku}|${l.quantity}\n`);
  for (const x of shipments) hash.update(`shipment|${x.supplier}|${x.quantity}|${x.totalCost.toFixed(4)}|${x.status}|${x.currency}|${x.expectedArrivalDate?.toISOString()}|${x.quantityCounted}|${x.shortQuantity}|${x.landedCostPerUnit?.toFixed(4)}|${x.claimStatus}|${x.claimAmount.toFixed(4)}|${x.receivedAt?.toISOString()}\n`);
  for (const c of counts) hash.update(`count|${c.count.location.name}|${c.count.countDate.toISOString()}|${c.count.source}|${c.product.sku}|${c.systemQuantity}|${c.countedQuantity}|${c.difference}\n`);
  for (const m of movements) hash.update(`move|${m.transferType}|${m.status}|${m.product.sku}|${m.quantity}|${m.receivedQuantity ?? ''}|${m.fromLocation?.name ?? ''}|${m.toLocation?.name ?? ''}|${m.createdAt.toISOString()}\n`);
  return hash.digest('hex');
}

export async function seedFixture(prisma: PrismaClient, opts: SeedFixtureOptions = {}): Promise<SeedFixtureResult> {
  const log = opts.log ?? (() => undefined);
  const plan = buildFixturePlan();

  const tenant = await prisma.tenant.upsert({
    where: { slug: FIXTURE_SLUG },
    update: { name: FIXTURE_NAME, currency: 'GHS' },
    create: { name: FIXTURE_NAME, slug: FIXTURE_SLUG, currency: 'GHS' },
  });
  const tenantId = tenant.id;

  log('Deleting the fixture tenant rows');
  await deleteFixtureRows(prisma, tenantId);
  GLAccountService.clearCache(); // the old accounts are gone; a cached id would point at one of them

  log('Creating users, products and the chart of accounts');
  await seedTenantDefaults(tenantId);
  const userSpecs = [
    { key: 'fixture-admin', first: 'Fixture', last: 'Admin', role: 'admin' as const },
    ...REP_KEYS.map((key) => ({ key: `rep-${key}`, first: REPS[key].first, last: REPS[key].last, role: 'sales_rep' as const })),
    ...PARTNER_KEYS.map((key) => ({ key: `partner-${key}`, first: PARTNERS[key].first, last: PARTNERS[key].last, role: 'delivery_agent' as const })),
  ];
  await prisma.user.createMany({
    data: userSpecs.map((u) => ({ email: `${u.key}@${EMAIL_DOMAIN}`, password: 'x', firstName: u.first, lastName: u.last, role: u.role, tenantId })),
  });
  const userId = new Map((await prisma.user.findMany({ where: { tenantId }, select: { id: true, email: true } })).map((u) => [u.email, u.id]));
  const idByKey = (key: string) => userId.get(`${key}@${EMAIL_DOMAIN}`) as number;
  const admin = { id: idByKey('fixture-admin') };
  const repIds = {} as Record<RepKey, number>;
  for (const key of REP_KEYS) repIds[key] = idByKey(`rep-${key}`);
  const partnerIds = {} as Record<PartnerKey, number>;
  for (const key of PARTNER_KEYS) partnerIds[key] = idByKey(`partner-${key}`);

  await prisma.product.createMany({
    data: PRODUCTS.map((p) => ({
      sku: p.sku, name: p.name, category: p.category, price: money(p.price), cogs: p.cogs, stockQuantity: stockCache(p.sku), tenantId,
    })),
  });
  const productId = Object.fromEntries(
    (await prisma.product.findMany({ where: { tenantId }, select: { id: true, sku: true } })).map((p) => [p.sku, p.id]),
  ) as Record<Sku, number>;

  log(`Creating ${plan.length} customers and orders`);
  await prisma.customer.createMany({
    data: plan.map((o, i) => ({
      firstName: FIRST_NAMES[i % FIRST_NAMES.length],
      lastName: LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length],
      phoneNumber: `+23324${String(1_000_000 + i).padStart(7, '0')}`,
      address: `${(i % 90) + 1} ${o.area} Road`,
      state: o.state,
      area: o.area,
      tenantId,
    })),
  });
  const customerByPhone = new Map(
    (await prisma.customer.findMany({ where: { tenantId }, select: { id: true, phoneNumber: true } })).map((c) => [c.phoneNumber, c.id]),
  );

  const orderData = plan.map((o, i) => {
    const customerId = customerByPhone.get(`+23324${String(1_000_000 + i).padStart(7, '0')}`) as number;
    return {
      customerId,
      customerRepId: o.rep ? repIds[o.rep] : null,
      deliveryAgentId: o.partner ? partnerIds[o.partner] : null,
      status: o.status,
      paymentStatus: o.status === 'delivered' ? ('collected' as const) : ('pending' as const),
      subtotal: money(o.subtotal),
      shippingCost: money(0),
      discount: money(o.discount),
      totalAmount: money(o.total),
      codAmount: money(o.total),
      paymentMethod: 'cod',
      source: 'fixture',
      externalOrderId: o.orderNumber,
      deliveryAddress: `${(i % 90) + 1} ${o.area} Road`,
      deliveryState: o.state,
      deliveryArea: o.area,
      createdAt: new Date(o.createdAt),
      firstContactAt: at(o.firstContactAt),
      confirmedAt: at(o.confirmedAt),
      confirmedById: o.confirmedAt !== null && o.rep ? repIds[o.rep] : null,
      dispatchedAt: at(o.dispatchedAt),
      deliveryDate: at(o.deliveryDate),
      returnedAt: at(o.returnedAt),
      failureReason: o.failureReason as any,
      declineReason: o.declineReason as any,
      tenantId,
    };
  });
  for (const part of chunks(orderData, 400)) await prisma.order.createMany({ data: part });
  const orderIdByNumber = new Map(
    (await prisma.order.findMany({ where: { tenantId }, select: { id: true, externalOrderId: true } })).map((o) => [o.externalOrderId as string, o.id]),
  );
  const idOf = (o: PlannedOrder) => orderIdByNumber.get(o.orderNumber) as number;
  const customerIdOf = (i: number) => orderData[i].customerId;

  log('Creating items, history and calls');
  const itemRows = plan.flatMap((o) => o.items.map((it) => ({
    orderId: idOf(o), productId: productId[it.sku], quantity: it.qty, unitPrice: money(PRICE[it.sku]), totalPrice: money(PRICE[it.sku] * it.qty),
  })));
  for (const part of chunks(itemRows, 1000)) await prisma.orderItem.createMany({ data: part });

  const actorOf = (o: PlannedOrder, by: PlannedHistory['by']) => {
    if (by === 'rep' && o.rep) return { changedBy: repIds[o.rep], actorKind: o.rep === 'confirm' ? ('ai' as const) : ('user' as const) };
    if (by === 'partner' && o.partner) return { changedBy: partnerIds[o.partner], actorKind: 'user' as const };
    if (by === 'admin') return { changedBy: admin.id, actorKind: 'user' as const };
    return { changedBy: null, actorKind: 'system' as const };
  };
  const historyRows = plan.flatMap((o) => o.history.map((h) => ({
    orderId: idOf(o), status: h.status, fromStatus: h.from, createdAt: new Date(h.at), tenantId, ...actorOf(o, h.by),
  })));
  for (const part of chunks(historyRows, 1000)) await prisma.orderHistory.createMany({ data: part });

  const callRows = plan.flatMap((o, i) => o.calls.map((c) => ({
    orderId: idOf(o),
    customerId: customerIdOf(i),
    salesRepId: repIds[o.rep as RepKey],
    outcome: c.outcome as any,
    duration: c.durationSec,
    declineReason: c.declineReason as any,
    source: o.rep === 'confirm' ? ('auto_confirm' as const) : ('manual' as const),
    createdAt: new Date(c.at),
    startedAt: new Date(c.at),
    tenantId,
  })));
  for (const part of chunks(callRows, 1000)) await prisma.call.createMany({ data: part });

  // Part 2: January to September delivered orders (own customers, no rep, no partner, no calls), their items and
  // history rows, expenses, targets and cash held by partners.
  log('Creating the January to September history, expenses, targets and partner cash');
  const history = buildHistoryPlan();
  await prisma.customer.createMany({
    data: Array.from({ length: HISTORY_CUSTOMERS }, (_, i) => ({
      firstName: FIRST_NAMES[i % FIRST_NAMES.length],
      lastName: LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length],
      phoneNumber: `+23325${String(1_000_000 + i).padStart(7, '0')}`,
      address: `${(i % 90) + 1} Old Road`, state: 'Greater Accra', area: 'Accra', tenantId,
    })),
  });
  const historyCustomerIds = (await prisma.customer.findMany({ where: { tenantId, phoneNumber: { startsWith: '+23325' } }, select: { id: true, phoneNumber: true }, orderBy: { phoneNumber: 'asc' } })).map((c) => c.id);
  const historyOrderData = history.orders.map((o, i) => ({
    customerId: historyCustomerIds[i % HISTORY_CUSTOMERS],
    customerRepId: null,
    deliveryAgentId: null,
    status: 'delivered' as const,
    paymentStatus: 'collected' as const,
    subtotal: money(o.sets * COPYBOOK_PRICE),
    shippingCost: money(0),
    discount: money(o.discount),
    totalAmount: money(o.total),
    codAmount: money(o.total),
    paymentMethod: 'cod',
    source: 'fixture',
    externalOrderId: o.orderNumber,
    deliveryAddress: `${(i % 90) + 1} ${o.area} Road`,
    deliveryState: 'Greater Accra',
    deliveryArea: o.area,
    createdAt: new Date(o.createdAt),
    firstContactAt: new Date(o.firstContactAt),
    confirmedAt: new Date(o.confirmedAt),
    dispatchedAt: new Date(o.dispatchedAt),
    deliveryDate: new Date(o.deliveryDate),
    tenantId,
  }));
  for (const part of chunks(historyOrderData, 400)) await prisma.order.createMany({ data: part });
  const historyIdByNumber = new Map(
    (await prisma.order.findMany({ where: { tenantId, externalOrderId: { in: history.orders.map((o) => o.orderNumber) } }, select: { id: true, externalOrderId: true } }))
      .map((o) => [o.externalOrderId as string, o.id]),
  );
  const historyId = (o: HistoryOrder) => historyIdByNumber.get(o.orderNumber) as number;
  const historyItemRows = history.orders.map((o) => ({
    orderId: historyId(o), productId: productId['MG-COPYBOOK-SET'], quantity: o.sets, unitPrice: money(COPYBOOK_PRICE), totalPrice: money(o.sets * COPYBOOK_PRICE),
  }));
  for (const part of chunks(historyItemRows, 1000)) await prisma.orderItem.createMany({ data: part });
  const historyStatusRows = history.orders.flatMap((o) => {
    const id = historyId(o);
    return [
      { orderId: id, status: 'pending_confirmation' as const, fromStatus: null, createdAt: new Date(o.createdAt), tenantId, changedBy: null, actorKind: 'system' as const },
      { orderId: id, status: 'confirmed' as const, fromStatus: 'pending_confirmation' as const, createdAt: new Date(o.confirmedAt), tenantId, changedBy: admin.id, actorKind: 'user' as const },
      { orderId: id, status: 'out_for_delivery' as const, fromStatus: 'confirmed' as const, createdAt: new Date(o.dispatchedAt), tenantId, changedBy: admin.id, actorKind: 'user' as const },
      { orderId: id, status: 'delivered' as const, fromStatus: 'out_for_delivery' as const, createdAt: new Date(o.deliveryDate), tenantId, changedBy: admin.id, actorKind: 'user' as const },
    ];
  });
  for (const part of chunks(historyStatusRows, 1000)) await prisma.orderHistory.createMany({ data: part });

  await prisma.expense.createMany({
    data: history.expenses.map((e) => ({
      category: e.category, amount: money(e.amount), description: `${e.category}, ${new Date(e.expenseDate).toISOString().slice(0, 7)} (fixture)`,
      recordedBy: admin.id, expenseDate: new Date(e.expenseDate), tenantId,
    })),
  });

  const targets = fixtureTargets();
  const northStar = await prisma.target.create({ data: { ...targets.northStar, tenantId } });
  const quarters = await Promise.all(targets.quarters.map((q) => prisma.target.create({ data: { ...q, parentId: northStar.id, tenantId } })));
  await prisma.target.create({ data: { ...targets.october, parentId: quarters[3].id, tenantId } });
  await prisma.target.createMany({ data: targets.rates.map((r) => ({ ...r, tenantId })) });

  // Cash held by each partner, net of fees. The app keeps it on AgentBalance (collected less deposited).
  await prisma.agentBalance.createMany({
    data: PARTNER_KEYS.map((key) => ({
      agentId: partnerIds[key], totalCollected: money(PARTNER_CASH_HELD[key]), totalDeposited: money(0), currentBalance: money(PARTNER_CASH_HELD[key]), tenantId,
    })),
  });

  // One AgentCollection per order (collectionDate = deliveryDate, amount = total) on delivered fixture orders of the right partner.
  // The 38 open ones older than 8 days are what the cash tile's "orders over 8 days" counts; the rest must not count.
  const cutoff = FIXTURE_NOW - CASH_OVERDUE_DAYS * DAY;
  const deliveredByPartner = (key: PartnerKey, old: boolean) => plan
    .filter((o) => o.status === 'delivered' && o.partner === key && o.deliveryDate !== null && (o.deliveryDate < cutoff) === old)
    .sort((a, b) => (a.orderNumber < b.orderNumber ? -1 : 1));
  const oldPool = Object.fromEntries(PARTNER_KEYS.map((k) => [k, deliveredByPartner(k, true)])) as Record<PartnerKey, PlannedOrder[]>;
  const newPool = Object.fromEntries(PARTNER_KEYS.map((k) => [k, deliveredByPartner(k, false)])) as Record<PartnerKey, PlannedOrder[]>;
  const take = (pool: PlannedOrder[], n: number) => {
    if (pool.length < n) throw new Error(`The fixture plan has too few delivered orders for the collection rows (need ${n}, have ${pool.length})`);
    return pool.splice(0, n);
  };
  const openStatuses = ['draft', 'verified', 'approved'] as const;
  const collectionRows: Array<{ order: PlannedOrder; status: 'draft' | 'verified' | 'approved' | 'deposited' | 'reconciled'; part: boolean }> = [];
  let n = 0;
  for (const key of PARTNER_KEYS) {
    for (const order of take(oldPool[key], OVERDUE_OPEN_BY_PARTNER[key] ?? 0)) {
      const status = openStatuses[n % 3];
      collectionRows.push({ order, status, part: status === 'approved' && n % 6 === 2 }); // every other approved one is part-paid
      n++;
    }
  }
  const spread = PARTNER_KEYS.filter((k) => OVERDUE_OPEN_BY_PARTNER[k]);
  for (let i = 0; i < OPEN_RECENT_COLLECTIONS; i++) collectionRows.push({ order: take(newPool[spread[i % spread.length]], 1)[0], status: openStatuses[i % 3], part: false });
  for (let i = 0; i < DEPOSITED_COLLECTIONS; i++) collectionRows.push({ order: take(oldPool[spread[i % spread.length]], 1)[0], status: 'deposited', part: false });
  for (let i = 0; i < RECONCILED_COLLECTIONS; i++) collectionRows.push({ order: take(oldPool[spread[i % spread.length]], 1)[0], status: 'reconciled', part: false });
  await prisma.agentCollection.createMany({
    data: collectionRows.map(({ order, status, part }) => ({
      orderId: idOf(order), agentId: partnerIds[order.partner as PartnerKey], amount: money(order.total),
      allocatedAmount: money(status === 'deposited' || status === 'reconciled' ? order.total : part ? Math.round(order.total / 2) : 0),
      status, collectionDate: new Date(order.deliveryDate as number), tenantId,
    })),
  });

  // Part 3 (M4-T05): stock. Rows are written directly because no stock service exists yet (stockService arrives in M4-T06).
  log('Creating stock locations, levels, the 9 October shipment, the 15 October count and the returns');
  await prisma.stockLocation.createMany({
    data: STOCK_LOCATIONS.map((l) => ({ tenantId, type: l.type, name: l.name, address: l.address, userId: l.partner ? partnerIds[l.partner] : null })),
  });
  const locationId = Object.fromEntries(
    (await prisma.stockLocation.findMany({ where: { tenantId }, select: { id: true, name: true } })).map((l) => [l.name, l.id]),
  ) as Record<string, number>;
  const at1Oct = new Date(START + 8 * HOUR);
  const holders = [['Logiswift', STOCK_AT.logiswift], ['Kofi Appiah', STOCK_AT.kofi]] as const;
  const levelRows = holders.flatMap(([name, bySku]) => (Object.entries(bySku) as Array<[Sku, number]>).map(([sku, quantity]) => ({
    tenantId, locationId: locationId[name], productId: productId[sku], quantity,
  })));
  await prisma.stockLevel.createMany({ data: levelRows });
  await prisma.inventoryTransfer.createMany({
    data: levelRows.map((l) => ({
      tenantId, productId: l.productId, quantity: l.quantity, transferType: 'opening' as const, toLocationId: l.locationId,
      status: 'received' as const, createdById: admin.id, createdAt: at1Oct, notes: 'Fixture opening balance',
    })),
  });

  // The 9 October shipment: 300 shipped at GH₵27.00, shipping 450, other 150 (total 8,700); 288 counted, 12 short;
  // landed cost 8,700 / 288 = 30.2083; open supplier claim 12 x 27 = 324. No ledger entry here (the receive service posts it, M4-T12).
  const received9Oct = new Date(Date.UTC(2026, 9, 9, 10, 0, 0));
  const shipment = await prisma.inventoryShipment.create({
    data: {
      tenantId, productId: productId['MG-COPYBOOK-SET'], supplier: 'Accra Print House', quantity: 300,
      unitCost: money(27), shippingCost: money(450), customsDuties: money(0), otherCosts: money(150), totalCost: money(8700),
      status: 'received', arrivedAt: received9Oct, receivedAt: received9Oct, receivedById: admin.id, createdById: admin.id,
      createdAt: new Date(Date.UTC(2026, 9, 2, 9, 0, 0)), expectedArrivalDate: received9Oct,
      currency: 'GHS', totalCostStore: money(8700), landedCostPerUnit: money(8700 / 288),
      quantityCounted: 288, shortQuantity: 12, destinationLocationId: locationId['Logiswift'],
      claimStatus: 'open', claimAmount: money(12 * 27), claimNote: 'Short on arrival: 12 units',
    },
  });
  // The 3 pending shipments of the Incoming shipments tab (mockup): 3 pending, 1,500 units, GH₵24,950 to land.
  // total = quantity x unit cost + shipping + customs + other: 12,000 + 7,500 + 5,450.
  const pendingShipments = [
    { sku: 'MG-COPYBOOK-SET', supplier: 'Accra Print House', quantity: 400, unit: 27.9, shipping: 640, customs: 0, other: 200, expected: Date.UTC(2026, 9, 22), created: Date.UTC(2026, 9, 18, 9, 0, 0) },
    { sku: 'MG-REFILL-PENS', supplier: 'Guangzhou Stationery', quantity: 600, unit: 9.5, shipping: 1200, customs: 600, other: 0, expected: Date.UTC(2026, 9, 29), created: Date.UTC(2026, 9, 19, 9, 0, 0) },
    { sku: 'MG-GRIP-TRAINER', supplier: 'Guangzhou Stationery', quantity: 500, unit: 8, shipping: 900, customs: 450, other: 100, expected: Date.UTC(2026, 10, 3), created: Date.UTC(2026, 9, 20, 9, 0, 0) },
  ] as const;
  for (const p of pendingShipments) {
    await prisma.inventoryShipment.create({
      data: {
        tenantId, productId: productId[p.sku], supplier: p.supplier, quantity: p.quantity,
        unitCost: money(p.unit), shippingCost: money(p.shipping), customsDuties: money(p.customs), otherCosts: money(p.other),
        totalCost: money(p.quantity * p.unit + p.shipping + p.customs + p.other), status: 'pending', currency: 'GHS',
        expectedArrivalDate: new Date(p.expected), createdById: admin.id, createdAt: new Date(p.created),
      },
    });
  }
  await prisma.inventoryTransfer.create({
    data: {
      tenantId, productId: productId['MG-COPYBOOK-SET'], quantity: 288, transferType: 'receipt', toLocationId: locationId['Logiswift'],
      shipmentId: shipment.id, status: 'received', receivedQuantity: 288, receivedAt: received9Oct, receivedById: admin.id,
      createdById: admin.id, createdAt: received9Oct, notes: 'Shipment received, 12 short',
    },
  });
  // 20 copybook sets from Logiswift to Kofi, sent 17 Oct 11:20, not yet received.
  await prisma.inventoryTransfer.create({
    data: {
      tenantId, productId: productId['MG-COPYBOOK-SET'], quantity: 20, transferType: 'allocation',
      fromLocationId: locationId['Logiswift'], toLocationId: locationId['Kofi Appiah'], status: 'in_transit',
      createdById: admin.id, createdAt: new Date(Date.UTC(2026, 9, 17, 11, 20, 0)),
    },
  });
  // Returns: Logiswift sent back 41 units, we received 36 (5 missing). The destination (own store) is not set up in the fixture.
  await prisma.inventoryTransfer.create({
    data: {
      tenantId, productId: productId['MG-COPYBOOK-SET'], quantity: 41, transferType: 'return_to_warehouse',
      fromLocationId: locationId['Logiswift'], status: 'disputed', receivedQuantity: 36, receivedAt: new Date(Date.UTC(2026, 9, 16, 12, 0, 0)),
      receivedById: admin.id, reason: 'not_received', createdById: admin.id, createdAt: new Date(Date.UTC(2026, 9, 14, 12, 0, 0)),
    },
  });
  // 3PL count of Logiswift on 15 October: copybook 188 against our 200 (12 off); pens and grip trainer match.
  // Counted on 15 Oct, saved at 17 Oct 12:00, after the 11:20 allocation to Kofi above: units that leave a location after its count
  // make the count old (F-652), so the count stays current only if it was saved after them.
  const count = await prisma.stockCount.create({
    data: { tenantId, locationId: locationId['Logiswift'], countDate: new Date(Date.UTC(2026, 9, 15)), source: 'three_pl_dashboard', countedById: admin.id, createdAt: new Date(Date.UTC(2026, 9, 17, 12, 0, 0)) },
  });
  const counted: Partial<Record<Sku, number>> = { ...STOCK_AT.logiswift, 'MG-COPYBOOK-SET': 188 };
  await prisma.stockCountLine.createMany({
    data: (Object.keys(STOCK_AT.logiswift) as Sku[]).map((sku) => {
      const systemQuantity = STOCK_AT.logiswift[sku] ?? 0;
      const countedQuantity = counted[sku] ?? 0;
      return { tenantId, countId: count.id, productId: productId[sku], systemQuantity, countedQuantity, difference: countedQuantity - systemQuantity };
    }),
  });

  // One revenue journal entry per delivered order, posted by the same function the delivery path calls
  // (dated deliveryDate). The order links to its entry, as the status path does.
  log('Posting revenue entries for the delivered orders');
  const delivered = plan.filter((o) => o.status === 'delivered');
  await runInTenant(tenantId, async () => {
    const deliveredIds = [...delivered.map(idOf), ...history.orders.map(historyId)];
    const loaded = new Map((await prisma.order.findMany({ where: { id: { in: deliveredIds } }, include: ORDER_GL_INCLUDE })).map((o) => [o.id, o]));
    const orders = deliveredIds.map((id) => loaded.get(id) as NonNullable<ReturnType<typeof loaded.get>>); // plan order, so entry numbers are stable
    for (const part of chunks(orders, 50)) {
      await prisma.$transaction(async (tx) => {
        for (const order of part) {
          const entry = await GLAutomationService.createRevenueRecognitionEntry(
            tx as any, order as any, GLAutomationService.calculateTotalCOGS(order.orderItems), admin.id,
          );
          await tx.order.update({ where: { id: order.id }, data: { glJournalEntryId: entry.id } });
        }
      }, { timeout: 60_000 });
    }
  });

  const hash = await fixtureHash(prisma, tenantId);
  return {
    tenantId, hash, orders: plan.length, deliveredRevenue: delivered.reduce((s, o) => s + o.total, 0).toFixed(2),
    historyOrders: history.orders.length, expenses: history.expenses.length,
  };
}

/** October order counts (placed from 1 October) read from the database with SQL, for the script's final print. Tests run their own queries. */
export async function fixtureCounts(prisma: PrismaClient, tenantId: string) {
  const [status, partner, rep, units, totals, calls] = await Promise.all([
    prisma.$queryRaw<Array<{ k: string; n: bigint }>>`SELECT status::text AS k, COUNT(*) AS n FROM orders WHERE tenant_id = ${tenantId} AND created_at >= '2026-10-01' GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ k: string; assigned: bigint; delivered: bigint }>>`
      SELECT u.first_name AS k, COUNT(*) AS assigned, COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered
      FROM orders o JOIN users u ON u.id = o.delivery_agent_id WHERE o.tenant_id = ${tenantId} AND o.created_at >= '2026-10-01' GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ k: string; confirmed: bigint; delivered: bigint }>>`
      SELECT u.first_name AS k, COUNT(*) FILTER (WHERE o.confirmed_at IS NOT NULL) AS confirmed,
             COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered
      FROM orders o JOIN users u ON u.id = o.customer_rep_id WHERE o.tenant_id = ${tenantId} AND o.created_at >= '2026-10-01' GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ k: string; units: bigint }>>`
      SELECT p.sku AS k, SUM(i.quantity) AS units FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
      WHERE o.tenant_id = ${tenantId} AND o.status = 'delivered' AND o.created_at >= '2026-10-01' GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ confirmed: bigint; revenue: string }>>`
      SELECT COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) AS confirmed,
             TO_CHAR(COALESCE(SUM(total_amount) FILTER (WHERE status = 'delivered'), 0), 'FM999999990.00') AS revenue
      FROM orders WHERE tenant_id = ${tenantId} AND created_at >= '2026-10-01'`,
    prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM calls WHERE tenant_id = ${tenantId}`,
  ]);
  const plain = (list: Array<Record<string, unknown>>) => list.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
  return {
    byStatus: plain(status), byPartner: plain(partner), byRep: plain(rep), deliveredUnits: plain(units),
    confirmed: Number(totals[0].confirmed), deliveredRevenue: totals[0].revenue, calls: Number(calls[0].n),
  };
}
