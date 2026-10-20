/**
 * M1-T15 (F-250, risk #1): revenue and rates are computed in services/kpi only. This test scans backend/src
 * (not __tests__, not services/kpi) for text that computes revenue or a rate:
 *   - a money sum over the order total:  `_sum: { totalAmount`, `SUM(... total_amount`
 *   - a banned rate name:                deliveryRate, fulfilmentRate, fulfillmentRate, conversionRate
 *   - a percent of a total:              `(x / total...) * 100`
 * A file outside the allow-list that matches fails. Each allow-list entry names the ticket that repoints
 * the file to the KPI layer; when a ticket lands, delete its entries (the stale check fails until you do).
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
  ['order total sum', /_sum:\s*\{\s*totalAmount\b/],
  ['raw SQL order total sum', /SUM\(\s*(?:\w+\.)?"?total_amount"?/i],
  ['banned rate name', /\b(deliveryRate|fulfilmentRate|fulfillmentRate|conversionRate)\b/],
  ['percent of a total', /\/\s*total\w*\s*\)\s*\*\s*100/],
];

/** Files outside services/kpi that still compute revenue or a rate. Entry = reason. */
const ALLOWED: Record<string, string> = {
  // repointed in M1-T25
  'services/analyticsService.ts': 'repointed in M1-T25',
  'services/financialService.ts': 'repointed in M1-T25',
  'services/orderService.ts': 'repointed in M1-T25 (order stats totals; Opus to confirm the ticket)',
  // repointed in M1-T26
  'mcp/tools/analytics.ts': 'repointed in M1-T26',
  'mcp/tools/orders.ts': 'repointed in M1-T26',
  'mcp/tools/financial.ts': 'repointed in M1-T26',
  'mcp/tools/agents.ts': 'repointed in M1-T26',
  // Not named by any M1 ticket. Opus decides: assign a ticket or leave as non-KPI.
  'services/deliveryService.ts': 'UNASSIGNED: agent successRate (completed / total deliveries)',
  'services/webhookService.ts': 'not a KPI: webhook log success rate',
  'services/customerService.ts': 'not order revenue: customer total_spent and sort by spend',
  'services/checkoutFormService.ts': 'UNASSIGNED: checkout form revenue and submission conversion',
  'controllers/checkoutFormController.ts': 'UNASSIGNED: checkout form submission conversionRate',
  'services/platformService.ts': 'not a store KPI: platform admin totals across tenants',
  'controllers/userController.ts': 'UNASSIGNED: agent successRate and User.deliveryRate (agent pay column)',
  'controllers/authController.ts': 'not a KPI: returns the User.deliveryRate column',
  'services/adminService.ts': 'not a KPI: User.deliveryRate column (agent pay per delivery)',
  'scripts/seed.ts': 'not a KPI: seed data sets User.deliveryRate',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function matches(text: string): string[] {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

describe('KPI computation lives in services/kpi (M1-T15 grep test)', () => {
  const files = sourceFiles(SRC)
    .map((f) => [path.relative(SRC, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')] as const)
    .filter(([rel]) => !rel.startsWith('services/kpi/'));

  it('no file outside the allow-list computes revenue or a rate', () => {
    const offenders = files
      .filter(([rel, text]) => !ALLOWED[rel] && matches(text).length > 0)
      .map(([rel, text]) => `${rel}: ${matches(text).join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('the allow-list has no stale entry (file gone or no longer matching)', () => {
    const byPath = new Map(files);
    const stale = Object.keys(ALLOWED).filter((rel) => !byPath.has(rel) || matches(byPath.get(rel)!).length === 0);
    expect(stale).toEqual([]);
  });

  it('every allow-list entry has a reason', () => {
    expect(Object.entries(ALLOWED).filter(([, why]) => !why.trim()).map(([rel]) => rel)).toEqual([]);
  });

  it('the scanner sees each pattern (self-check)', () => {
    expect(matches('prisma.order.aggregate({ _sum: { totalAmount: true } })')).toContain('order total sum');
    expect(matches('_sum: {\n  totalAmount: true')).toContain('order total sum');
    expect(matches('SELECT SUM(o.total_amount) FROM orders o')).toContain('raw SQL order total sum');
    expect(matches('const fulfilmentRate = 1')).toContain('banned rate name');
    expect(matches('x = (delivered / totalOrders) * 100')).toContain('percent of a total');
    expect(matches('const x = a.totalAmount + b')).toEqual([]);
  });
});
