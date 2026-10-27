/**
 * M5-T17 (COD-49): the partner CSV parser (F-712): delimiters, quotes, columns, bad rows with their line numbers, limits.
 */
import { describe, it, expect } from '@jest/globals';
import { CSV_MAX_ROWS, CsvFileError, parseCsvDate, parsePartnerCsv } from '../../utils/partnerCsv';

const NOW = new Date('2026-10-26T10:00:00Z');
const parse = (text: string) => parsePartnerCsv(text, NOW);

describe('quotes and line numbers', () => {
  it('reads quotes, doubled quotes and delimiters inside quotes, and numbers the lines', () => {
    const rows = parse('order,status,reason\n1,failed,"no answer, twice"\n2,failed,"say ""hi"""\n\n3,returned,');
    expect(rows.map((r) => [r.line, r.orderRef, r.reason])).toEqual([[2, '1', 'no answer, twice'], [3, '2', 'say "hi"'], [5, '3', null]]);
  });

  it('reads CRLF line ends', () => {
    expect(parse('order,status\r\n1,delivered\r\n2,failed\r\n').map((r) => r.line)).toEqual([2, 3]);
  });
});

describe('parseCsvDate', () => {
  it('reads ISO and day-first dates and refuses impossible ones', () => {
    expect(parseCsvDate('2026-10-05')).toBe('2026-10-05');
    expect(parseCsvDate('5/10/2026')).toBe('2026-10-05');
    expect(parseCsvDate('05.10.2026')).toBe('2026-10-05');
    expect(parseCsvDate('2026-02-30')).toBeNull();
    expect(parseCsvDate('31/04/2026')).toBeNull();
    expect(parseCsvDate('tomorrow')).toBeNull();
  });
});

describe('parsePartnerCsv', () => {
  it('reads the default columns in any order and case', () => {
    const rows = parse('﻿Phone,Order Number,STATUS,Date,Reason,Cash collected\n0245550101,#1042,Delivered,2026-10-20,,200\n,1043,Failed,21/10/2026,Not reachable,0\n,1044,returned,,,');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ line: 2, orderRef: '#1042', phone: '0245550101', status: 'delivered', date: '2026-10-20', errors: [] });
    expect(rows[0].cash?.toNumber()).toBe(200);
    expect(rows[1]).toMatchObject({ line: 3, orderRef: '1043', status: 'failed_delivery', date: '2026-10-21', reason: 'Not reachable', errors: [] });
    expect(rows[2]).toMatchObject({ line: 4, status: 'returned', errors: [] });
  });

  it('reads semicolon and tab files', () => {
    expect(parse('order;status\n55;delivered')[0]).toMatchObject({ orderRef: '55', status: 'delivered' });
    expect(parse('order\tstatus\n55\tfailed')[0]).toMatchObject({ orderRef: '55', status: 'failed_delivery' });
  });

  it('gives each bad row its own line number and reasons, and keeps the good ones', () => {
    const rows = parse('order,status,date,cash\n1,delivered,2026-10-20,100\n2,shipped,,\n,delivered,,\n4,delivered,2026-13-01,\n5,delivered,2027-01-01,\n6,returned,,abc');
    expect(rows.map((r) => [r.line, r.errors])).toEqual([
      [2, []],
      [3, ['Status "shipped" is not delivered, failed or returned']],
      [4, ['The row has no order number and no phone']],
      [5, ['Date "2026-13-01" is not a real date (use YYYY-MM-DD or DD/MM/YYYY)']],
      [6, ['Delivery date 2027-01-01 is in the future']],
      [7, ['Cash collected "abc" is not an amount']],
    ]);
  });

  it('refuses a file with no status column, no order or phone column, no rows, or too many rows', () => {
    const fails = (text: string) => { try { parse(text); return null; } catch (e) { return (e as CsvFileError).code; } };
    expect(fails('order,date\n1,2026-10-20')).toBe('MISSING_COLUMN');
    expect(fails('status,date\ndelivered,2026-10-20')).toBe('MISSING_COLUMN');
    expect(fails('')).toBe('EMPTY_FILE');
    expect(fails('order,status')).toBe('EMPTY_FILE');
    const rows = Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `${i + 1},delivered`).join('\n');
    expect(fails(`order,status\n${rows}`)).toBe('TOO_MANY_ROWS');
    const atLimit = Array.from({ length: CSV_MAX_ROWS }, (_, i) => `${i + 1},delivered`).join('\n');
    expect(parse(`order,status\n${atLimit}`)).toHaveLength(CSV_MAX_ROWS);
  });

  it('refuses a file over 10 MB', () => {
    const big = `order,status\n${'1,delivered\n'.repeat(1_000_000)}`;
    expect(() => parse(big)).toThrow(/10 MB/);
  });
});
