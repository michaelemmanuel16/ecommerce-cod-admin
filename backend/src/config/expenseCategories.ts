/**
 * The one expense category list (F-918, M5-T28). "Marketing" is not Meta ad spend (that is 5080, posted by the
 * Meta pull). Rewards paid to people are not an expense category: they come from the payout form.
 * The data migration 20261026130000_m5_expense_categories maps every older category to "Other".
 */
export const EXPENSE_CATEGORIES = [
  'Packaging',
  'Software',
  'Office and internet',
  'Transport',
  'Photography',
  'Bank charges',
  'Salaries',
  'Marketing',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** The list entry that matches `input` ignoring case and outer spaces, or null. */
export function matchExpenseCategory(input: unknown): ExpenseCategory | null {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  return EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === key) ?? null;
}

/** Where an expense was paid from (F-917). All three credit account 1010, the one cash account. */
export const EXPENSE_PAID_FROM = ['momo', 'bank', 'cash'] as const;
