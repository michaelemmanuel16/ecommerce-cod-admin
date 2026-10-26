/**
 * M5-T06, M5-T07 (COD-48): nothing posts to the retired accounts 1020 (agent receivable), 5040 (agent commission) or
 * 2030 (pay-per-delivery payable, never in the chart). A text scan of backend/src: a file that names one of them must be
 * in the allow-list, with the reason it only reads or defines the account. An entry whose file no longer names one is stale.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../..');
const NAMES = /GL_ACCOUNTS\.(AR_AGENTS|DELIVERY_AGENT_COMMISSION)|['"](1020|5040|2030)['"]/;

const ALLOWED: Array<{ file: string; reason: string }> = [
  { file: 'config/glAccounts.ts', reason: 'defines the codes, RETIRED_GL_CODES and the chart seed (created inactive)' },
  { file: 'scripts/seed.ts', reason: 'dev seed that creates the accounts; posts nothing' },
  { file: 'services/financialService.ts', reason: 'getCashFlowReport reads the 1020 balance; M5-T27 removes the read' },
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

describe('retired accounts 1020, 5040 and 2030', () => {
  const naming = sourceFiles(SRC)
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((rel) => NAMES.test(fs.readFileSync(path.join(SRC, rel), 'utf8')));

  it('only the allow-listed files name them', () => {
    expect(naming.filter((f) => !ALLOWED.some((a) => a.file === f))).toEqual([]);
  });

  it('every allow-list entry still names one (no stale entry)', () => {
    expect(ALLOWED.map((a) => a.file).filter((f) => !naming.includes(f))).toEqual([]);
  });

  it('the one delivery-partner posting path writes to 5070 and 1015', () => {
    const gl = fs.readFileSync(path.join(SRC, 'services/glAutomationService.ts'), 'utf8');
    const fee = gl.slice(gl.indexOf('static async createDeliveryFeeEntry'), gl.indexOf('static async reverseDeliveredFee'));
    expect(fee).toContain('GL_ACCOUNTS.DELIVERY_FEES');
    expect(fee).toContain('GL_ACCOUNTS.CASH_IN_TRANSIT');
  });
});
