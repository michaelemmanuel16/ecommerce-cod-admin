import { describe, it, expect } from 'vitest';
import { isClosedMonth, isSafeReceiptUrl, receiptFileError, RECEIPT_MAX_BYTES } from '../../utils/expenseRules';

describe('receiptFileError', () => {
  it('accepts JPEG, PNG, WebP and PDF within 15 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(receiptFileError({ type, size: 1000 })).toBeNull();
    }
  });

  it('names the limit when the file is too large or the wrong type', () => {
    expect(receiptFileError({ type: 'application/pdf', size: RECEIPT_MAX_BYTES + 1 })).toMatch(/15 MB/);
    expect(receiptFileError({ type: 'text/html', size: 10 })).toMatch(/JPEG, PNG, WebP or PDF/);
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
  const now = new Date(2026, 9, 26); // 26 Oct 2026
  it('is true for an earlier month and false for this month or later', () => {
    expect(isClosedMonth('2026-09-30', now)).toBe(true);
    expect(isClosedMonth('2025-12-01', now)).toBe(true);
    expect(isClosedMonth('2026-10-01', now)).toBe(false);
    expect(isClosedMonth('2026-11-02', now)).toBe(false);
    expect(isClosedMonth('', now)).toBe(false);
  });
});
