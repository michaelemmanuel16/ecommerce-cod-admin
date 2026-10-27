// Every sentence on the profit cards that holds a figure or a name is built here from the API answer, so the words follow
// the data and nothing is typed in. The tests feed known answers and read the sentences back.
import type { CohortProfit, FailedDeliveryCost, PlColumn, ProfitByProduct } from '../../../services/financeReports.service';
import { parseMoney } from '../../../utils/money';
import { listWords, lowerFirst, money, monthOf, pct } from './format';

export interface Headline { title: string; body: string; tone: 'bad' | 'ok' }

const abs = (v: string | number) => Math.abs(parseMoney(v));

/**
 * The one finding of the profit table. A product that lost money comes first ("The copybook set lost GH₵20,400");
 * with every product in profit but the net result negative, the finding is the loss and what takes it; otherwise the
 * profit. Null when nothing was delivered and nothing booked.
 */
export function profitHeadline(p: ProfitByProduct): Headline | null {
  const month = monthOf(p.to);
  const loser = p.products
    .filter((r) => !r.costMissing && r.profit !== null && parseMoney(r.profit) < 0)
    .sort((a, b) => parseMoney(a.profit) - parseMoney(b.profit))[0];
  if (loser) {
    return {
      tone: 'bad',
      title: `The ${loser.name} lost ${money(abs(loser.profit!))} in ${month}`,
      body: `${loser.delivered} delivered ${loser.delivered === 1 ? 'order' : 'orders'} brought ${money(loser.revenue)} against ${money(loser.productCost)} of product cost, ${money(loser.fees)} of delivery fees and ${money(loser.metaAds)} of ads.`,
    };
  }
  const net = parseMoney(p.netProfit);
  if (net < 0) {
    return {
      tone: 'bad',
      title: `${month} ends with a loss of ${money(abs(net))}`,
      body: `Meta spend of ${money(p.metaSpendWithNoProduct)}, rep commission of ${money(p.repCommission)} and other expenses of ${money(p.otherExpenses)} come on top of what the products earn.`,
    };
  }
  if (net > 0) {
    return { tone: 'ok', title: `${month} makes ${money(net)}`, body: `After Meta spend of ${money(p.metaSpendWithNoProduct)}, rep commission of ${money(p.repCommission)} and other expenses of ${money(p.otherExpenses)}.` };
  }
  return null;
}

/** "Magic Groove copybook set GH₵180 before ads": the sub-line under the profit per order tile. Null with no product. */
export function perOrderNote(p: ProfitByProduct): string | null {
  const top = p.products.find((r) => !r.costMissing && r.profitPerDeliveredOrder !== null);
  return top ? `${top.name} ${money(top.profitPerDeliveredOrder)} before ads` : null;
}

export interface TwoWays {
  byDelivery: { label: string; value: string; detail: string };
  byCohort: { label: string; value: string; detail: string };
  /** The sentence that says why the two differ. Empty while the cohort has no number. */
  note: string;
}

/** "By delivery date: -GH₵14,268. By order cohort: GH₵9,900." The cohort answer carries both numbers (F-925). */
export function cohortLine(c: Extract<CohortProfit, { available: true }>): string {
  return `By delivery date: ${money(c.byDeliveryDate)}. By order cohort: ${money(c.profitBeforeOtherExpenses)}.`;
}

/** "Two ways to read October" (F-925, F-1055): the net result by delivery date and the projected result by order cohort. */
export function twoWays(p: ProfitByProduct, c: CohortProfit): TwoWays {
  const month = monthOf(p.to);
  const byDelivery = {
    label: 'By delivery date, what has landed so far',
    value: `${money(p.netProfit)} (${pct(p.netMarginPct)})`,
    detail: p.profitPerDeliveredOrder === null
      ? `${p.totals.delivered} delivered`
      : `${p.totals.delivered} delivered, ${money(p.profitPerDeliveredOrder)} on each`,
  };
  if (!c.available) {
    return {
      byDelivery,
      byCohort: { label: 'By order cohort', value: c.message, detail: 'The yield is projected from orders that have closed.' },
      note: '',
    };
  }
  return {
    byDelivery,
    byCohort: {
      label: `By order cohort, ${lowerFirst(c.yieldLabel)}`,
      value: `${money(c.profitBeforeOtherExpenses)} (${pct(c.marginPct)})`,
      detail: c.profitPerDeliveredOrder === null
        ? `${c.projectedDelivered} delivered, before other expenses`
        : `${c.projectedDelivered} delivered, ${money(c.profitPerDeliveredOrder)} on each, before other expenses`,
    },
    note: `The first view counts all the ad spend against only the orders delivered so far. The second counts every order placed in ${month} at the ${c.yieldPct}% yield: ${money(c.revenue)} revenue, ${money(c.productCost)} product cost, ${money(c.fees)} fees and ${money(c.metaAds)} ads.`,
  };
}


/** The notes under the table: each column's own note, and why commission is "Not split out" (D5). Built from the answer. */
export function plNotes(columns: PlColumn[]): string[] {
  const notes: string[] = [];
  for (const c of columns) {
    if (c.note) notes.push(`${c.label}: ${c.note}`);
  }
  const unsplit = columns.filter((c) => c.repCommission === null);
  if (unsplit.length > 0) {
    notes.push(`${listWords(unsplit.map((c) => c.label))} stay as booked. Rep commission was not a separate line then, so it is not split out.`);
  }
  return notes;
}

/** Under "Fee kept on failed orders": who kept a fee and on how many orders. */
export const failedFeeNote = (d: FailedDeliveryCost): string =>
  d.partners.filter((p) => Number(p.fees) > 0).map((p) => `${p.name} ${p.failedOrders} failed or returned`).join(', ') || 'No fee was kept';

/** Under "Returned units lost": how many units are missing, and where. */
export const lostUnitsNote = (d: FailedDeliveryCost): string =>
  d.partners.filter((p) => p.unitsLost > 0).map((p) => `${p.unitsLost} missing at ${p.name}`).join(', ') || 'No unit is missing';

/** A partner with no failed fee rule: the server's hint, with the name. */
export const failedHints = (d: FailedDeliveryCost): Array<{ key: string; text: string }> =>
  d.partners.filter((p) => p.hint).map((p) => ({ key: String(p.partnerId ?? 'none'), text: `${p.name}: ${p.hint}` }));
