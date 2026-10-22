import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { Country } from 'country-state-city';
import { OrderStatus } from '@prisma/client';
import prisma, { prismaBase } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { BULK_ORDER_CONFIG } from '../config/bulkOrderConfig';
import { sanitizeAddress, sanitizeName, sanitizePhoneNumber, sanitizeString } from '../utils/sanitizer';
import { phoneLookupVariants } from '../utils/phone';
import { getRegionsForCountry } from '../utils/regions';
import { currencyOfTenant } from '../utils/currency';
import { resolveTenantId } from '../utils/tenantContext';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { csvCell } from './exportStream';
import * as Money from '../utils/money';
import type { BulkImportOrderData } from './orderService';

/**
 * Order import (F-319): read a CSV or XLSX file, check every row, and say which rows are ready.
 * `checkRows` is pure; `prepareImport` adds the lookups (regions, products, users, duplicates).
 * Nothing here writes. `orderService.bulkImportOrders` saves the ready rows through the state machine.
 */

export const IMPORT_MAX_ROWS = 2000;
export const SPLIT_MESSAGE = 'Split the file into parts of 2,000 rows.';

/** A history import may create an order in any status except these three (F-319). */
export const IMPORT_BLOCKED_STATUSES: OrderStatus[] = ['payment_pending', 'payment_failed', 'digital_delivered'];

/** A row that is the same phone, address and amount within this window is a duplicate. */
export const DUPLICATE_WINDOW_MS = BULK_ORDER_CONFIG.DUPLICATE_DETECTION_WINDOW;

const ALL_STATUSES = Object.values(OrderStatus);
const DELETED_GRACE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------------------------------------

export interface SheetRow {
  /** Row number in the file: 2 is the first data row. */
  row: number;
  /** Cell text by header name, as the file spells it. */
  cells: Record<string, string>;
}

export interface Sheet {
  headers: string[];
  rows: SheetRow[];
  /** Said to the user when something in the file was left out. */
  note: string | null;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as { result?: unknown; text?: unknown; richText?: Array<{ text: string }> };
    if (v.richText) return v.richText.map((part) => part.text).join('').trim();
    if (v.result !== undefined) return cellText(v.result);
    if (v.text !== undefined) return cellText(v.text);
    return '';
  }
  return String(value).trim();
}

/** CSV with a BOM, commas or semicolons; XLSX first sheet only. More than 2,000 data rows is refused. */
export async function readSheet(file: { originalname: string; buffer: Buffer }): Promise<Sheet> {
  const extension = file.originalname.split('.').pop()?.toLowerCase();
  let headers: string[] = [];
  const raw: Array<{ row: number; values: string[] }> = [];
  let note: string | null = null;

  if (extension === 'csv') {
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
    let table: string[][];
    try {
      table = parseCsv(text, { delimiter, skip_empty_lines: true, relax_column_count: true, trim: true });
    } catch {
      throw new AppError('This file could not be read as a CSV.', 400);
    }
    headers = (table[0] ?? []).map((h) => String(h).trim());
    table.slice(1).forEach((values, i) => raw.push({ row: i + 2, values: values.map((v) => String(v)) }));
  } else if (extension === 'xlsx' || extension === 'xls') {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as any);
    } catch {
      throw new AppError('This file could not be read as a spreadsheet.', 400);
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new AppError('This file has no sheet.', 400);
    if (workbook.worksheets.length > 1) note = `Only the first sheet ("${sheet.name}") was read.`;
    headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = cellText(cell.value); });
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { values[col - 1] = cellText(cell.value); });
      raw.push({ row: rowNumber, values });
    });
  } else {
    throw new AppError('Unsupported file format', 400);
  }

  const rows = raw
    .filter((r) => r.values.some((v) => v !== undefined && String(v).trim() !== ''))
    .map(({ row, values }) => ({
      row,
      cells: Object.fromEntries(headers.map((h, i) => [h, String(values[i] ?? '').trim()]).filter(([h]) => h !== '')),
    }));
  if (rows.length > IMPORT_MAX_ROWS) throw new AppError(SPLIT_MESSAGE, 400);
  return { headers: headers.filter(Boolean), rows, note };
}

// ---------------------------------------------------------------------------------------------------------
// Checking rows
// ---------------------------------------------------------------------------------------------------------

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Header spellings per field, after `normHeader`. The first column is the template; the rest are older files. */
const COLUMNS = {
  name: ['customername', 'name', 'customer', 'fullname'],
  phone: ['phone', 'phonenumber', 'mobile'],
  altPhone: ['alternativephonenumber', 'alternatephone', 'altphone', 'alternativephone'],
  address: ['address', 'customeraddress', 'deliveryaddress'],
  region: ['region', 'state'],
  town: ['town', 'area', 'city', 'townorarea'],
  product: ['product', 'productname', 'sku'],
  quantity: ['quantity', 'qty'],
  price: ['price', 'unitprice'],
  total: ['totalamount', 'total'],
  status: ['status', 'orderstatus'],
  rep: ['assignedrep', 'customerrep', 'callrep', 'rep'],
  agent: ['assignedagent', 'deliveryagent', 'agent'],
  date: ['date', 'orderdate', 'dateddmmyyyy'],
  notes: ['notes', 'note'],
} as const;
type Field = keyof typeof COLUMNS;

function pick(cells: Record<string, string>): Record<Field, string> {
  const byHeader = new Map(Object.entries(cells).map(([h, v]) => [normHeader(h), v]));
  const out = {} as Record<Field, string>;
  for (const field of Object.keys(COLUMNS) as Field[]) {
    out[field] = COLUMNS[field].map((h) => byHeader.get(h)).find((v) => v !== undefined && v !== '') ?? '';
  }
  return out;
}

/** Edit distance, for the "Did you mean" hint. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

const regionKey = (s: string) => s.toLowerCase().replace(/\bregion\b/g, '').replace(/[^a-z]/g, '');

export type RegionMatch = { region: string } | { problem: string };

/** An exact match (case, spaces and a trailing "Region" ignored) is accepted. A near match is a hint and is not applied. */
export function matchRegion(input: string, regions: string[], countryName: string): RegionMatch {
  if (!input) return { problem: 'State is missing' };
  if (!regions.length) return { region: input };
  const key = regionKey(input);
  const exact = regions.find((r) => regionKey(r) === key);
  if (exact) return { region: exact };
  const near = regions
    .map((r) => ({ r, d: editDistance(key, regionKey(r)) }))
    .filter(({ r, d }) => d <= (regionKey(r).length >= 7 ? 2 : 1))
    .sort((a, b) => a.d - b.d)[0];
  return near
    ? { problem: `State "${input}" is not in the list. Did you mean ${near.r}?` }
    : { problem: `State "${input}" is not one of ${countryName}'s states` };
}

function parseDate(text: string): Date | null | undefined {
  if (!text) return undefined;
  let y: number, m: number, d: number;
  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (ymd) [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
  else return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  if (date.getTime() > Date.now() || y < 2020) return null;
  return date;
}

/** "GH₵ 1,200.50" to "1200.50". */
const moneyText = (s: string) => s.replace(/[,\s]/g, '').replace(/^(GH₵|GHS|₦|NGN|\$)/i, '');

export interface ImportProduct { id: number; name: string; sku: string }
export interface ImportUser { id: number; name: string }

export interface CheckContext {
  regions: string[];
  countryName: string;
  products: ImportProduct[];
  reps: ImportUser[];
  agents: ImportUser[];
  /** Fixed "now" for tests. */
  now?: Date;
}

export interface CheckedRow {
  row: number;
  /** The cells as the file spells them, for the problems file. */
  cells: Record<string, string>;
  problems: string[];
  /** Set when there are no problems. */
  data?: BulkImportOrderData;
  summary: { customerName: string; phone: string; region: string; product: string; quantity: number | null; price: string | null; status: OrderStatus };
}

const findProduct = (text: string, products: ImportProduct[]): ImportProduct | 'ambiguous' | null => {
  const t = text.toLowerCase();
  const exact = products.filter((p) => p.name.toLowerCase() === t || p.sku.toLowerCase() === t);
  if (exact.length) return exact[0];
  const partial = products.filter((p) => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t));
  return partial.length === 1 ? partial[0] : partial.length > 1 ? 'ambiguous' : null;
};

const findUser = (text: string, users: ImportUser[]): ImportUser | null => {
  const t = text.toLowerCase();
  const exact = users.find((u) => u.name.toLowerCase() === t);
  if (exact) return exact;
  const partial = users.filter((u) => u.name.toLowerCase().includes(t));
  return partial.length === 1 ? partial[0] : null;
};

/** F-319 row checks. Every problem is a plain sentence the user can act on. */
export function checkRows(sheetRows: SheetRow[], ctx: CheckContext): CheckedRow[] {
  return sheetRows.map(({ row, cells }) => {
    const v = pick(cells);
    const problems: string[] = [];

    // phone: 9 to 15 digits, with or without the leading 0
    const phone = sanitizePhoneNumber(v.phone);
    const digits = phone.replace(/\D/g, '').length;
    if (!v.phone) problems.push('Phone is missing');
    else if (digits < BULK_ORDER_CONFIG.PHONE_NUMBER.DIGITS_MIN || digits > BULK_ORDER_CONFIG.PHONE_NUMBER.DIGITS_MAX) {
      problems.push(`Phone must have ${BULK_ORDER_CONFIG.PHONE_NUMBER.DIGITS_MIN} to ${BULK_ORDER_CONFIG.PHONE_NUMBER.DIGITS_MAX} digits`);
    }

    const address = sanitizeAddress(v.address, BULK_ORDER_CONFIG.ADDRESS.MAX_LENGTH);
    if (address.length < BULK_ORDER_CONFIG.ADDRESS.MIN_LENGTH) problems.push(v.address ? 'Address is too short' : 'Address is missing');

    const region = matchRegion(sanitizeString(v.region, BULK_ORDER_CONFIG.NAME.MAX_LENGTH), ctx.regions, ctx.countryName);
    if ('problem' in region) problems.push(region.problem);

    let productId: number | undefined;
    let productName = v.product;
    let product: ImportProduct | 'ambiguous' | null = null;
    if (!v.product) problems.push('Product is missing');
    else {
      product = findProduct(v.product, ctx.products);
      if (product === 'ambiguous') problems.push(`Product "${v.product}" matches more than one product. Use the SKU`);
      else if (!product) problems.push(`Product "${v.product}" was not found`);
      else { productId = product.id; productName = product.name; }
    }

    const quantity = /^\d+$/.test(v.quantity) ? Number(v.quantity) : null;
    if (quantity === null || quantity < 1) problems.push('Quantity must be a whole number above 0');

    const priceCell = moneyText(v.price);
    const totalCell = moneyText(v.total);
    const price = Money.tryParse(priceCell);
    const total = Money.tryParse(totalCell);
    if (v.price && (!price || price.lte(0))) problems.push('Price must be a number above 0');
    else if (!v.price && !(total && total.gt(0))) problems.push(v.total ? 'Total amount must be a number above 0' : 'Price is missing');

    let status: OrderStatus = 'pending_confirmation';
    if (v.status) {
      const s = v.status.toLowerCase().replace(/[\s-]+/g, '_') as OrderStatus;
      if (!ALL_STATUSES.includes(s)) problems.push(`Status "${v.status}" is not recognised`);
      else if (IMPORT_BLOCKED_STATUSES.includes(s)) problems.push(`Status ${s} cannot be imported`);
      else status = s;
    }

    const orderDate = parseDate(v.date);
    if (orderDate === null) problems.push('Date must be dd/mm/yyyy and not in the future');

    const rep = v.rep ? findUser(v.rep, ctx.reps) : null;
    if (v.rep && !rep) problems.push(`Call rep "${v.rep}" was not found`);
    const agent = v.agent ? findUser(v.agent, ctx.agents) : null;
    if (v.agent && !agent) problems.push(`Delivery agent "${v.agent}" was not found`);

    const summary: CheckedRow['summary'] = {
      customerName: v.name, phone: v.phone, region: v.region, product: v.product, quantity, price: price ? Money.toApi(price) : null, status,
    };
    if (problems.length) return { row, cells, problems, summary };

    const qty = quantity as number;
    const unitPrice = price ?? Money.roundHalfUp(Money.div(total!, qty), 4);
    const totalAmount = total && total.gt(0) && !price ? total : Money.roundHalfUp(Money.mul(unitPrice, qty), 4);
    const name = sanitizeName(v.name, BULK_ORDER_CONFIG.NAME.MAX_LENGTH).split(' ');
    const data: BulkImportOrderData = {
      customerPhone: phone,
      customerFirstName: name[0] || 'Unknown',
      customerLastName: name.slice(1).join(' '),
      customerAlternatePhone: sanitizePhoneNumber(v.altPhone) || undefined,
      subtotal: totalAmount,
      totalAmount,
      deliveryAddress: address,
      deliveryState: (region as { region: string }).region,
      // No town in the file: leave it empty. The state never goes in the town field.
      deliveryArea: sanitizeString(v.town, BULK_ORDER_CONFIG.NAME.MAX_LENGTH),
      productName,
      productId,
      quantity: qty,
      unitPrice,
      status,
      notes: sanitizeString(v.notes, BULK_ORDER_CONFIG.NOTES.MAX_LENGTH) || undefined,
      assignedRepName: rep ? v.rep : undefined,
      assignedAgentName: agent ? v.agent : undefined,
      orderDate: orderDate ?? undefined,
      sourceRow: row,
    };
    return { row, cells, problems, data, summary };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------------------------------------

const normalizeText = (val: string | null | undefined) => String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface ExistingOrder {
  id: number;
  status: OrderStatus;
  deliveryAddress: string | null;
  totalAmount: Money.MoneyInput;
  createdAt: Date;
  deletedAt: Date | null;
}

/**
 * The duplicate rule: same address and amount, created within 24 hours of the row's date (the phone is matched by the
 * query). A deleted order counts only for a few minutes after the delete, so a fixed-and-reimported row is not blocked.
 */
export function isDuplicateOf(existing: ExistingOrder, data: Pick<BulkImportOrderData, 'deliveryAddress' | 'totalAmount'>, at: Date): boolean {
  return Math.abs(existing.createdAt.getTime() - at.getTime()) <= DUPLICATE_WINDOW_MS
    && Money.compare(existing.totalAmount, data.totalAmount) === 0
    && normalizeText(existing.deliveryAddress) === normalizeText(data.deliveryAddress)
    && (!existing.deletedAt || Date.now() - existing.deletedAt.getTime() < DELETED_GRACE_MS);
}

/** The where for orders that could duplicate a row: this tenant, this phone in any stored format, inside the window. */
export function duplicateCandidatesWhere(data: Pick<BulkImportOrderData, 'customerPhone'>, from: Date, to: Date) {
  return {
    tenantId: resolveTenantId(),
    customer: { phoneNumber: { in: phoneLookupVariants(data.customerPhone) } },
    createdAt: { gte: new Date(from.getTime() - DUPLICATE_WINDOW_MS), lte: new Date(to.getTime() + DUPLICATE_WINDOW_MS) },
  };
}

const STATUS_ORDER: OrderStatus[] = ['pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered'];
/** A duplicate with a later status moves the existing order forward (as today). */
export const isForwardStatus = (current: OrderStatus, next: OrderStatus) => {
  const ci = STATUS_ORDER.indexOf(current);
  const ni = STATUS_ORDER.indexOf(next);
  return ci !== -1 && ni !== -1 && ni > ci;
};

// ---------------------------------------------------------------------------------------------------------
// Prepare: lookups, checks, duplicates
// ---------------------------------------------------------------------------------------------------------

export interface DuplicateRow { row: number; orderId: number; advances: boolean }

export interface PreparedImport {
  fileName: string;
  sheet: Sheet;
  checked: CheckedRow[];
  /** Rows with no problem that will create or move an order. */
  ready: CheckedRow[];
  /** Rows with a problem. */
  problems: CheckedRow[];
  /** Rows with no problem that are skipped as duplicates (of an earlier row or an existing order). */
  duplicates: DuplicateRow[];
  /** Ready rows that move an existing order forward: row number to order id. */
  advances: Map<number, number>;
  repMap: Map<string, number>;
  agentMap: Map<string, number>;
}

/** Regions of the store's country. The country comes from the store currency (GHS is Ghana). */
async function storeRegions(): Promise<{ regions: string[]; countryName: string }> {
  const currency = await currencyOfTenant(resolveTenantId());
  const country = Country.getAllCountries().find((c) => c.currency === currency);
  return country ? { regions: getRegionsForCountry(country.isoCode), countryName: country.name } : { regions: [], countryName: 'the store country' };
}

export async function prepareImport(file: { originalname: string; buffer: Buffer }): Promise<PreparedImport> {
  const sheet = await readSheet(file);
  const [{ regions, countryName }, products, users] = await Promise.all([
    storeRegions(),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true, sku: true } }),
    prisma.user.findMany({
      where: { isActive: true, role: { in: ['sales_rep', 'delivery_agent'] } },
      select: { id: true, firstName: true, lastName: true, role: true },
    }),
  ]);
  const named = (role: string) => users.filter((u) => u.role === role).map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }));
  const reps = named('sales_rep');
  const agents = named('delivery_agent');

  const checked = checkRows(sheet.rows, { regions, countryName, products, reps, agents });
  const problems = checked.filter((r) => r.problems.length);
  const clean = checked.filter((r) => !r.problems.length);

  // Existing orders that could match, in one query for the whole file
  const dates = clean.map((r) => (r.data!.orderDate ?? new Date()).getTime());
  const existing = clean.length
    ? await withSoftDeleted(() => prismaBase.order.findMany({
      where: {
        tenantId: resolveTenantId(),
        customer: { phoneNumber: { in: [...new Set(clean.flatMap((r) => phoneLookupVariants(r.data!.customerPhone)))] } },
        createdAt: { gte: new Date(Math.min(...dates) - DUPLICATE_WINDOW_MS), lte: new Date(Math.max(...dates) + DUPLICATE_WINDOW_MS) },
      },
      select: { id: true, status: true, deliveryAddress: true, totalAmount: true, createdAt: true, deletedAt: true, customer: { select: { phoneNumber: true } } },
    }))
    : [];

  const ready: CheckedRow[] = [];
  const duplicates: DuplicateRow[] = [];
  const advances = new Map<number, number>();
  const seen = new Set<string>();
  for (const r of clean) {
    const data = r.data!;
    const at = data.orderDate ?? new Date();
    const variants = new Set(phoneLookupVariants(data.customerPhone));
    const match = existing.find((e) => variants.has(e.customer.phoneNumber) && isDuplicateOf(e, data, at));
    if (match) {
      const advance = isForwardStatus(match.status, data.status ?? 'pending_confirmation');
      if (advance) { ready.push(r); advances.set(r.row, match.id); }
      else duplicates.push({ row: r.row, orderId: match.id, advances: false });
      continue;
    }
    // Same phone, address, amount and day twice in the file
    const key = `${phoneLookupVariants(data.customerPhone)[0]}|${Money.toApi(data.totalAmount)}|${normalizeText(data.deliveryAddress)}|${at.toDateString()}`;
    if (seen.has(key)) { duplicates.push({ row: r.row, orderId: 0, advances: false }); continue; }
    seen.add(key);
    ready.push(r);
  }

  return {
    fileName: file.originalname,
    sheet,
    checked,
    ready,
    problems,
    duplicates,
    advances,
    repMap: new Map(ready.flatMap((r) => (r.data!.assignedRepName ? [[r.data!.assignedRepName, findUser(r.data!.assignedRepName, reps)!.id] as const] : []))),
    agentMap: new Map(ready.flatMap((r) => (r.data!.assignedAgentName ? [[r.data!.assignedAgentName, findUser(r.data!.assignedAgentName, agents)!.id] as const] : []))),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------

/** The rows that need a fix, with the file's own columns and a "problem" column (F-319). */
export function problemsCsv(headers: string[], rows: Array<{ cells: Record<string, string>; problems: string[] }>): string {
  const lines = [[...headers, 'problem'].map((c) => csvCell(c, false)).join(',')];
  for (const r of rows) lines.push([...headers.map((h) => r.cells[h] ?? ''), r.problems.join('; ')].map((c) => csvCell(c, false)).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** What the check step shows: counts, the ready rows, and each problem row. Shared by validate and import. */
export function checkReport(p: PreparedImport) {
  return {
    fileName: p.fileName,
    total: p.checked.length,
    ready: p.ready.length,
    needFix: p.problems.length,
    duplicates: p.duplicates.length,
    note: p.sheet.note,
    readyRows: p.ready.map((r) => ({ row: r.row, ...r.summary, ...(p.advances.has(r.row) && { advancesOrderId: p.advances.get(r.row) }) })),
    duplicateRows: p.duplicates,
    problems: p.problems.map((r) => ({ row: r.row, problems: r.problems, values: r.summary })),
    problemsCsv: p.problems.length ? problemsCsv(p.sheet.headers, p.problems) : null,
  };
}
