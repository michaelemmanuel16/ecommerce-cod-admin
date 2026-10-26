/**
 * Balance state of a manual journal entry (F-920). Amounts are summed in minor units (cents), so 0.1 + 0.2 is
 * exactly 0.3. The Post button is enabled only when the state is `balanced` and the entry has two or more lines.
 */
export interface JournalLineInput {
  accountId: string;
  debitAmount: string;
  creditAmount: string;
}

export type JournalState = 'empty' | 'balanced' | 'out_of_balance';

export interface JournalBalance {
  state: JournalState;
  totalDebits: number;
  totalCredits: number;
  /** Absolute difference, in currency units. */
  difference: number;
  /** Lines that carry an amount. */
  amountLines: number;
  canPost: boolean;
}

const toCents = (value: string): number => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

export function journalBalance(lines: JournalLineInput[]): JournalBalance {
  let debits = 0;
  let credits = 0;
  let amountLines = 0;
  let readyLines = 0;
  let bothSides = false;
  for (const line of lines) {
    const dr = toCents(line.debitAmount);
    const cr = toCents(line.creditAmount);
    debits += dr;
    credits += cr;
    if (dr > 0 || cr > 0) {
      amountLines++;
      if (line.accountId) readyLines++;
    }
    if (dr > 0 && cr > 0) bothSides = true;
  }
  const state: JournalState = debits === 0 && credits === 0 ? 'empty' : debits === credits ? 'balanced' : 'out_of_balance';
  return {
    state,
    totalDebits: debits / 100,
    totalCredits: credits / 100,
    difference: Math.abs(debits - credits) / 100,
    amountLines,
    canPost: state === 'balanced' && readyLines >= 2 && readyLines === amountLines && !bothSides,
  };
}
