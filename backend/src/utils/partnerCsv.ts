/**
 * Partner status list in CSV (M5-T17; F-712). Pure: no database. The service matches the rows to orders.
 *
 * Columns (header row, any order, any case; a space, dash or underscore in the name does not matter):
 *   order number  (`order`, `order number`, `order id`, `ref`)   an order number such as 1042 or #1042
 *   phone         (`phone`, `customer phone`)                    used when the order number is empty
 *   status        (`status`)                                     delivered, failed or returned
 *   date          (`date`, `delivery date`)                      YYYY-MM-DD or DD/MM/YYYY; the delivery date for a delivered row
 *   reason        (`reason`, `failure reason`)                   optional, kept in the order note
 *   cash collected (`cash`, `cash collected`, `amount`)          optional; a difference from the order amount is a warning
 * A row needs a status and an order number or a phone. Comma, semicolon or tab separated; quotes allowed; UTF-8 BOM allowed.
 */
import * as Money from './money';

export const CSV_MAX_ROWS = 2000;
export const CSV_MAX_BYTES = 10 * 1024 * 1024;

export type CsvStatus = 'delivered' | 'failed_delivery' | 'returned';

export interface CsvRow {
  /** Line in the file where the row starts. The header is line 1. */
  line: number;
  orderRef: string | null;
  phone: string | null;
  status: CsvStatus | null;
  /** YYYY-MM-DD */
  date: string | null;
  reason: string | null;
  cash: Money.Money | null;
  /** Why the row cannot be used. Empty for a good row. */
  errors: string[];
}

export class CsvFileError extends Error {
  constructor(message: string, readonly code: 'EMPTY_FILE' | 'MISSING_COLUMN' | 'TOO_MANY_ROWS' | 'FILE_TOO_LARGE') {
    super(message);
  }
}

const COLUMN_ALIASES: Record<'order' | 'phone' | 'status' | 'date' | 'reason' | 'cash', string[]> = {
  order: ['order', 'ordernumber', 'orderno', 'orderid', 'ordernum', 'ref', 'reference'],
  phone: ['phone', 'phonenumber', 'customerphone', 'mobile'],
  status: ['status', 'deliverystatus'],
  date: ['date', 'deliverydate', 'statusdate'],
  reason: ['reason', 'failurereason', 'note', 'remark'],
  cash: ['cash', 'cashcollected', 'amount', 'collected'],
};

const STATUS_WORDS: Record<string, CsvStatus> = {
  delivered: 'delivered',
  failed: 'failed_delivery',
  faileddelivery: 'failed_delivery',
  returned: 'returned',
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Split text into records of fields. Quotes may hold the delimiter, a line break and a doubled quote. Records keep their start line. */
export function splitCsv(text: string, delimiter: string): Array<{ line: number; fields: string[] }> {
  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const endField = () => { fields.push(field); field = ''; };
  const endRecord = () => {
    endField();
    if (fields.some((f) => f.trim() !== '')) records.push({ line: start, fields });
    fields = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else {
      field += ch;
    }
  }
  endRecord();
  return records;
}

/** The delimiter the header line uses: the one of comma, semicolon and tab that occurs most. */
function delimiterOf(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, header.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ',';
}

/** YYYY-MM-DD from `2026-10-12` or `12/10/2026` (day first). Null when it is not a real calendar day. */
export function parseCsvDate(value: string): string | null {
  const v = value.trim();
  let y: number; let m: number; let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (iso) { [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]; }
  else if (local) { [d, m, y] = [Number(local[1]), Number(local[2]), Number(local[3])]; }
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Parse a partner file. Throws CsvFileError for a file-level problem; a bad row is returned with its `errors`. */
export function parsePartnerCsv(raw: string, now: Date = new Date()): CsvRow[] {
  const text = raw.replace(/^﻿/, '');
  if (Buffer.byteLength(text, 'utf8') > CSV_MAX_BYTES) throw new CsvFileError('The file is larger than 10 MB', 'FILE_TOO_LARGE');
  const delimiter = delimiterOf(text);
  const records = splitCsv(text, delimiter);
  if (records.length === 0) throw new CsvFileError('The file is empty', 'EMPTY_FILE');

  const header = records[0].fields.map(squash);
  const col = (key: keyof typeof COLUMN_ALIASES) => header.findIndex((h) => COLUMN_ALIASES[key].includes(h));
  const at = { order: col('order'), phone: col('phone'), status: col('status'), date: col('date'), reason: col('reason'), cash: col('cash') };
  if (at.status < 0) throw new CsvFileError('The file needs a "status" column on line 1', 'MISSING_COLUMN');
  if (at.order < 0 && at.phone < 0) throw new CsvFileError('The file needs an "order number" or a "phone" column on line 1', 'MISSING_COLUMN');

  const body = records.slice(1);
  if (body.length === 0) throw new CsvFileError('The file has a header but no rows', 'EMPTY_FILE');
  if (body.length > CSV_MAX_ROWS) throw new CsvFileError(`The file has ${body.length} rows. The limit is ${CSV_MAX_ROWS}; split it and upload each part.`, 'TOO_MANY_ROWS');

  const cell = (fields: string[], i: number) => (i >= 0 ? (fields[i] ?? '').trim() : '');
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);

  return body.map(({ line, fields }): CsvRow => {
    const errors: string[] = [];
    const statusText = cell(fields, at.status);
    const status = STATUS_WORDS[squash(statusText)] ?? null;
    if (!statusText) errors.push('Status is empty');
    else if (!status) errors.push(`Status "${statusText}" is not delivered, failed or returned`);

    const orderRef = cell(fields, at.order) || null;
    const phone = cell(fields, at.phone) || null;
    if (!orderRef && !phone) errors.push('The row has no order number and no phone');

    let date: string | null = null;
    const dateText = cell(fields, at.date);
    if (dateText) {
      date = parseCsvDate(dateText);
      if (!date) errors.push(`Date "${dateText}" is not a real date (use YYYY-MM-DD or DD/MM/YYYY)`);
      else if (status === 'delivered' && date > tomorrow) errors.push(`Delivery date ${date} is in the future`);
    }

    let cash: Money.Money | null = null;
    const cashText = cell(fields, at.cash);
    if (cashText) {
      cash = Money.tryParse(cashText.replace(/,/g, ''));
      if (!cash || cash.lt(0)) { errors.push(`Cash collected "${cashText}" is not an amount`); cash = null; }
    }
    return { line, orderRef, phone, status, date, reason: cell(fields, at.reason) || null, cash, errors };
  });
}
