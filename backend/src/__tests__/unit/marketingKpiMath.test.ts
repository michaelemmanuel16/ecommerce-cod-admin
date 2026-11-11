/** M8-T10 (COD-73): the max CPA math on the PRD fixture, and the rule that no fixed CPA is in the marketing code. */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import * as Money from '../../utils/money';
import { maxCpaMath, moneyView, NO_ROOM_FOR_ADS } from '../../services/marketing/marketingKpiService';

const ngn = { currency: 'NGN', rate: Money.parse(112), rateDate: '2026-11-10' };
const fixture = { revenuePer: 249, costPer: 30, feePer: 34 };

describe('max CPA math', () => {
  it('GH₵249 price, GH₵30 cost, GH₵34 fee: profit GH₵185 = ₦20,720; max CPA ₦7,040 at 34% and ₦8,700 at 42%', () => {
    const at34 = maxCpaMath({ ...fixture, yieldPct: 34 });
    expect(Money.toApi(at34.profit)).toBe('185.00');
    expect(at34.message).toBeNull();
    expect(moneyView(at34.profit, ngn, { tenth: true })).toMatchObject({ store: '185.00', account: '20720.00', accountCurrency: 'NGN', rate: '112.0000', rateDate: '2026-11-10' });
    expect(moneyView(at34.max, ngn, { tenth: true })).toMatchObject({ store: '62.90', account: '7040.00' });
    expect(moneyView(maxCpaMath({ ...fixture, yieldPct: 42 }).max, ngn, { tenth: true }).account).toBe('8700.00');
  });

  it('price below cost and fee gives max CPA 0 and "No room for ads at this price"', () => {
    const r = maxCpaMath({ revenuePer: 60, costPer: 30, feePer: 34, yieldPct: 34 });
    expect(r.max.isZero()).toBe(true);
    expect(r.message).toBe(NO_ROOM_FOR_ADS);
    expect(maxCpaMath({ revenuePer: 64, costPer: 30, feePer: 34, yieldPct: 34 }).message).toBe(NO_ROOM_FOR_ADS); // profit exactly 0
  });

  it('a store currency view carries no account figure', () => {
    expect(moneyView(Money.parse(62.9), null)).toEqual({ store: '62.90', account: null, accountCurrency: null, rate: null, rateDate: null });
  });
});

describe('no fixed CPA', () => {
  it('6400 and 6,400 appear nowhere in src/services/marketing', () => {
    const dir = path.join(__dirname, '../../services/marketing');
    for (const f of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(text).not.toMatch(/6400|6,400/);
    }
  });
});
