/**
 * M1-T11: Order.status is written by the state machine only. This test scans backend/src (not __tests__)
 * for `order.update(` / `order.updateMany(` / `order.upsert(` calls whose `data:` object has a top-level
 * `status` key, and for raw `UPDATE orders ... status` SQL. Any file outside the allow-list fails.
 * M2-T16: the workflow action files are off the allow-list, and may not call `prisma.order.update` at all.
 *
 * Limits: a text scan, not a type check. It misses a `data:` that is a variable or a spread, a status written through
 * `orderHistory`-style nested creates (not an Order.status write, ignored on purpose), and writes through
 * a differently named client (`prismaBase.order.update` is matched, `db.order.update` is too: the regex
 * keys on `order.update(`). Order creates are not scanned.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../..');

const ALLOWED: Record<string, string> = {
  'services/orderStateMachine.ts': 'the machine',
  'services/orderSideEffects.ts': 'side effects of the machine',
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

/** Text between the bracket that opens at `open` and its match. */
function balanced(text: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (pairs[text[i]]) depth++;
    else if (text[i] === ')' || text[i] === '}' || text[i] === ']') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** Keys at the top level of an object literal body `{ ... }`, nested brackets blanked out. */
function topLevel(objectText: string): string {
  let depth = 0;
  let out = '';
  for (const ch of objectText) {
    if (ch === '(' || ch === '{' || ch === '[') { depth++; if (depth === 1) continue; }
    else if (ch === ')' || ch === '}' || ch === ']') { depth--; if (depth === 0) continue; }
    if (depth === 1) out += ch;
  }
  return out;
}

function writesStatus(text: string): boolean {
  const call = /\border\.(update|updateMany|upsert)\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(text))) {
    const args = balanced(text, m.index + m[0].length - 1);
    // only the call's own data / update / create key (depth 2: inside `({ ... })`), not nested creates
    let depth = 0;
    for (let i = 0; i < args.length; i++) {
      const ch = args[i];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      else if (depth === 2 && /[\s,{]/.test(args[i - 1] ?? '')) {
        const key = /^(data|update|create)\s*:\s*\{/.exec(args.slice(i));
        if (key && /(^|,)\s*status\s*(:|,|$)/.test(topLevel(balanced(args, i + key[0].length - 1)))) return true;
      }
    }
  }
  return /UPDATE\s+"?orders"?\s+SET[^;`]*\bstatus\b/i.test(text);
}

describe('Order.status writers (M1-T11 grep test)', () => {
  const files = sourceFiles(SRC).map((f) => [path.relative(SRC, f), fs.readFileSync(f, 'utf8')] as const);

  it('no file outside the allow-list writes Order.status', () => {
    const offenders = files.filter(([rel, text]) => !ALLOWED[rel] && writesStatus(text)).map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });

  it('the allow-list has no stale entry', () => {
    const existing = new Set(files.map(([rel]) => rel));
    expect(Object.keys(ALLOWED).filter((rel) => !existing.has(rel))).toEqual([]);
  });

  it('no workflow action file calls prisma.order.update (M2-T16)', () => {
    for (const rel of ['queues/workflowQueue.ts', 'services/workflowService.ts', 'services/workflowActions.ts']) {
      expect(files.find(([r]) => r === rel)![1]).not.toMatch(/prisma\.order\.update\b/);
    }
  });

  it('the scanner sees a status write (self-check)', () => {
    expect(writesStatus("await prisma.order.update({ where: { id }, data: { status: 'x', notes } })")).toBe(true);
    expect(writesStatus("await tx.order.updateMany({ where: { status: 'x' }, data: { notes } })")).toBe(false);
    expect(writesStatus("await tx.order.update({ where: { id }, data: { orderHistory: { create: { status: 'x' } } } })")).toBe(false);
    expect(writesStatus('await tx.$executeRaw`UPDATE orders SET status = \'x\' WHERE id = 1`')).toBe(true);
  });
});
