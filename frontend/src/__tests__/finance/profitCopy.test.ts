import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigStore } from '../../stores/configStore';
import { cohortLine, perOrderNote, plNotes, profitHeadline, twoWays } from '../../pages/financial/profit/copy';
import { cost, marginTone, money, pct } from '../../pages/financial/profit/format';
import { cohortProfit, monthlyPl, profitByProduct } from '../fixtures/financeProfit';

beforeEach(() => useConfigStore.setState({ currency: 'GHS' }));

describe('profit card words are built from the answer (M5-T40)', () => {
  it('pct rounds half away from zero, as the mockup writes -16%', () => {
    expect(pct(-15.5)).toBe('-16%');
    expect(pct(8.2)).toBe('8%');
    expect(pct(12.5)).toBe('13%');
    expect(pct(0)).toBe('0%');
    expect(pct(-0.2)).toBe('0%'); // never "-0%"
    expect(pct(null)).toBe('n/a');
  });

  it('money keeps the minus, a cost line flips the sign, a missing figure is a dash and never GH₵0', () => {
    expect(money('-14268.00')).toBe('-GH₵14,268');
    expect(money('249.50')).toBe('GH₵249.50');
    expect(money(null)).toBe('-');
    expect(cost('12000.00')).toBe('-GH₵12,000');
    expect(cost('0.00')).toBe('GH₵0');
  });

  it('a margin is bad under 0, a warning under the target, fine at it, and has no tone when n/a', () => {
    expect([marginTone(-15.5, 35), marginTone(12, 35), marginTone(35, 35), marginTone(null, 35)]).toEqual(['bad', 'warn', 'ok', 'n']);
  });

  it('a product that lost money is the finding, with the name and the amount from the row', () => {
    const p = profitByProduct();
    p.products[0] = { ...p.products[0], name: 'Copybook set', metaAds: '88200.00', profit: '-20400.00', delivered: 306, revenue: '76100.00', productCost: '9200.00', fees: '10500.00' };
    const h = profitHeadline(p)!;
    expect(h.title).toBe('The Copybook set lost GH₵20,400 in October');
    expect(h.body).toBe('306 delivered orders brought GH₵76,100 against GH₵9,200 of product cost, GH₵10,500 of delivery fees and GH₵88,200 of ads.');
    expect(h.tone).toBe('bad');
  });

  it('with every product in profit but a negative net result, the finding is the loss and what takes it', () => {
    const h = profitHeadline(profitByProduct())!;
    expect(h.title).toBe('October ends with a loss of GH₵14,268');
    expect(h.body).toBe('Meta spend of GH₵76,200, rep commission of GH₵2,768 and other expenses of GH₵3,100 come on top of what the products earn.');
  });

  it('a profit month says so; nothing delivered and nothing booked says nothing; a product with no cost is never the loser', () => {
    const profit = { ...profitByProduct(), netProfit: '5000.00' };
    expect(profitHeadline(profit)!.title).toBe('October makes GH₵5,000');
    expect(profitHeadline(profit)!.tone).toBe('ok');
    expect(profitHeadline({ ...profitByProduct(), products: [], netProfit: '0.00' })).toBeNull();
    const noCost = profitByProduct();
    noCost.products = [{ ...noCost.products[1], profit: '-5.00' }];
    expect(profitHeadline({ ...noCost, netProfit: '0.00' })).toBeNull();
  });

  it('the profit per order tile names the top product before ads', () => {
    expect(perOrderNote(profitByProduct())).toBe('Magic Groove copybook set GH₵180.32 before ads');
    expect(perOrderNote({ ...profitByProduct(), products: [] })).toBeNull();
  });

  it('two ways to read the month: both numbers, the yield used, and the one-line summary', () => {
    const t = twoWays(profitByProduct(), cohortProfit());
    expect(t.byDelivery).toEqual({ label: 'By delivery date, what has landed so far', value: '-GH₵14,268 (-16%)', detail: '376 delivered, -GH₵37.95 on each' });
    expect(t.byCohort).toEqual({ label: 'By order cohort, projected at 34% yield', value: 'GH₵9,900 (8%)', detail: '491 delivered, GH₵20.16 on each, before other expenses' });
    expect(cohortLine(cohortProfit() as never)).toBe('By delivery date: -GH₵14,268. By order cohort: GH₵9,900.');
    expect(t.note).toContain('at the 34% yield: GH₵120,300 revenue, GH₵14,700 product cost, GH₵15,900 fees and GH₵76,200 ads.');
  });

  it('with no closed cohort the second number is "Not enough closed orders", not a figure', () => {
    const t = twoWays(profitByProduct(), { from: '2026-10-01', to: '2026-10-17', available: false, message: 'Not enough closed orders' });
    expect(t.byCohort.value).toBe('Not enough closed orders');
    expect(t.note).toBe('');
  });

  it('the notes under the monthly table name August and September and why commission is not split out', () => {
    expect(plNotes(monthlyPl().columns)).toEqual([
      'Aug: Booked with the older cost per set. Not restated.',
      'Sep: Booked with the older cost per set. Not restated.',
      'Aug, Sep and 1-17 Sep stay as booked. Rep commission was not a separate line then, so it is not split out.',
    ]);
  });
});
