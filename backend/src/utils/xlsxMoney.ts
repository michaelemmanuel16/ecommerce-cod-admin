import type { Worksheet } from 'exceljs';

/**
 * Add export rows to a sheet. Money cells arrive as "x.xx" text (shared with the CSV export);
 * Excel needs real numbers, so the money columns are written numeric with a 0.00 format.
 */
export function addRowsWithMoney(worksheet: Worksheet, rows: Record<string, any>[], moneyKeys: string[]): void {
  for (const key of moneyKeys) worksheet.getColumn(key).numFmt = '0.00';
  worksheet.addRows(
    rows.map((row) => ({ ...row, ...Object.fromEntries(moneyKeys.map((key) => [key, Number(row[key])])) }))
  );
}
