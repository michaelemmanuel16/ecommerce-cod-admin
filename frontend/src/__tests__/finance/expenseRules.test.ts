import { describe, it, expect } from 'vitest';
import { isClosedMonth, isSafeReceiptUrl, receiptFileError, receiptLimitText } from '../../utils/expenseRules';

const rules = { maxBytes: 15 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'] };

describe('receipt limits come from the server', () => {
  it('builds the limit text from the types and the size', () => {
    expect(receiptLimitText(rules)).toBe('JPEG, PNG, GIF, WebP or PDF, up to 15 MB');
    expect(receiptLimitText({ maxBytes: 5 * 1024 * 1024, mimeTypes: ['application/pdf'] })).toBe('PDF, up to 5 MB');
  });

  it('accepts a listed type within the size', () => {
    expect(receiptFileError({ type: 'application/pdf', size: 1000 }, rules)).toBeNull();
  });

  it('names the limit when the file is too large or the wrong type', () => {
    expect(receiptFileError({ type: 'application/pdf', size: rules.maxBytes + 1 }, rules)).toMatch(/15 MB/);
    expect(receiptFileError({ type: 'text/html', size: 10 }, rules)).toMatch(/JPEG, PNG, GIF, WebP or PDF/);
  });
});

describe('isSafeReceiptUrl', () => {
  it('allows http(s) and a path on our server, and nothing else', () => {
    expect(isSafeReceiptUrl('/uploads/r-1-2.pdf')).toBe(true);
    expect(isSafeReceiptUrl('https://img.example.com/a.png')).toBe(true);
    expect(isSafeReceiptUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeReceiptUrl('//evil.example/x.pdf')).toBe(false);
    expect(isSafeReceiptUrl(null)).toBe(false);
  });
});

describe('isClosedMonth', () => {
  it('compares the date with the first day of the current store month', () => {
    expect(isClosedMonth('2026-09-30', '2026-10-01')).toBe(true);
    expect(isClosedMonth('2026-10-01', '2026-10-01')).toBe(false);
    expect(isClosedMonth('2026-11-02', '2026-10-01')).toBe(false);
    expect(isClosedMonth('', '2026-10-01')).toBe(false);
  });
});
