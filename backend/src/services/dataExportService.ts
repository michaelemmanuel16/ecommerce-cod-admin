import archiver from 'archiver';
import { Readable } from 'stream';
import type { Response } from 'express';
import prisma from '../utils/prisma';
import { csvCell, exportDate, exportMoney } from './exportStream';
import { auditService } from './auditService';
import logger from '../utils/logger';

/**
 * Export my data (M3-T24, F-1225). A ZIP of CSV files, streamed to the response: nothing is stored.
 * Every person gets their own rows (profile, sessions, notifications, payouts, calls, orders they created).
 * The owner (super_admin) also gets the business tables of the tenant. The Prisma extension scopes every
 * query to the caller's tenant, and the person files also filter on the caller's id.
 */

const BATCH = 1000;

interface Column<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
  numeric?: boolean;
}

interface Table<T> {
  file: string;
  columns: Column<T>[];
  /** Keyset pages of rows, by id. */
  fetch: (afterId: number, take: number) => Promise<Array<T & { id: number }>>;
}

const cell = (v: string | number | boolean | null | undefined) => (typeof v === 'boolean' ? String(v) : v);

async function* csvLines<T>(table: Table<T>): AsyncGenerator<string> {
  yield `﻿${table.columns.map((c) => csvCell(c.header, false)).join(',')}\r\n`;
  let afterId = 0;
  for (;;) {
    const rows = await table.fetch(afterId, BATCH);
    if (rows.length === 0) return;
    yield `${rows.map((r) => table.columns.map((c) => csvCell(cell(c.value(r)), c.numeric === true)).join(',')).join('\r\n')}\r\n`;
    afterId = rows[rows.length - 1].id;
    if (rows.length < BATCH) return;
  }
}

const date = (d: Date | null | undefined) => exportDate(d);
const money = (v: any) => exportMoney(v);

function personTables(userId: number): Array<Table<any>> {
  const page = (afterId: number, take: number) => ({ orderBy: { id: 'asc' as const }, take, where: { id: { gt: afterId } } });
  return [
    {
      file: 'profile.csv',
      columns: [
        { header: 'id', value: (r) => r.id, numeric: true },
        { header: 'email', value: (r) => r.email },
        { header: 'first_name', value: (r) => r.firstName },
        { header: 'last_name', value: (r) => r.lastName },
        { header: 'display_name', value: (r) => r.displayName },
        { header: 'phone', value: (r) => r.phoneNumber },
        { header: 'role', value: (r) => r.role },
        { header: 'photo_url', value: (r) => r.photoUrl },
        { header: 'preferences', value: (r) => (r.preferences ? JSON.stringify(r.preferences) : '') },
        { header: 'member_since', value: (r) => date(r.createdAt) },
        { header: 'last_login', value: (r) => date(r.lastLogin) },
      ],
      fetch: async (afterId) => (afterId > 0 ? [] : prisma.user.findMany({
        where: { id: userId },
        select: { id: true, email: true, firstName: true, lastName: true, displayName: true, phoneNumber: true, role: true, photoUrl: true, preferences: true, createdAt: true, lastLogin: true },
      })),
    },
    {
      file: 'sessions.csv',
      columns: [
        { header: 'id', value: (r) => r.id, numeric: true },
        { header: 'device', value: (r) => r.deviceLabel },
        { header: 'ip', value: (r) => r.ip },
        { header: 'last_seen', value: (r) => date(r.lastSeenAt) },
        { header: 'signed_in', value: (r) => date(r.createdAt) },
      ],
      fetch: (afterId, take) => prisma.userSession.findMany({
        ...page(afterId, take),
        where: { userId, id: { gt: afterId } },
        select: { id: true, deviceLabel: true, ip: true, lastSeenAt: true, createdAt: true },
      }),
    },
    {
      file: 'notifications.csv',
      columns: [
        { header: 'id', value: (r) => r.id, numeric: true },
        { header: 'type', value: (r) => r.type },
        { header: 'title', value: (r) => r.title },
        { header: 'message', value: (r) => r.message },
        { header: 'read', value: (r) => r.isRead },
        { header: 'created', value: (r) => date(r.createdAt) },
      ],
      fetch: (afterId, take) => prisma.notification.findMany({ ...page(afterId, take), where: { userId, id: { gt: afterId } } }),
    },
    {
      file: 'payouts.csv',
      columns: [
        { header: 'id', value: (r) => r.id, numeric: true },
        { header: 'amount', value: (r) => money(r.amount), numeric: true },
        { header: 'method', value: (r) => r.method },
        { header: 'notes', value: (r) => r.notes },
        { header: 'payout_date', value: (r) => date(r.payoutDate) },
      ],
      fetch: (afterId, take) => prisma.payout.findMany({ ...page(afterId, take), where: { payeeId: userId, id: { gt: afterId } } }),
    },
    {
      file: 'calls.csv',
      columns: [
        { header: 'id', value: (r) => r.id, numeric: true },
        { header: 'order_id', value: (r) => r.orderId, numeric: true },
        { header: 'customer_id', value: (r) => r.customerId, numeric: true },
        { header: 'outcome', value: (r) => r.outcome },
        { header: 'notes', value: (r) => r.notes },
        { header: 'created', value: (r) => date(r.createdAt) },
      ],
      fetch: (afterId, take) => prisma.call.findMany({ ...page(afterId, take), where: { salesRepId: userId, id: { gt: afterId } } }),
    },
    {
      file: 'orders-created.csv',
      columns: orderColumns(),
      fetch: (afterId, take) => prisma.order.findMany({ ...page(afterId, take), where: { createdById: userId, id: { gt: afterId } } }),
    },
  ];
}

function orderColumns(): Column<any>[] {
  return [
    { header: 'id', value: (r) => r.id, numeric: true },
    { header: 'status', value: (r) => r.status },
    { header: 'payment_status', value: (r) => r.paymentStatus },
    { header: 'total', value: (r) => money(r.totalAmount), numeric: true },
    { header: 'currency', value: (r) => r.currency },
    { header: 'customer_id', value: (r) => r.customerId, numeric: true },
    { header: 'delivery_address', value: (r) => r.deliveryAddress },
    { header: 'delivery_state', value: (r) => r.deliveryState },
    { header: 'notes', value: (r) => r.notes },
    { header: 'created', value: (r) => date(r.createdAt) },
  ];
}

function businessTables(): Array<Table<any>> {
  const page = (afterId: number, take: number) => ({ orderBy: { id: 'asc' as const }, take, where: { id: { gt: afterId } } });
  return [
    { file: 'business/orders.csv', columns: orderColumns(), fetch: (a, t) => prisma.order.findMany(page(a, t)) },
    {
      file: 'business/customers.csv',
      columns: [
        { header: 'id', value: (r) => r.id, numeric: true },
        { header: 'first_name', value: (r) => r.firstName },
        { header: 'last_name', value: (r) => r.lastName },
        { header: 'phone', value: (r) => r.phoneNumber },
        { header: 'email', value: (r) => r.email },
        { header: 'address', value: (r) => r.address },
        { header: 'state', value: (r) => r.state },
        { header: 'area', value: (r) => r.area },
        { header: 'total_orders', value: (r) => r.totalOrders, numeric: true },
        { header: 'created', value: (r) => date(r.createdAt) },
      ],
      fetch: (a, t) => prisma.customer.findMany(page(a, t)),
    },
    {
      file: 'business/products.csv',
      columns: [
        { header: 'id', value: (r) => r.id, numeric: true },
        { header: 'sku', value: (r) => r.sku },
        { header: 'name', value: (r) => r.name },
        { header: 'category', value: (r) => r.category },
        { header: 'price', value: (r) => money(r.price), numeric: true },
        { header: 'stock', value: (r) => r.stockQuantity, numeric: true },
        { header: 'active', value: (r) => r.isActive },
      ],
      fetch: (a, t) => prisma.product.findMany(page(a, t)),
    },
    {
      file: 'business/expenses.csv',
      columns: [
        { header: 'id', value: (r) => r.id, numeric: true },
        { header: 'category', value: (r) => r.category },
        { header: 'amount', value: (r) => money(r.amount), numeric: true },
        { header: 'description', value: (r) => r.description },
        { header: 'expense_date', value: (r) => date(r.expenseDate) },
      ],
      fetch: (a, t) => prisma.expense.findMany(page(a, t)),
    },
    {
      file: 'business/journal-entries.csv',
      columns: [
        { header: 'id', value: (r) => r.id, numeric: true },
        { header: 'entry_number', value: (r) => r.entryNumber },
        { header: 'entry_date', value: (r) => date(r.entryDate) },
        { header: 'description', value: (r) => r.description },
        { header: 'source_type', value: (r) => r.sourceType },
        { header: 'voided', value: (r) => r.isVoided },
      ],
      fetch: (a, t) => prisma.journalEntry.findMany(page(a, t)),
    },
  ];
}

export const dataExportService = {
  /** Writes the audit row, then streams the ZIP. Errors before the first byte go to the caller; after it the connection is cut. */
  async stream(res: Response, user: { id: number; role: string; tenantId?: string | null }, meta: { ip?: string | null; userAgent?: string | null }) {
    const owner = user.role === 'super_admin';
    await auditService.record({
      actorId: user.id,
      channel: 'app',
      action: 'export_my_data',
      resource: 'user',
      resourceId: String(user.id),
      metadata: { scope: owner ? 'owner' : 'self' },
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    const tables = [...personTables(user.id), ...(owner ? businessTables() : [])];
    const archive = archiver('zip', { zlib: { level: 6 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.setHeader('Cache-Control', 'no-store');

    archive.on('error', (err) => {
      logger.error('Data export failed while streaming', { error: err.message });
      res.destroy(err);
    });
    archive.pipe(res);
    // Entries are read one after another, so only one batch is in memory at a time
    for (const table of tables) archive.append(Readable.from(csvLines(table)), { name: table.file });
    await archive.finalize();
  },
};
