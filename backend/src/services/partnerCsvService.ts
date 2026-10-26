/**
 * CSV connector for delivery partners (M5-T17; F-712): preview and apply a partner's status list.
 *
 * Preview reads the file and the orders and writes nothing. Apply takes the same file with the hash the preview returned
 * (a changed file is refused), classifies the rows again against the orders as they are now, and applies only the rows
 * that would change an order, each through the order status service, so fees, stock and the ledger follow the normal path.
 * A row for an order assigned to another partner is flagged and never applied. Applying a file twice changes nothing.
 */
import { createHash } from 'crypto';
import { FailureReason, OrderStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Requester } from '../utils/authUtils';
import { resolveTenantId } from '../utils/tenantContext';
import { looksLikePhone, phoneLookupVariants } from '../utils/phone';
import { formatOrderNumber } from '../utils/orderNumber';
import * as Money from '../utils/money';
import { CsvFileError, CsvRow, CsvStatus, parsePartnerCsv } from '../utils/partnerCsv';
import { actorOf, allowedTransitions } from './orderStateMachine';
import orderService from './orderService';
import { auditService } from './auditService';
import { loadPartner } from './deliveryPartnerAdminService';
import { parseOrderNumber } from './settlementMatching';

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

type OrderRow = {
  id: number; status: OrderStatus; deliveryAgentId: number | null; orderType: string | null; customerRepId: number | null;
  externalOrderId: string | null; codAmount: Money.MoneyInput | null; totalAmount: Money.MoneyInput; customer: { phoneNumber: string } | null;
};

const hashOf = (csv: string) => createHash('sha256').update(csv).digest('hex');

function readFile(csv: unknown): CsvRow[] {
  if (typeof csv !== 'string' || csv.trim() === '') throw new AppError('Send the file text as "csv"', 400, 'CSV_REQUIRED');
  try {
    return parsePartnerCsv(csv);
  } catch (error) {
    if (error instanceof CsvFileError) throw new AppError(error.message, error.code === 'FILE_TOO_LARGE' ? 413 : 400, error.code);
    throw error;
  }
}

/** The orders the rows may point at, in one query. */
async function loadOrders(rows: CsvRow[]): Promise<OrderRow[]> {
  const ids = new Set<number>();
  const externals = new Set<string>();
  const variants = new Set<string>();
  for (const row of rows) {
    if (row.orderRef) {
      const n = parseOrderNumber(row.orderRef);
      if (n !== null) ids.add(n); else externals.add(row.orderRef);
    } else if (row.phone && looksLikePhone(row.phone)) {
      phoneLookupVariants(row.phone).forEach((v) => variants.add(v));
    }
  }
  if (!ids.size && !externals.size && !variants.size) return [];
  return prisma.order.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(ids.size ? [{ id: { in: [...ids] } }] : []),
        ...(externals.size ? [{ externalOrderId: { in: [...externals] } }] : []),
        ...(variants.size ? [{ status: { in: REPORTABLE }, customer: { phoneNumber: { in: [...variants] } } }] : []),
      ],
    },
    select: {
      id: true, status: true, deliveryAgentId: true, orderType: true, customerRepId: true, externalOrderId: true,
      codAmount: true, totalAmount: true, customer: { select: { phoneNumber: true } },
    },
  });
}

/** The one order a row names, or why there is none. A phone needs exactly one of the partner's orders. */
function findOrder(row: CsvRow, orders: OrderRow[], partnerId: number): { order: OrderRow } | { error: string; flag?: boolean } {
  if (row.orderRef) {
    const n = parseOrderNumber(row.orderRef);
    const hits = n !== null ? orders.filter((o) => o.id === n) : orders.filter((o) => o.externalOrderId === row.orderRef);
    const mine = hits.filter((o) => o.deliveryAgentId === partnerId);
    if (mine.length === 1) return { order: mine[0] };
    if (mine.length > 1) return { error: `More than one order has the reference ${row.orderRef}` };
    if (hits.length > 0) return { error: 'This order is assigned to another delivery partner', flag: true };
    return { error: `Order ${row.orderRef} was not found` };
  }
  const variants = new Set(looksLikePhone(row.phone ?? '') ? phoneLookupVariants(row.phone!) : []);
  const hits = orders.filter((o) => o.customer && variants.has(o.customer.phoneNumber) && REPORTABLE.includes(o.status));
  const mine = hits.filter((o) => o.deliveryAgentId === partnerId);
  if (mine.length === 1) return { order: mine[0] };
  if (mine.length > 1) return { error: `More than one order of this partner has the phone ${row.phone}` };
  if (hits.length > 0) return { error: 'This order is assigned to another delivery partner', flag: true };
  return { error: `No order found for the phone ${row.phone}` };
}

function classify(rows: CsvRow[], orders: OrderRow[], partnerId: number, requester: Requester): Array<CsvRowReport & { target: OrderRow | null }> {
  const actor = actorOf(requester);
  const lineOfOrder = new Map<number, number>();
  return rows.map((row) => {
    const base = { line: row.line, orderId: null as number | null, orderRef: row.orderRef, phone: row.phone, status: row.status, date: row.date, currentStatus: null as OrderStatus | null, warnings: [] as string[], target: null as OrderRow | null };
    const done = (result: CsvRowResult, message: string | null, extra: Partial<typeof base> = {}) => ({ ...base, ...extra, result, message });

    if (row.errors.length > 0) return done('rejected', row.errors.join('; '));
    const found = findOrder(row, orders, partnerId);
    if ('error' in found) return done(found.flag ? 'flagged' : 'rejected', found.error);

    const order = found.order;
    const target = row.status as OrderStatus;
    const matched = { orderId: order.id, currentStatus: order.status, target: order };
    const earlier = lineOfOrder.get(order.id);
    if (earlier !== undefined) return done('rejected', `${formatOrderNumber(order.id)} is also on line ${earlier}`, matched);
    lineOfOrder.set(order.id, row.line);

    const warnings: string[] = [];
    const gross = Money.parse(order.codAmount ?? order.totalAmount);
    if (row.status === 'delivered' && row.cash && !row.cash.eq(gross)) warnings.push(`Cash collected ${Money.toApi(row.cash)} differs from the order amount ${Money.toApi(gross)}`);
    if (order.status === target) return done('unchanged', 'Already in this status', { ...matched, warnings });
    if (!allowedTransitions({ ...order, status: order.status }, actor).normal.includes(target)) {
      return done('rejected', `${formatOrderNumber(order.id)} is ${order.status.replace(/_/g, ' ')} and cannot move to ${target.replace(/_/g, ' ')}`, { ...matched, warnings });
    }
    return done('changed', null, { ...matched, warnings });
  });
}

const strip = ({ target: _target, ...report }: CsvRowReport & { target: OrderRow | null }): CsvRowReport => report;

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
  const reports = classify(rows, await loadOrders(rows), partnerId, requester).map(strip);
  return { fileHash: hashOf(csv as string), totals: totalsOf(reports), rows: reports };
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
  /** The rows that were not applied because they failed, as a CSV the person can download. */
  failuresCsv: string;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Apply the rows of a previewed file that change an order. `fileHash` must be the one the preview returned for this
 * text. Rows are classified again now, so an order that moved since the preview is skipped. One failing row does not stop
 * the others; it is listed with its reason.
 */
export async function applyPartnerCsv(requester: Requester, partnerId: number, csv: unknown, fileHash: unknown): Promise<CsvApplyReport> {
  await loadPartner(partnerId);
  const rows = readFile(csv);
  if (typeof fileHash !== 'string' || fileHash !== hashOf(csv as string)) {
    throw new AppError('This file was not previewed, or it changed after the preview. Preview it again before applying.', 409, 'CSV_NOT_PREVIEWED');
  }

  const classified = classify(rows, await loadOrders(rows), partnerId, requester);
  const applied: CsvRowReport[] = [];
  const skipped: CsvRowReport[] = [];
  const failed: Array<CsvRowReport & { error: string }> = [];
  const byLine = new Map(rows.map((r) => [r.line, r]));

  for (const item of classified) {
    const report = strip(item);
    if (item.result !== 'changed') { skipped.push(report); continue; }
    const row = byLine.get(item.line)!;
    try {
      await orderService.updateOrderStatus(item.orderId!, {
        status: row.status as OrderStatus,
        notes: row.reason ? `Partner file: ${row.reason}` : 'Status from the partner file',
        deliveryDate: row.status === 'delivered' && row.date ? new Date(`${row.date}T00:00:00.000Z`) : undefined,
        failureReason: row.status === 'failed_delivery' ? failureReasonOf(row.reason) : undefined,
      }, requester);
      applied.push(report);
    } catch (error) {
      failed.push({ ...report, error: error instanceof AppError ? error.message : 'The order could not be updated' });
    }
  }

  const failuresCsv = ['line,order,phone,status,error', ...[...skipped.filter((r) => r.result === 'rejected' || r.result === 'flagged').map((r) => ({ ...r, error: r.message })), ...failed]
    .sort((a, b) => a.line - b.line)
    .map((r) => [r.line, r.orderRef ?? r.orderId, r.phone, r.status, r.error].map(csvCell).join(','))].join('\n');

  await auditService.record({
    tenantId: resolveTenantId(), actorId: requester.id, actorKind: 'person', channel: 'app',
    action: 'csv_apply', resource: 'delivery_partner', resourceId: String(partnerId),
    metadata: { fileHash, rows: rows.length, applied: applied.length, skipped: skipped.length, failed: failed.length },
  });
  return { totals: { rows: rows.length, applied: applied.length, skipped: skipped.length, failed: failed.length }, applied, skipped, failed, failuresCsv };
}
