/** Client-side rules for the expense screen (F-917, F-919). The server checks the same things again. */

export const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const RECEIPT_LIMIT_TEXT = 'JPEG, PNG, WebP or PDF, up to 15 MB';

/** null when the file can be uploaded; otherwise the message that names the limit. */
export function receiptFileError(file: { type: string; size: number }): string | null {
  if (!RECEIPT_TYPES.includes(file.type)) return `This file type is not allowed. Use ${RECEIPT_LIMIT_TEXT}.`;
  if (file.size > RECEIPT_MAX_BYTES) return `This file is too large. Use ${RECEIPT_LIMIT_TEXT}.`;
  return null;
}

/** A receipt link is shown only when it is http(s) or a path on our own server. */
export const isSafeReceiptUrl = (url: string | null | undefined): url is string =>
  typeof url === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(url);

export const isPdfUrl = (url: string): boolean => /\.pdf(\?.*)?$/i.test(url);

export const CLOSED_MONTH_NOTICE = 'This month is closed; the P&L changes';

/** True when a YYYY-MM-DD date is in an earlier month than `now` (same rule as the server). */
export const isClosedMonth = (ymd: string, now: Date = new Date()): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return ymd.slice(0, 7) < current;
};

export const PAID_FROM_LABELS: Record<string, string> = { momo: 'MoMo', bank: 'Bank', cash: 'Cash' };
