/**
 * M1-T33 (F-112): wording guard. Fails the build when backend/src holds a retired word: `airtime`,
 * `delivery rate`, `6,400`, `agent pay`, `agent fee` or `pay per delivery` (case-insensitive). The banned list and the allow-list are in
 * wording-allowlist.json at the repo root, shared with frontend/src/__tests__/wordingGuard.test.ts.
 * A line scan: it also reads comments. An allow-list entry exempts any line of its file that contains
 * its `match` text, and needs a reason. An entry whose text is no longer found is stale and fails.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
const SCAN_DIR = 'backend/src';
const config: { banned: string[]; allow: Array<{ file: string; match: string; reason: string }> } =
  JSON.parse(fs.readFileSync(path.join(ROOT, 'wording-allowlist.json'), 'utf8'));
const allow = config.allow.filter((a) => a.file.startsWith(`${SCAN_DIR}/`));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BANNED = new RegExp(config.banned.map(escape).join('|'), 'i');

/** Lines with a banned word that no allow-list entry covers, and the entries that covered nothing. */
function scan(files: Array<[string, string]>) {
  const used = new Set<(typeof allow)[number]>();
  const hits: string[] = [];
  for (const [rel, text] of files) {
    text.split('\n').forEach((line, i) => {
      if (!BANNED.test(line)) return;
      const entries = allow.filter((a) => a.file === rel && line.includes(a.match));
      entries.forEach((a) => used.add(a));
      if (entries.length === 0) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return { hits, stale: allow.filter((a) => !used.has(a)).map((a) => `${a.file}: ${a.match}`) };
}

function sourceFiles(dir: string, out: Array<[string, string]> = []): Array<[string, string]> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.ts') && !/\.test\./.test(entry.name)) {
      out.push([path.relative(ROOT, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8')]);
    }
  }
  return out;
}

describe('wording guard, backend (M1-T33)', () => {
  const files = sourceFiles(path.join(ROOT, SCAN_DIR));

  it('finds no retired word outside the allow-list', () => {
    expect(scan(files).hits).toEqual([]);
  });

  it('fails on a planted "Delivery Rate", "Airtime" and "6,400"', () => {
    const planted = scan([[`${SCAN_DIR}/planted.ts`, 'const a = "Delivery Rate";\nconst b = `Airtime`;\nconst c = "GH₵6,400";']]);
    expect(planted.hits).toHaveLength(3);
  });

  it('fails on a planted "agent pay", "agent fee" and "pay-per-delivery" (M5-T06, F-915)', () => {
    const planted = scan([[`${SCAN_DIR}/planted.ts`, 'const a = "Agent pay";\nconst b = `agent fee`;\nconst c = "Pay-per-delivery";\nconst d = "pay per delivery";']]);
    expect(planted.hits).toHaveLength(4);
  });

  it('does not flag the identifier deliveryRate', () => {
    expect(scan([[`${SCAN_DIR}/planted.ts`, 'const x = user.deliveryRate;']]).hits).toEqual([]);
  });

  it('has no stale allow-list entry', () => {
    expect(scan(files).stale).toEqual([]);
  });

  it('flags an allow-list entry that matches nothing as stale', () => {
    expect(scan([]).stale).toHaveLength(allow.length);
  });

  it('gives every allow-list entry a reason', () => {
    expect(config.allow.filter((a) => !a.reason?.trim() || !a.match?.trim()).map((a) => a.file)).toEqual([]);
  });
});
