/** Client-side rules for the expense screen (F-917, F-919). The server sends the numbers; it checks the same things again. */

/** Where an expense was paid from. All three post to the one cash account. */
export const PAID_FROM = ['momo', 'bank', 'cash'] as const;
export type ExpensePaidFrom = (typeof PAID_FROM)[number];
export const PAID_FROM_LABELS: Record<ExpensePaidFrom, string> = { momo: 'MoMo', bank: 'Bank', cash: 'Cash' };

/** GET /api/financial/expense-categories: what the Add expense form needs. */
export interface ExpenseFormRules {
  categories: string[];
  paidFrom: ExpensePaidFrom[];
  /** First day (YYYY-MM-DD) of the current store month. An earlier date is in a closed month. */
  closedBefore: string;
  closedNotice: string;
  receipt: { maxBytes: number; mimeTypes: string[] };
}

type ReceiptRules = ExpenseFormRules['receipt'];

const TYPE_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG', 'image/jpg': 'JPEG', 'image/png': 'PNG', 'image/gif': 'GIF', 'image/webp': 'WebP', 'application/pdf': 'PDF',
};

/** "JPEG, PNG, GIF, WebP or PDF, up to 15 MB", built from the server's limits. */
export function receiptLimitText({ maxBytes, mimeTypes }: ReceiptRules): string {
  const labels = [...new Set(mimeTypes.map((t) => TYPE_LABELS[t] ?? t))];
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}` : labels.join('');
  return `${list}, up to ${Math.round(maxBytes / (1024 * 1024))} MB`;
}

/** null when the file can be uploaded; otherwise the message that names the limit. */
export function receiptFileError(file: { type: string; size: number }, rules: ReceiptRules): string | null {
  if (!rules.mimeTypes.includes(file.type)) return `This file type is not allowed. Use ${receiptLimitText(rules)}.`;
  if (file.size > rules.maxBytes) return `This file is too large. Use ${receiptLimitText(rules)}.`;
  return null;
}

/** A receipt link is shown only when it is http(s) or a path on our own server. */
export const isSafeReceiptUrl = (url: string | null | undefined): url is string =>
  typeof url === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(url);

export const isPdfUrl = (url: string): boolean => /\.pdf(\?.*)?$/i.test(url);

/** True when a YYYY-MM-DD date is before `closedBefore` (both are store-month days, so a text compare is right). */
export const isClosedMonth = (ymd: string, closedBefore: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(ymd) && ymd < closedBefore;
