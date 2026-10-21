import { Response } from 'express';
import ExcelJS from 'exceljs';
import { AppError } from '../middleware/errorHandler';
import { BULK_ORDER_CONFIG } from '../config/bulkOrderConfig';
import { formatPhoneLocal } from '../utils/phone';
import * as Money from '../utils/money';
import logger from '../utils/logger';

/**
 * Streaming CSV and XLSX export (F-320, F-361). Rows arrive in batches and are written as they come, so memory
 * stays flat whatever the row count. Callers count first and call `assertWithinCap`, because once the first
 * byte is out the status code can no longer change.
 */

export type ExportFormat = 'csv' | 'xlsx';

export interface ExportColumn<T> {
  header: string;
  /** Text, or a number for a money / count column. */
  value: (row: T) => string | number | null | undefined;
  /**
   * `money`: a number cell with a 0.00 format in XLSX. `count`: a plain number cell. `phone`: a text cell, so
   * Excel keeps the leading 0 and never shows 2.45E+08. Default: text.
   */
  kind?: 'money' | 'count' | 'phone';
}

/** The row type of an export generator (`exportBatches`). */
export type BatchRow<G> = G extends AsyncGenerator<Array<infer Row>> ? Row : never;

export function readFormat(value: unknown): ExportFormat {
  if (value === undefined || value === '') return 'csv';
  if (value === 'csv' || value === 'xlsx') return value;
  throw new AppError('format must be csv or xlsx.', 400, 'INVALID_FORMAT');
}

export function assertWithinCap(count: number): void {
  if (count > BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS) {
    throw new AppError('Narrow the date range.', 400, 'EXPORT_TOO_LARGE');
  }
}

/** `+233245550103` as it shows in the app: `024 555 0103`. Spaces keep it text in CSV (Excel drops the 0 of a bare number). */
export const exportPhone = (phone: string | null | undefined) => (phone ? formatPhoneLocal(phone) : '');

export const exportMoney = (value: Money.MoneyInput | null | undefined) => (value == null ? '' : Money.toApi(value));

/** `YYYY-MM-DD HH:mm` Accra time. Accra is UTC all year, so no zone shift is needed. */
export const exportDate = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 16).replace('T', ' ') : '');

/** A text cell that starts with = + - @ is read as a formula by Excel; a leading ' makes it text. */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | number | null | undefined, numeric: boolean): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (!numeric && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendHeaders(res: Response, format: ExportFormat, filename: string) {
  res.setHeader('Content-Type', format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.${format}"`);
  res.setHeader('Cache-Control', 'no-store');
}

export async function streamExport<T>(
  res: Response,
  { format, filename, columns, batches }: {
    format: ExportFormat;
    filename: string;
    columns: ExportColumn<T>[];
    batches: AsyncIterable<T[]>;
  },
): Promise<void> {
  sendHeaders(res, format, filename);
  try {
    if (format === 'csv') {
      // BOM so Excel reads the names as UTF-8
      res.write(`﻿${columns.map((c) => csvCell(c.header, false)).join(',')}\r\n`);
      for await (const batch of batches) {
        const chunk = batch.map((row) => columns.map((c) => csvCell(c.value(row), c.kind === 'money' || c.kind === 'count')).join(',')).join('\r\n');
        if (!res.write(`${chunk}\r\n`)) await new Promise<void>((resolve) => res.once('drain', () => resolve()));
      }
      res.end();
      return;
    }

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
    const sheet = workbook.addWorksheet('Export');
    sheet.columns = columns.map((c) => ({
      header: c.header,
      width: 20,
      ...(c.kind === 'money' && { style: { numFmt: '0.00' } }),
      ...(c.kind === 'phone' && { style: { numFmt: '@' } }),
    }));
    for await (const batch of batches) {
      for (const row of batch) {
        sheet.addRow(columns.map((c) => {
          const v = c.value(row);
          if (c.kind === 'money' || c.kind === 'count') return v === '' || v == null ? null : Number(v);
          return v ?? null;
        })).commit();
      }
    }
    sheet.commit();
    await workbook.commit();
  } catch (error) {
    // Headers are out already: end the connection so the client sees a failed download, not a short file
    logger.error('Export failed while streaming', { error: (error as Error).message });
    res.destroy(error as Error);
  }
}
