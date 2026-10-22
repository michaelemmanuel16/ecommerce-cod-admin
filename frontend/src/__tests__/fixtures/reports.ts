import fs from 'node:fs';
import path from 'node:path';

/**
 * The Reports API answers for the NUMBERS.md fixture, 1 to 17 Oct 2026, compare on (previous period 1 to 17 Sep).
 * 1,445 orders, 1,026 confirmed, 376 delivered, GH₵92,000; failed 354 and returned 48 apart.
 * Shared by the Reports page tests and the Playwright spec (e2e/16-reports.spec.ts).
 */
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));

export const reportsFixture = {
  overview: () => read('reportsOverview.json'),
  sales: () => read('reportsSales.json'),
  delivery: () => read('reportsDelivery.json'),
};

const CHANGE_KEYS = new Set(['previous', 'deltaPercent', 'deltaPoints', 'deltaAmount']);

/** What the API sends with compare off: `compare` is null and every previous figure and change is null. */
export function withoutCompare<T>(body: T): T {
  const copy = JSON.parse(JSON.stringify(body));
  copy.compare = null;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (CHANGE_KEYS.has(key) && key !== 'compare') obj[key] = null;
        else walk(obj[key]);
      }
    }
  };
  walk(copy);
  return copy;
}
