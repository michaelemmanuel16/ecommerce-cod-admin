/**
 * M3-T65 (F-1234, F-1230): text guards on frontend/src (test files and fixtures are not scanned).
 * The mockup's plan numbers must not come back: plans, prices and limits come from the plans table.
 * "Time zone" is a Business details field and nowhere else.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string, out: Array<[string, string]> = []): Array<[string, string]> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|css|json)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push([path.relative(SRC, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8')]);
    }
  }
  return out;
}

const files = sourceFiles(SRC);
const filesWith = (text: string) => files.filter(([, body]) => body.includes(text)).map(([name]) => name);

describe('Billing numbers come from the plans table (F-1234)', () => {
  it.each(['1,500 orders', '2 stores', '3 AI agent keys'])('"%s" appears nowhere in frontend/src', (text) => {
    expect(filesWith(text)).toEqual([]);
  });
});

describe('Time zone lives in Business details only (F-1230)', () => {
  it('the text "Time zone" is in the Business details tab and no other file', () => {
    expect(filesWith('Time zone')).toEqual(['pages/settings/BusinessTab.tsx']);
  });
});
