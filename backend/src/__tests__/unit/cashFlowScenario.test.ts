/**
 * M5-T41 (F-928): the scenario multiplier and the forecast summary are pure; known inputs, known outputs.
 */
import { describe, it, expect } from '@jest/globals';
import { parseScenario, scenarioMultiplier, summarizeForecast, type ForecastDay } from '../../services/finance/cashFlowService';
import * as Money from '../../utils/money';

const day = (date: string, inflow: number, outflow: number, balance: number): ForecastDay => ({
  date, expectedCollection: Money.parse(inflow), expectedExpense: Money.parse(outflow), projectedBalance: Money.parse(balance),
});

describe('scenarioMultiplier', () => {
  it('pace never changes the inflow', () => {
    expect(scenarioMultiplier('pace', 48, 60)).toBe(1);
  });
  it('target is the target over today\'s rate: 48% to 60% is 1.25', () => {
    expect(scenarioMultiplier('target', 48, 60)).toBe(1.25);
  });
  it('no closed orders, a zero rate, or a rate at or above the target leave it at 1', () => {
    expect(scenarioMultiplier('target', null, 60)).toBe(1);
    expect(scenarioMultiplier('target', 0, 60)).toBe(1);
    expect(scenarioMultiplier('target', 60, 60)).toBe(1);
    expect(scenarioMultiplier('target', 75, 60)).toBe(1);
    expect(scenarioMultiplier('target', 50, 80)).toBe(1.6); // the store's own target
  });
});

describe('parseScenario', () => {
  it('left out is pace, pace and target pass, anything else is a 400', () => {
    expect(parseScenario(undefined)).toBe('pace');
    expect(parseScenario('target')).toBe('target');
    expect(() => parseScenario('wild')).toThrow('scenario must be pace or target');
  });
});

describe('summarizeForecast', () => {
  const days = Array.from({ length: 30 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, '0')}`, i === 9 ? 3000 : 100, 150, 0));
  it('adds the days, finds the lowest point and groups seven-day weeks (the last one short)', () => {
    let balance = 1000;
    days.forEach((d) => { balance += Number(d.expectedCollection) - Number(d.expectedExpense); d.projectedBalance = Money.parse(balance); });
    const { summary, weeks } = summarizeForecast(1000, days);
    expect(summary.expectedIn).toBe('5900.00'); // 29 x 100 + 3000
    expect(summary.expectedOut).toBe('4500.00');
    expect(summary.endBalance).toBe('2400.00');
    expect(summary.lowest).toEqual({ date: '2026-11-09', balance: '550.00' }); // the day before the 3,000 lands
    expect(summary.runsOutOn).toBeNull();
    expect(summary.tightDays).toBe(7);
    expect(weeks.map((w) => [w.from, w.to])).toEqual([['2026-11-01', '2026-11-07'], ['2026-11-08', '2026-11-14'], ['2026-11-15', '2026-11-21'], ['2026-11-22', '2026-11-28'], ['2026-11-29', '2026-11-30']]);
    expect(weeks[1]).toMatchObject({ moneyIn: '3600.00', moneyOut: '1050.00', net: '2550.00' });
  });
  it('safe, tight and runs out follow the lowest point', () => {
    const flat = (low: number) => [day('2026-11-01', 0, 150, low), day('2026-11-02', 0, 150, low + 500)];
    expect(summarizeForecast(5000, flat(5000)).summary.status).toBe('safe'); // 7 days of spending is 1,050 over the 2 days
    expect(summarizeForecast(100, flat(100)).summary.status).toBe('tight');
    const out = summarizeForecast(100, [day('2026-11-01', 0, 150, -50), day('2026-11-02', 0, 150, -200)]);
    expect(out.summary.status).toBe('runs_out');
    expect(out.summary.runsOutOn).toBe('2026-11-01');
  });
  it('an empty forecast gives zeros, not NaN', () => {
    const { summary, weeks } = summarizeForecast(1000, []);
    expect(weeks).toEqual([]);
    expect(summary).toMatchObject({ cashToday: '1000.00', expectedIn: '0.00', expectedOut: '0.00', endBalance: '1000.00', status: 'safe' });
  });
});
