import { describe, it, expect } from 'vitest';
import { journalBalance } from '../../utils/journalBalance';

const line = (accountId: string, debitAmount: string, creditAmount: string) => ({ accountId, debitAmount, creditAmount });

describe('journalBalance', () => {
  it('has no amount on an empty entry, and cannot post', () => {
    const b = journalBalance([line('', '0', '0'), line('', '0', '0')]);
    expect([b.debits, b.credits, b.difference, b.canPost]).toEqual([0, 0, 0, false]);
  });

  it('is balanced when debits equal credits and two lines carry an account', () => {
    const b = journalBalance([line('1', '500', '0'), line('2', '0', '500')]);
    expect([b.debits, b.credits, b.difference, b.canPost]).toEqual([500, 500, 0, true]);
  });

  it('is out of balance with the difference, and cannot post', () => {
    const b = journalBalance([line('1', '500', '0'), line('2', '0', '499.5')]);
    expect(b.difference).toBe(0.5);
    expect(b.canPost).toBe(false);
  });

  it('adds in cents: 0.1 + 0.2 against 0.3 is balanced', () => {
    const b = journalBalance([line('1', '0.1', '0'), line('2', '0.2', '0'), line('3', '0', '0.3')]);
    expect(b.difference).toBe(0);
    expect(b.canPost).toBe(true);
  });

  it('blocks post when a line with an amount has no account, or one line has both sides', () => {
    expect(journalBalance([line('1', '10', '0'), line('', '0', '10')]).canPost).toBe(false);
    expect(journalBalance([line('1', '10', '10'), line('2', '0', '0')]).canPost).toBe(false);
  });

  it('needs two or more lines with an amount', () => {
    expect(journalBalance([line('1', '0', '0'), line('2', '0', '0'), line('3', '5', '5')]).canPost).toBe(false);
  });

  it('treats negative and junk text as no amount', () => {
    const b = journalBalance([line('1', '-5', '0'), line('2', 'abc', '')]);
    expect([b.debits, b.credits]).toEqual([0, 0]);
  });
});
