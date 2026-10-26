/**
 * Balance of a manual journal entry (F-920). Amounts are summed in minor units (cents), so 0.1 + 0.2 is exactly 0.3.
 * `canPost` is true when debits equal credits (and are not zero), every line with an amount has an account,
 * no line has both sides, and at least two lines carry an amount. With no amount at all the entry is empty.
 */
export interface JournalLineInput {
  accountId: string;
  debitAmount: string;
  creditAmount: string;
}

export interface JournalBalance {
  debits: number;
  credits: number;
  /** Absolute difference, in currency units. */
  difference: number;
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
  return {
    debits: debits / 100,
    credits: credits / 100,
    difference: Math.abs(debits - credits) / 100,
    canPost: debits > 0 && debits === credits && readyLines >= 2 && readyLines === amountLines && !bothSides,
  };
}
