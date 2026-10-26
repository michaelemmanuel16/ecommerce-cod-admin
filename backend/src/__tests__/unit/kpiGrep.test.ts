/**
 * M1-T15 (F-250, risk #1): revenue and rates are computed in services/kpi only. This test scans backend/src
 * (not __tests__, not services/kpi) for text that computes revenue or a rate:
 *   - a money sum or average over the order total: `_sum: { totalAmount`, `_avg: { totalAmount`, `SUM(... total_amount`
 *   - a banned rate name:                deliveryRate, fulfilmentRate, fulfillmentRate, conversionRate
 *   - a percent of a total:              `(x / total...) * 100`
 * A match outside the allow-list fails. An allow-list entry is a file plus the matched text, with a reason (the
 * same shape as wording-allowlist.json), so a new match in an allowed file still fails. When a ticket repoints a
 * file to the KPI layer, delete its entries (the stale check fails until you do).
 *
 * Limits: a text scan, not a type check. It misses a sum written another way (a JS reduce over rows, `_sum` on a
 * variable key, `totalAmount` in a spread) and a rate named something else. It also matches things that are not
 * order revenue: a customer's lifetime spend, a User column called `deliveryRate`. Those are in the allow-list
 * with a reason instead of being exempted by pattern, so a new match anywhere still fails. The scan reads
 * whole files, so a comment that contains a pattern counts too.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../..');

const PATTERNS: Array<[string, RegExp]> = [
  ['order total sum or average', /_(?:sum|avg):\s*\{\s*totalAmount\b/g],
  ['raw SQL order total sum', /SUM\(\s*(?:\w+\.)?"?total_amount"?/gi],
  ['banned rate name', /\b(deliveryRate|fulfilmentRate|fulfillmentRate|conversionRate)\b/g],
  ['percent of a total', /\/\s*total\w*\s*\)\s*\*\s*100/g],
];

/** One allowed hit: a file outside services/kpi and the matched text (whitespace collapsed) in it, with the reason. */
const ALLOWED: Array<{ file: string; match: string; reason: string }> = [
  // M1-T25: analyticsService.ts and orderService.ts now read the KPI layer for revenue; their AOV averages stay.
  { file: 'services/analyticsService.ts', match: '_avg: { totalAmount', reason: 'AOV, not revenue; currency conversion is Backlog' },
  { file: 'services/orderService.ts', match: '_avg: { totalAmount', reason: 'AOV, not revenue; currency conversion is Backlog' },
  { file: 'services/financialService.ts', match: '_sum: { totalAmount', reason: 'not delivered revenue: sums over open orders (out-for-delivery pipeline, cash position); delivered revenue in getFinancialSummary is the KPI layer (M1-T25)' },
  // Not named by any M1 ticket. Opus decides: assign a ticket or leave as non-KPI.
  { file: 'services/webhookService.ts', match: '/ totalLogs) * 100', reason: 'not a KPI: webhook log success rate' },
  { file: 'services/customerStatsService.ts', match: 'SUM(o.total_amount', reason: 'not order revenue: the customer deliveredValue stat (F-357)' },
  { file: 'services/checkoutFormService.ts', match: '_sum: { totalAmount', reason: 'UNASSIGNED: checkout form revenue and submission conversion' },
  { file: 'controllers/checkoutFormController.ts', match: '_sum: { totalAmount', reason: 'UNASSIGNED: checkout form revenue' },
  { file: 'controllers/checkoutFormController.ts', match: 'conversionRate', reason: 'UNASSIGNED: checkout form submission conversionRate' },
  { file: 'services/platformService.ts', match: '_sum: { totalAmount', reason: 'not a store KPI: platform admin totals across tenants' },
  { file: 'controllers/userController.ts', match: 'deliveryRate', reason: 'the User.deliveryRate column (agent pay per delivery), not a KPI' },
  { file: 'controllers/userController.ts', match: '/ total) * 100', reason: 'UNASSIGNED: agent successRate' },
  { file: 'controllers/authController.ts', match: 'deliveryRate', reason: 'not a KPI: returns the User.deliveryRate column' },
  { file: 'services/adminService.ts', match: 'deliveryRate', reason: 'not a KPI: User.deliveryRate column (agent pay per delivery)' },
  { file: 'scripts/seed.ts', match: 'deliveryRate', reason: 'not a KPI: seed data sets User.deliveryRate' },
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every distinct matched text of every pattern, whitespace collapsed. */
function matches(text: string): Array<{ pattern: string; match: string }> {
  const hits = new Map<string, { pattern: string; match: string }>();
  for (const [pattern, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const match = m[0].replace(/\s+/g, ' ');
      hits.set(`${pattern}|${match}`, { pattern, match });
    }
  }
  return [...hits.values()];
}

describe('KPI computation lives in services/kpi (M1-T15 grep test)', () => {
  const files = sourceFiles(SRC)
    .map((f) => [path.relative(SRC, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')] as const)
    .filter(([rel]) => !rel.startsWith('services/kpi/'));

  it('no match outside the allow-list computes revenue or a rate', () => {
    const offenders = files.flatMap(([rel, text]) => matches(text)
      .filter((h) => !ALLOWED.some((a) => a.file === rel && a.match === h.match))
      .map((h) => `${rel}: ${h.pattern}: ${h.match}`));
    expect(offenders).toEqual([]);
  });

  it('the allow-list has no stale entry (file gone or text no longer matching)', () => {
    const byPath = new Map(files);
    const stale = ALLOWED.filter((a) => !byPath.has(a.file) || !matches(byPath.get(a.file)!).some((h) => h.match === a.match))
      .map((a) => `${a.file}: ${a.match}`);
    expect(stale).toEqual([]);
  });

  it('every allow-list entry has a reason', () => {
    expect(ALLOWED.filter((a) => !a.reason.trim()).map((a) => `${a.file}: ${a.match}`)).toEqual([]);
  });

  it('the scanner sees each pattern (self-check)', () => {
    const names = (text: string) => matches(text).map((h) => h.pattern);
    expect(names('prisma.order.aggregate({ _sum: { totalAmount: true } })')).toContain('order total sum or average');
    expect(names('_sum: {\n  totalAmount: true')).toContain('order total sum or average');
    expect(names('prisma.order.aggregate({ _avg: { totalAmount: true } })')).toContain('order total sum or average');
    expect(names('SELECT SUM(o.total_amount) FROM orders o')).toContain('raw SQL order total sum');
    expect(names('const fulfilmentRate = 1')).toContain('banned rate name');
    expect(names('x = (delivered / totalOrders) * 100')).toContain('percent of a total');
    expect(names('const x = a.totalAmount + b')).toEqual([]);
  });
});
