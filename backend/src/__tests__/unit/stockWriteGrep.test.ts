/**
 * M4-T06 (F-651, F-658, Done-when 7): only stockService.ts writes `StockLevel.quantity` and `Product.stockQuantity`.
 * This test scans backend/src and backend/scripts (not __tests__) for:
 *   - any write call on the stockLevel model: create, createMany, update, updateMany, upsert, delete, deleteMany
 *   - a write call on the product model whose arguments name `stockQuantity` (create, createMany, update, updateMany, upsert)
 *   - `stockQuantity: { increment | decrement | set }` anywhere (a nested write)
 *   - raw SQL that inserts into, updates or deletes from stock_levels, or sets products.stock_quantity
 * A match outside services/stockService.ts needs an allow-list entry: a file plus a label, with a reason (the same shape
 * as kpiGrep.test.ts and wording-allowlist.json). An entry that no longer matches is stale and fails.
 *
 * Limits: a text scan, not a type check. It misses a write that spreads a request body into `data`
 * (`data: { ...req.body }`, M4-T16 returns 400 for `stockQuantity` there) and a client held in a variable with another name.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const BACKEND = path.resolve(__dirname, '../../..');
const ROOTS = ['src', 'scripts'];
const SERVICE = 'src/services/stockService.ts';

const ALLOWED: Array<{ file: string; label: string; reason: string }> = [
  { file: 'scripts/migrate-stock-to-levels.ts', label: 'stockLevel.createMany', reason: 'one-time move of the old stock numbers into levels (M4-T03), verified on the prod-dump copy; the cache is rebuilt by stockService.rebuildCache' },
  { file: 'scripts/seed-sample-data.ts', label: 'product.create sets stockQuantity', reason: 'dev seed data for an empty local database' },
  { file: 'scripts/seed-test-data.ts', label: 'product.upsert sets stockQuantity', reason: 'dev seed data for an empty local database' },
  { file: 'src/scripts/seed.ts', label: 'product.create sets stockQuantity', reason: 'dev seed data for an empty local database' },
];

const STOCK_LEVEL_WRITE = /\.stockLevel\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
const PRODUCT_WRITE = /\.product\s*\.\s*(create|createMany|update|updateMany|upsert)\s*\(/g;
const NESTED_WRITE = /stockQuantity\s*:\s*\{\s*(increment|decrement|set)\b/g;
const RAW_LEVEL_SQL = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?stock_levels"?/gi;
const RAW_CACHE_SQL = /UPDATE\s+"?products"?\s+(\w+\s+)?SET[^;`]*stock_quantity/gi;

/** The text of the call that opens at `open` (the index of its "("), up to the matching ")". */
function callBody(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** Every distinct label of a stock write found in the text. */
export function stockWrites(text: string): string[] {
  const labels = new Set<string>();
  for (const m of text.matchAll(STOCK_LEVEL_WRITE)) labels.add(`stockLevel.${m[1]}`);
  for (const m of text.matchAll(PRODUCT_WRITE)) {
    if (/\bstockQuantity\b/.test(callBody(text, m.index! + m[0].length - 1))) labels.add(`product.${m[1]} sets stockQuantity`);
  }
  if (NESTED_WRITE.test(text)) labels.add('stockQuantity increment, decrement or set');
  NESTED_WRITE.lastIndex = 0;
  if (RAW_LEVEL_SQL.test(text)) labels.add('raw SQL on stock_levels');
  RAW_LEVEL_SQL.lastIndex = 0;
  if (RAW_CACHE_SQL.test(text)) labels.add('raw SQL sets products.stock_quantity');
  RAW_CACHE_SQL.lastIndex = 0;
  return [...labels];
}

function sourceFiles(dir: string, out: Array<[string, string]> = []): Array<[string, string]> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push([path.relative(BACKEND, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8')]);
    }
  }
  return out;
}

describe('only stockService writes stock quantities (M4-T06 grep test)', () => {
  const files = ROOTS.flatMap((r) => sourceFiles(path.join(BACKEND, r)));
  const writesOf = new Map(files.map(([rel, text]) => [rel, stockWrites(text)] as const));

  it('no write outside stockService.ts is missing from the allow-list', () => {
    const offenders = files
      .filter(([rel]) => rel !== SERVICE)
      .flatMap(([rel]) => writesOf.get(rel)!
        .filter((label) => !ALLOWED.some((a) => a.file === rel && a.label === label))
        .map((label) => `${rel}: ${label}`));
    expect(offenders).toEqual([]);
  });

  it('stockService.ts does write (the scanner finds its writes)', () => {
    expect(writesOf.get(SERVICE)).toEqual(expect.arrayContaining(['stockLevel.upsert', 'product.update sets stockQuantity']));
  });

  it('the allow-list has no stale entry (file gone or write no longer there)', () => {
    const stale = ALLOWED.filter((a) => !(writesOf.get(a.file) ?? []).includes(a.label)).map((a) => `${a.file}: ${a.label}`);
    expect(stale).toEqual([]);
  });

  it('every allow-list entry has a reason', () => {
    expect(ALLOWED.filter((a) => !a.reason.trim()).map((a) => `${a.file}: ${a.label}`)).toEqual([]);
  });

  it('the scanner sees each pattern (self-check)', () => {
    expect(stockWrites('await tx.stockLevel.update({ where: {}, data: {} })')).toEqual(['stockLevel.update']);
    expect(stockWrites('await tx.stockLevel.findMany({})')).toEqual([]);
    expect(stockWrites('tx.product.update({ where: { id }, data: { stockQuantity: total } })')).toEqual(['product.update sets stockQuantity']);
    expect(stockWrites('tx.product.update({ where: { id }, data: { name: "x" } })')).toEqual([]);
    expect(stockWrites('tx.product.findMany({ where: { stockQuantity: { lte: 3 } } })')).toEqual([]);
    expect(stockWrites('data: { stockQuantity: { decrement: 2 } }')).toEqual(['stockQuantity increment, decrement or set']);
    expect(stockWrites('await tx.$executeRaw`UPDATE stock_levels SET quantity = 1`')).toEqual(['raw SQL on stock_levels']);
    expect(stockWrites('await tx.$executeRaw`UPDATE products p SET stock_quantity = 1`')).toEqual(['raw SQL sets products.stock_quantity']);
  });
});
