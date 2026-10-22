/**
 * Report export (M3-T21, F-1057): CSV and Excel of a tab, and one workbook with a sheet per tab. Both are written to the
 * response as they are produced (no file on the server, no row cap). The figures are cut from the same body the JSON
 * route returns, so a file and the screen cannot disagree.
 *
 *  - A tab is a list of sections (a title row, a header row, the rows). CSV stacks them with a blank line between;
 *    Excel stacks them on one sheet.
 *  - Money is 2 decimals ("92000.00" in CSV, a number with a 0.00 format in Excel). Rates and days are 1 decimal.
 *    Dates are ISO days in CSV and real dates in Excel.
 *  - Compare on: a section with a previous period gets "Previous ..." columns.
 *  - No PDF (G8).
 */
import { once } from 'events';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { AppError } from '../middleware/errorHandler';
import { teamReport } from './teamReportService';
import type { ReportBody, ReportRange, ReportTab } from './reportsService';
import { FORMULA_START } from './exportStream';

type CellType = 'text' | 'int' | 'money' | 'percent' | 'days' | 'date';
type Cell = { v: string | number | null; t: CellType };
export interface Section { title: string; header: string[]; rows: Cell[][] }

export type ExportTab = ReportTab | 'team';
export interface ExportSheet { name: string; sections: Section[] }

const c = (v: string | number | null | undefined, t: CellType): Cell => ({ v: v ?? null, t });
const text = (v: string | null | undefined) => c(v, 'text');
const int = (v: number | null | undefined) => c(v, 'int');
const money = (v: string | null | undefined) => c(v, 'money');
const pct = (v: number | null | undefined) => c(v, 'percent');
const days = (v: number | null | undefined) => c(v, 'days');
const date = (v: string | null | undefined) => c(v, 'date');

/** Unwrap a block; a block that failed fails the export (the cause is in the log under its errorId). */
function open<T>(block: unknown, name: string): T {
  if (block && typeof block === 'object' && 'error' in block) throw new AppError(`The ${name} block could not be built. Try again.`, 500);
  return block as T;
}

const change = (value: number | string | null, previous: number | string | null | undefined): Cell =>
  pct(value === null || value === undefined || previous === null || previous === undefined || Number(previous) === 0
    ? null
    : Math.round(((Number(value) - Number(previous)) / Number(previous)) * 100));

interface Tile { value: number | string | null; previous?: number | string | null }

/** A "Tiles" section: Metric, This period, and with compare Previous period and Change %. */
function tiles(compare: boolean, items: Array<[string, Tile, CellType]>): Section {
  return {
    title: 'Tiles',
    header: compare ? ['Metric', 'This period', 'Previous period', 'Change %'] : ['Metric', 'This period'],
    rows: items.map(([label, tile, type]) => {
      const row = [text(label), c(tile.value, type)];
      return compare ? [...row, c(tile.previous ?? null, type), type === 'percent' ? pct(null) : change(tile.value, tile.previous)] : row;
    }),
  };
}

const nulls = (n: number): Cell[] => Array.from({ length: n }, () => text(null));

/** The previous-period cells of a row: none when compare is off, blanks when the row has no previous day. */
const prevCells = <T>(compare: boolean, p: T | null | undefined, build: (p: T) => Cell[], width: number): Cell[] =>
  !compare ? [] : p ? build(p) : nulls(width);

function overviewSheet(b: ReportBody): Section[] {
  const compare = b.compare !== null;
  const t = open<any>(b.tiles, 'tiles');
  const ended = open<any>(b.endedUp, 'endedUp');
  const daily = open<any>(b.daily, 'daily');
  return [
    tiles(compare, [
      ['Orders', t.orders, 'int'],
      ['Confirmed', t.confirmed, 'int'],
      ['Confirmation rate %', t.confirmed.confirmationRate, 'percent'],
      ['Delivered', t.delivered, 'int'],
      ['Delivery success rate %', t.delivered.deliverySuccessRate, 'percent'],
      ['Delivered revenue', t.deliveredRevenue, 'money'],
      ['Order-to-cash yield %', t.orderToCashYield, 'percent'],
    ]),
    {
      title: 'Where orders ended up',
      header: ['Status', 'Orders', 'Share %'],
      rows: [...ended.segments.map((s: any) => [text(s.key), int(s.count), pct(s.percent)]), [text('Total'), int(ended.total), pct(ended.total ? 100 : null)]],
    },
    {
      title: 'Daily breakdown',
      header: ['Date', 'Orders', 'Confirmed', 'Delivered', 'Revenue',
        ...(compare ? ['Previous date', 'Previous orders', 'Previous confirmed', 'Previous delivered', 'Previous revenue'] : [])],
      rows: [
        ...daily.rows.map((r: any) => [date(r.date), int(r.orders), int(r.confirmed), int(r.delivered), money(r.revenue),
          ...prevCells<any>(compare, r.previous, (p) => [date(p.date), int(p.orders), int(p.confirmed), int(p.delivered), money(p.revenue)], 5)]),
        [text('Total'), int(daily.total.orders), int(daily.total.confirmed), int(daily.total.delivered), money(daily.total.revenue),
          ...prevCells<any>(compare, daily.total.previous, (p) => [text(null), int(p.orders), int(p.confirmed), int(p.delivered), money(p.revenue)], 5)],
      ],
    },
  ];
}

function salesSheet(b: ReportBody): Section[] {
  const compare = b.compare !== null;
  const t = open<any>(b.tiles, 'tiles');
  const perDay = open<any>(b.revenuePerDay, 'revenuePerDay');
  const product = open<any>(b.byProduct, 'byProduct');
  const state = open<any>(b.byState, 'byState');
  const items: Array<[string, Tile, CellType]> = [
    ['Delivered revenue', t.deliveredRevenue, 'money'],
    ['Delivered orders', t.deliveredOrders, 'int'],
    ['Average order value', t.aov, 'money'],
    ['Average order value, last 30 days', { value: t.thirtyDayAov.value }, 'money'],
  ];
  if (t.cashReceived) items.push(['Cash received', t.cashReceived, 'money'], ['Cash still with partners', { value: t.cashWithPartners.value }, 'money']);
  return [
    tiles(compare, items),
    {
      title: 'Delivered revenue per day',
      header: compare ? ['Date', 'Revenue', 'Previous date', 'Previous revenue'] : ['Date', 'Revenue'],
      rows: perDay.rows.map((r: any) => [date(r.date), money(r.revenue),
        ...prevCells<any>(compare, r.previous, (p) => [date(p.date), money(p.revenue)], 2)]),
    },
    {
      title: 'Revenue by product',
      header: ['Product', 'SKU', 'Units', 'Revenue', 'Share %'],
      rows: [...product.rows.map((r: any) => [text(r.name), text(r.sku), int(r.units), money(r.revenue), pct(r.sharePercent)]),
        [text('Total'), text(null), int(product.rows.reduce((n: number, r: any) => n + r.units, 0)), money(product.total), pct(product.rows.length ? 100 : null)]],
    },
    {
      title: `Revenue by ${String(state.label).toLowerCase()}`,
      header: [state.label, 'Delivered', 'Revenue', 'Average order', 'Share %'],
      rows: [...state.rows.map((r: any) => [text(r.state), int(r.delivered), money(r.revenue), money(r.averageOrder), pct(r.sharePercent)]),
        [text('Total'), int(state.total.delivered), money(state.total.revenue), money(state.total.averageOrder), pct(state.rows.length ? 100 : null)]],
    },
  ];
}

function deliverySheet(b: ReportBody): Section[] {
  const compare = b.compare !== null;
  const t = open<any>(b.tiles, 'tiles');
  const perDay = open<any>(b.deliveredPerDay, 'deliveredPerDay');
  const reasons = open<any>(b.reasons, 'reasons');
  const state = open<any>(b.successByState, 'successByState');
  const waiting = open<any>(b.waitingAndReturns, 'waitingAndReturns');
  const partners = open<any>(b.partners, 'partners');
  const withCash = partners.total.cashHeld !== undefined;
  return [
    tiles(compare, [
      ['Delivery success rate %', t.deliverySuccessRate, 'percent'],
      ['Failed deliveries', t.failed, 'int'],
      ['Returned', t.returned, 'int'],
      ['Not reachable, % of failed and returned', { value: t.notReachable.percentOfFailedAndReturned }, 'percent'],
      ['Out for delivery now', { value: t.outForDeliveryNow.value }, 'int'],
      ['Slowest partner pays in, days', { value: t.slowestPaysIn?.days ?? null }, 'days'],
    ]),
    {
      title: 'Delivered per day',
      header: compare ? ['Date', 'Delivered', 'Previous date', 'Previous delivered'] : ['Date', 'Delivered'],
      rows: perDay.rows.map((r: any) => [date(r.date), int(r.delivered),
        ...prevCells<any>(compare, r.previous, (p) => [date(p.date), int(p.delivered)], 2)]),
    },
    {
      title: 'Failed and returned by reason',
      header: ['Reason', 'Orders', 'Share %'],
      rows: [...reasons.rows.map((r: any) => [text(r.reason), int(r.count), pct(r.percent)]), [text('Total'), int(reasons.total), pct(reasons.rows.length ? 100 : null)]],
    },
    {
      title: `Delivery success by ${String(state.label).toLowerCase()}`,
      header: [state.label, 'Placed', 'Delivered', 'Failed', 'Returned', 'Closed', 'Success rate %'],
      rows: state.rows.map((r: any) => [text(r.state), int(r.placed), int(r.delivered), int(r.failed), int(r.returned), int(r.closed), pct(r.successRate)]),
    },
    {
      title: 'Waiting and returns',
      header: ['Metric', 'Value'],
      rows: [
        [text('Waiting to dispatch'), int(waiting.waiting.count)],
        [text('Oldest waiting, days'), int(waiting.waiting.oldestDays)],
        [text('Returned orders'), int(waiting.returned.count)],
      ],
    },
    {
      title: 'Delivery partners',
      header: ['Partner', 'Assigned', 'Delivered', 'Failed or returned', 'Out now', 'Success rate %', 'Days to dispatch', 'Days to deliver', ...(withCash ? ['Cash held'] : []), 'Pays in, days'],
      rows: [
        ...partners.rows.map((r: any) => [text(r.name), int(r.assigned), int(r.delivered), int(r.failedOrReturned), int(r.outNow), pct(r.successRate),
          days(r.confirmedToDispatchedDays), days(r.dispatchedToDeliveredDays), ...(withCash ? [money(r.cashHeld)] : []), days(r.paysInDays)]),
        [text('All partners'), int(partners.total.assigned), int(partners.total.delivered), int(partners.total.failedOrReturned), int(partners.total.outNow),
          pct(partners.total.successRate), text(null), text(null), ...(withCash ? [money(partners.total.cashHeld)] : []), text(null)],
      ],
    },
  ];
}

/** Team performance (M1-T18) has no previous period, so its export has no compare columns. */
async function teamSheet(tenantId: string, r: ReportRange): Promise<Section[]> {
  const t = await teamReport(tenantId, r.from, r.to);
  return [
    {
      title: 'Tiles',
      header: ['Metric', 'This period'],
      rows: [
        [text('Orders confirmed'), int(t.tiles.ordersConfirmed)],
        [text('Calls made'), int(t.tiles.callsMade)],
        [text('Not reachable'), int(t.tiles.notReachable.count)],
        [text('Pending in the queue now'), int(t.tiles.queue.pending)],
      ],
    },
    {
      title: 'Call reps',
      header: ['Rep', 'Calls', 'Confirmed', 'Confirmation rate %', 'Delivered from confirmed %', 'Time to first call, minutes', 'Upsell rate %', 'Extra value', 'Target (confirmed orders delivered)', 'Delivered of target', 'Target hit %', 'Not reachable'],
      rows: [
        ...t.reps.map((x) => repRow(x.name, x)),
        repRow('All call reps', t.all),
      ],
    },
  ];
}

type TeamRow = Awaited<ReturnType<typeof teamReport>>['all'];
const repRow = (name: string, x: TeamRow): Cell[] => [
  text(name), int(x.calls), int(x.confirmed), pct(x.confirmationPercent), pct(x.deliveredFromConfirmedPercent),
  days(x.timeToFirstCallMinutes), pct(x.upsellRate), money(x.extraValue),
  int(x.targetHit?.target), int(x.targetHit?.actual), pct(x.targetHit?.percent), int(x.notReachable),
];

export const SHEET_TITLES: Record<ExportTab, string> = { overview: 'Overview', sales: 'Sales and revenue', delivery: 'Delivery and operations', team: 'Team performance' };

/** The sections of one tab, cut from its report body (team is read here, it has no body). */
export async function sectionsOf(tab: ExportTab, tenantId: string, r: ReportRange, body: ReportBody | null): Promise<Section[]> {
  switch (tab) {
    case 'overview': return overviewSheet(body as ReportBody);
    case 'sales': return salesSheet(body as ReportBody);
    case 'delivery': return deliverySheet(body as ReportBody);
    case 'team': return teamSheet(tenantId, r);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------------------------------------

/** A text cell that starts with = + - @ is read as a formula by Excel; a leading ' makes it text (same rule as exportStream.ts). */
const safeText = (value: string) => (FORMULA_START.test(value) ? `'${value}` : value);

const fixed: Partial<Record<CellType, number>> = { money: 2, percent: 1, days: 1 };

/** A cell as CSV text: numbers with their fixed decimals, dates as ISO days. */
function csvValue(cell: Cell): string {
  if (cell.v === null) return '';
  const digits = fixed[cell.t];
  const value = digits !== undefined && cell.v !== '' ? Number(cell.v).toFixed(digits) : cell.t === 'text' ? safeText(String(cell.v)) : String(cell.v);
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
const csvLine = (values: string[]) => `${values.join(',')}\r\n`;

/** Write sections as CSV, a chunk per section row, waiting for the socket to drain. */
export async function writeCsv(res: Response, sections: Section[]): Promise<void> {
  const write = async (chunk: string) => { if (!res.write(chunk)) await once(res, 'drain'); };
  await write('﻿');
  let first = true;
  for (const s of sections) {
    if (!first) await write('\r\n');
    first = false;
    await write(csvLine([csvValue(text(s.title))]));
    await write(csvLine(s.header.map((h) => csvValue(text(h)))));
    for (const row of s.rows) await write(csvLine(row.map(csvValue)));
  }
  res.end();
}

const NUM_FMT: Partial<Record<CellType, string>> = { money: '0.00', percent: '0.0', days: '0.0', date: 'yyyy-mm-dd' };

/** Write sheets as an .xlsx stream: numbers are numbers, dates are dates, money has a 0.00 format. */
export async function writeXlsx(res: Response, sheets: ExportSheet[]): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
    sheet.sections.forEach((s, i) => {
      if (i > 0) ws.addRow([]).commit();
      const title = ws.addRow([safeText(s.title)]);
      title.font = { bold: true };
      title.commit();
      const header = ws.addRow(s.header.map(safeText));
      header.font = { bold: true };
      header.commit();
      for (const row of s.rows) {
        const out = ws.addRow(row.map((cell) => (cell.v === null ? null : cell.t === 'date' ? new Date(`${cell.v}T00:00:00Z`) : cell.t === 'text' ? safeText(String(cell.v)) : Number(cell.v))));
        row.forEach((cell, col) => {
          const fmt = NUM_FMT[cell.t];
          if (fmt && cell.v !== null) out.getCell(col + 1).numFmt = fmt;
        });
        out.commit();
      }
    });
    ws.commit();
  }
  await wb.commit();
}
