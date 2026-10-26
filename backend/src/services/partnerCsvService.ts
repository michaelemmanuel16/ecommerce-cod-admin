/**
 * CSV connector for delivery partners (M5-T17; F-712): preview and apply a partner's status list.
 *
 * Preview reads the file and the orders and writes nothing. Apply takes the same file with the hash the preview returned
 * (a changed file is refused), classifies the rows again against the orders as they are now, and applies only the rows
 * that would change an order, each through the order status service, so fees, stock and the ledger follow the normal path.
 * A row for an order assigned to another partner is flagged and never applied. Applying a file twice changes nothing.
 */
import { FailureReason, OrderStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Requester } from '../utils/authUtils';
import { resolveTenantId } from '../utils/tenantContext';
import { looksLikePhone, phoneLookupVariants } from '../utils/phone';
import { formatOrderNumber, parseOrderNumber } from '../utils/orderNumber';
import { LookupOrder, loadOrdersByRefs, moreThanOneOrder, OTHER_PARTNER_NOTE } from '../utils/orderLookup';
import { sha256Hex } from '../utils/crypto';
import * as Money from '../utils/money';
import { CsvFileError, CsvRow, CsvStatus, parsePartnerCsv } from '../utils/partnerCsv';
import { actorOf, allowedTransitions } from './orderStateMachine';
import orderService from './orderService';
import { auditService } from './auditService';
import { loadPartner } from './deliveryPartnerAdminService';
import { csvCell } from './exportStream';
import { utcDateOfYmd } from './kpi/dates';

export type CsvRowResult = 'changed' | 'unchanged' | 'flagged' | 'rejected';

export interface CsvRowReport {
  line: number;
  orderId: number | null;
  orderRef: string | null;
  phone: string | null;
  status: CsvStatus | null;
  date: string | null;
  result: CsvRowResult;
  /** The order's status now, when the row matched an order. */
  currentStatus: OrderStatus | null;
  message: string | null;
  warnings: string[];
}

export interface CsvPreview {
  fileHash: string;
  totals: { rows: number; matched: number; changed: number; unchanged: number; flagged: number; rejected: number };
  rows: CsvRowReport[];
}

/** Statuses a phone lookup may match: an order a partner reports on. */
const REPORTABLE: OrderStatus[] = ['out_for_delivery', 'failed_delivery', 'delivered', 'returned'];

function readFile(csv: unknown): CsvRow[] {
  if (typeof csv !== 'string' || csv.trim() === '') throw new AppError('Send the file text as "csv"', 400, 'CSV_REQUIRED');
  try {
    return parsePartnerCsv(csv);
  } catch (error) {
    if (error instanceof CsvFileError) throw new AppError(error.message, error.code === 'FILE_TOO_LARGE' ? 413 : 400, error.code);
    throw error;
  }
}

/** The orders the rows may point at, in one query: by order number, by external id, or (a row with no reference) by phone. */
function loadOrders(rows: CsvRow[]): Promise<LookupOrder[]> {
  const ids: number[] = [];
  const externalIds: string[] = [];
  const phones: string[] = [];
  for (const row of rows) {
    if (row.orderRef) {
      const n = parseOrderNumber(row.orderRef);
      if (n !== null) ids.push(n); else externalIds.push(row.orderRef);
    } else if (row.phone) {
      phones.push(row.phone);
    }
  }
  return loadOrdersByRefs(prisma, { ids, externalIds, phones }, { phoneStatuses: REPORTABLE });
}

/** The one order a row names, or why there is none. A phone needs exactly one of the partner's orders. */
function findOrder(row: CsvRow, orders: LookupOrder[], partnerId: number): { order: LookupOrder } | { error: string; flag?: boolean } {
  if (row.orderRef) {
    const n = parseOrderNumber(row.orderRef);
    const hits = n !== null ? orders.filter((o) => o.id === n) : orders.filter((o) => o.externalOrderId === row.orderRef);
    const mine = hits.filter((o) => o.deliveryAgentId === partnerId);
    if (mine.length === 1) return { order: mine[0] };
    if (mine.length > 1) return { error: moreThanOneOrder(`the reference ${row.orderRef}`) };
    if (hits.length > 0) return { error: OTHER_PARTNER_NOTE, flag: true };
    return { error: `Order ${row.orderRef} was not found` };
  }
  const variants = new Set(looksLikePhone(row.phone ?? '') ? phoneLookupVariants(row.phone!) : []);
  const hits = orders.filter((o) => o.customer && variants.has(o.customer.phoneNumber) && REPORTABLE.includes(o.status));
  const mine = hits.filter((o) => o.deliveryAgentId === partnerId);
  if (mine.length === 1) return { order: mine[0] };
  if (mine.length > 1) return { error: moreThanOneOrder(`the phone ${row.phone} (of this partner)`) };
  if (hits.length > 0) return { error: OTHER_PARTNER_NOTE, flag: true };
  return { error: `No order found for the phone ${row.phone}` };
}

function classify(rows: CsvRow[], orders: LookupOrder[], partnerId: number, requester: Requester): CsvRowReport[] {
  const actor = actorOf(requester);
  const lineOfOrder = new Map<number, number>();
  return rows.map((row): CsvRowReport => {
    const base = { line: row.line, orderId: null as number | null, orderRef: row.orderRef, phone: row.phone, status: row.status, date: row.date, currentStatus: null as OrderStatus | null, warnings: [] as string[] };
    const done = (result: CsvRowResult, message: string | null, extra: Partial<CsvRowReport> = {}): CsvRowReport => ({ ...base, ...extra, result, message });

    if (row.errors.length > 0) return done('rejected', row.errors.join('; '));
    const found = findOrder(row, orders, partnerId);
    if ('error' in found) return done(found.flag ? 'flagged' : 'rejected', found.error);

    const order = found.order;
    const target = row.status as OrderStatus;
    const matched = { orderId: order.id, currentStatus: order.status };
    const earlier = lineOfOrder.get(order.id);
    if (earlier !== undefined) return done('rejected', `${formatOrderNumber(order.id)} is also on line ${earlier}`, matched);
    lineOfOrder.set(order.id, row.line);

    const warnings: string[] = [];
    const gross = Money.parse(order.codAmount ?? order.totalAmount);
    if (row.status === 'delivered' && row.cash && !row.cash.eq(gross)) warnings.push(`Cash collected ${Money.toApi(row.cash)} differs from the order amount ${Money.toApi(gross)}`);
    if (order.status === target) return done('unchanged', 'Already in this status', { ...matched, warnings });
    if (!allowedTransitions(order, actor).normal.includes(target)) {
      return done('rejected', `${formatOrderNumber(order.id)} is ${order.status.replace(/_/g, ' ')} and cannot move to ${target.replace(/_/g, ' ')}`, { ...matched, warnings });
    }
    return done('changed', null, { ...matched, warnings });
  });
}

function totalsOf(reports: CsvRowReport[]): CsvPreview['totals'] {
  const count = (r: CsvRowResult) => reports.filter((x) => x.result === r).length;
  const changed = count('changed');
  const unchanged = count('unchanged');
  return { rows: reports.length, matched: changed + unchanged, changed, unchanged, flagged: count('flagged'), rejected: count('rejected') };
}

/** Matched, changed, flagged and rejected rows of a partner's file, with no write. */
export async function previewPartnerCsv(requester: Requester, partnerId: number, csv: unknown): Promise<CsvPreview> {
  await loadPartner(partnerId);
  const rows = readFile(csv);
  const reports = classify(rows, await loadOrders(rows), partnerId, requester);
  return { fileHash: sha256Hex(csv as string), totals: totalsOf(reports), rows: reports };
}

const FAILURE_REASONS = Object.values(FailureReason) as string[];
/** "Not reachable" is `not_reachable`; any other text is `other`. */
const failureReasonOf = (text: string | null): FailureReason | undefined => {
  if (!text) return undefined;
  const key = text.trim().toLowerCase().replace(/[^a-z]+/g, '_');
  return (FAILURE_REASONS.includes(key) ? key : 'other') as FailureReason;
};

export interface CsvApplyReport {
  totals: { rows: number; applied: number; skipped: number; failed: number };
  applied: CsvRowReport[];
  skipped: CsvRowReport[];
  failed: Array<CsvRowReport & { error: string }>;
  /** The rows that were not applied because they were rejected, flagged or failed, as a CSV the person can download (BOM, CRLF, formula-safe). */
  failuresCsv: string;
}

/**
 * Apply the rows of a previewed file that change an order. `fileHash` must be the one the preview returned for this
 * text. Rows are classified again now, so an order that moved since the preview is skipped. One failing row does not stop
 * the others; it is listed with its reason.
 */
export async function applyPartnerCsv(requester: Requester, partnerId: number, csv: unknown, fileHash: unknown): Promise<CsvApplyReport> {
  // The hash first: a file that is not the previewed one is refused before anything is read
  if (typeof csv !== 'string' || typeof fileHash !== 'string' || fileHash !== sha256Hex(csv)) {
    throw new AppError('This file was not previewed, or it changed after the preview. Preview it again before applying.', 409, 'CSV_NOT_PREVIEWED');
  }
  await loadPartner(partnerId);
  const rows = readFile(csv);

  const classified = classify(rows, await loadOrders(rows), partnerId, requester);
  const applied: CsvRowReport[] = [];
  const skipped: CsvRowReport[] = [];
  const failed: Array<CsvRowReport & { error: string }> = [];
  const byLine = new Map(rows.map((r) => [r.line, r]));

  for (const report of classified) {
    if (report.result !== 'changed') { skipped.push(report); continue; }
    const row = byLine.get(report.line)!;
    try {
      await orderService.updateOrderStatus(report.orderId!, {
        status: row.status as OrderStatus,
        notes: row.reason ? `Partner file: ${row.reason}` : 'Status from the partner file',
        deliveryDate: row.status === 'delivered' && row.date ? utcDateOfYmd(row.date) : undefined,
        failureReason: row.status === 'failed_delivery' ? failureReasonOf(row.reason) : undefined,
      }, requester);
      applied.push(report);
    } catch (error) {
      failed.push({ ...report, error: error instanceof AppError ? error.message : 'The order could not be updated' });
    }
  }

  const problems = [...skipped.filter((r) => r.result === 'rejected' || r.result === 'flagged').map((r) => ({ ...r, error: r.message })), ...failed].sort((a, b) => a.line - b.line);
  const failuresCsv = `\uFEFF${['line,order,phone,status,error', ...problems.map((r) => [r.line, r.orderRef ?? r.orderId, r.phone, r.status, r.error].map((v) => csvCell(v as string | number | null, false)).join(','))].join('\r\n')}\r\n`;

  await auditService.record({
    tenantId: resolveTenantId(), actorId: requester.id, actorKind: 'person', channel: 'app',
    action: 'csv_apply', resource: 'delivery_partner', resourceId: String(partnerId),
    metadata: { fileHash, rows: rows.length, applied: applied.length, skipped: skipped.length, failed: failed.length },
  });
  return { totals: { rows: rows.length, applied: applied.length, skipped: skipped.length, failed: failed.length }, applied, skipped, failed, failuresCsv };
}
