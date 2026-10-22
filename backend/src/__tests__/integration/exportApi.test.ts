/**
 * M3-T15 (COD-23): GET /api/orders/export and GET /api/customers/export (F-320, F-361).
 * Row counts on the numbers fixture (October 2026, 1,445 orders) against the list endpoints; streaming, cap,
 * phone as text, formula escape, permission, row scope and two-tenant checks.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { seedFixture } from '../fixtures/numbersFixture';
import { createTenant, createTwoTenants, deleteTenantRows, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import orderService from '../../services/orderService';
import { BULK_ORDER_CONFIG } from '../../config/bulkOrderConfig';

// The 5-per-5-minutes limiter is proven in exportRateLimit.test.ts; here it would stop the suite
jest.mock('../../middleware/bulkRateLimiter', () => ({
  bulkOrderRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  bulkImportRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.setTimeout(180_000);

const OCTOBER = { startDate: '2026-10-01', endDate: '2026-10-31' };
const SUFFIX = Date.now();
const ORDER_HEADERS = [
  'Order number', 'External order ID', 'Date', 'Customer', 'Phone', 'Alternate phone', 'State', 'Town', 'Address', 'Products',
  'Quantity', 'Status', 'Call rep', 'Delivery agent', 'Subtotal', 'Discount', 'Total', 'Payment method', 'Payment status',
  'Delivery date', 'Decline or failure reason', 'Source',
];

let fixtureTenantId: string;
const tokens = {} as Record<'admin' | 'adwoa', string>;
let pair: TwoTenants;
let bigTenantId: string;
let bigToken: string;
let managerToken: string;

const binary = (res: any, done: (err: Error | null, body?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};
const get = (path: string, token: string, query: Record<string, unknown> = {}) =>
  request(app).get(path).query(query).set(bearer(token)).buffer(true).parse(binary);
const csvRows = (res: { body: Buffer }): string[][] => parse(res.body.toString('utf8').replace(/^﻿/, ''), { skip_empty_lines: true });
const sheetRows = async (res: { body: Buffer }) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  return wb.worksheets[0];
};

async function tokenFor(email: string) {
  const u = await prismaBase.user.findFirstOrThrow({ where: { tenantId: fixtureTenantId, email } });
  return generateAccessToken({ id: u.id, email: u.email, role: u.role, tenantId: fixtureTenantId });
}

beforeAll(async () => {
  fixtureTenantId = (await seedFixture(prismaBase)).tenantId;
  const domain = 'fixture-numbers.test';
  tokens.admin = await tokenFor(`fixture-admin@${domain}`);
  tokens.adwoa = await tokenFor(`rep-adwoa@${domain}`);
  pair = await createTwoTenants('export');

  // A tenant with 2,500 small orders (streaming in 3 batches) and one customer whose name is a formula
  const tenant = await createTenant('Export Big');
  bigTenantId = tenant.id;
  const owner = await prismaBase.user.create({
    data: { email: `export-owner-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Owner', lastName: 'Big', role: 'super_admin', tenantId: bigTenantId },
  });
  bigToken = generateAccessToken({ id: owner.id, email: owner.email, role: 'super_admin', tenantId: bigTenantId });
  const manager = await prismaBase.user.create({
    data: { email: `export-manager-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Man', lastName: 'Ager', role: 'manager', tenantId: bigTenantId },
  });
  managerToken = generateAccessToken({ id: manager.id, email: manager.email, role: 'manager', tenantId: bigTenantId });
  const customer = await prismaBase.customer.create({
    data: { firstName: '=HYPERLINK("x")', lastName: 'Evil', phoneNumber: '+233245550103', alternatePhone: '+233200000007', address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId: bigTenantId },
  });
  await prismaBase.order.createMany({
    data: Array.from({ length: 2500 }, () => ({
      customerId: customer.id, status: 'pending_confirmation' as const, subtotal: 10, totalAmount: 10, codAmount: 10, tenantId: bigTenantId,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
    })),
  });
}, 180_000);

afterAll(async () => {
  await pair.cleanup();
  await deleteTenantRows([bigTenantId]);
  await prismaBase.$disconnect();
});

afterEach(() => {
  jest.restoreAllMocks();
  BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS = 50000;
});

describe('GET /api/orders/export', () => {
  it('CSV of the October fixture has every row the list shows (1,445), the F-320 columns and a dated file name', async () => {
    const list = await request(app).get('/api/orders').query({ ...OCTOBER, limit: 1 }).set(bearer(tokens.admin));
    expect(list.body.pagination.total).toBe(1445);

    const res = await get('/api/orders/export', tokens.admin, { ...OCTOBER, format: 'csv' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/filename="orders-\d{4}-\d{2}-\d{2}\.csv"/);
    const rows = csvRows(res);
    expect(rows[0]).toEqual(ORDER_HEADERS);
    expect(rows.length - 1).toBe(list.body.pagination.total);
  });

  it('follows the list filters: a status filter gives the same count as the list', async () => {
    const filters = { ...OCTOBER, status: 'delivered' };
    const list = await request(app).get('/api/orders').query({ ...filters, limit: 1 }).set(bearer(tokens.admin));
    const res = await get('/api/orders/export', tokens.admin, filters);
    expect(list.body.pagination.total).toBeGreaterThan(0);
    expect(csvRows(res).length - 1).toBe(list.body.pagination.total);
    expect(new Set(csvRows(res).slice(1).map((r) => r[11]))).toEqual(new Set(['delivered']));

    const bad = await get('/api/orders/export', tokens.admin, { ...OCTOBER, format: 'pdf' });
    expect(bad.status).toBe(400);
  });

  it('XLSX has the same rows; phones are text with the leading 0, money is a number', async () => {
    const res = await get('/api/orders/export', tokens.admin, { ...OCTOBER, format: 'xlsx' });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/orders-\d{4}-\d{2}-\d{2}\.xlsx/);
    const sheet = await sheetRows(res);
    expect(sheet.rowCount - 1).toBe(1445);
    const row = sheet.getRow(2);
    const phone = row.getCell(5);
    expect(phone.type).toBe(ExcelJS.ValueType.String);
    expect(String(phone.value)).toMatch(/^0\d{2} \d{3} \d{4}$/);
    expect(typeof row.getCell(17).value).toBe('number');
  });

  it('is streamed: chunked, no content length, read in batches of at most 1,000 rows', async () => {
    const sizes: number[] = [];
    const original = orderService.exportBatches.bind(orderService);
    jest.spyOn(orderService, 'exportBatches').mockImplementation(async function* (...args: Parameters<typeof original>) {
      for await (const batch of original(...args)) { sizes.push(batch.length); yield batch; }
    });
    const res = await get('/api/orders/export', bigToken, {});
    expect(res.status).toBe(200);
    expect(res.headers['transfer-encoding']).toBe('chunked');
    expect(res.headers['content-length']).toBeUndefined();
    expect(sizes).toEqual([1000, 1000, 500]);
    expect(csvRows(res).length - 1).toBe(2500);
  });

  it('XLSX is streamed too, and phones keep the leading 0 in the file', async () => {
    const res = await get('/api/orders/export', bigToken, { format: 'xlsx' });
    expect(res.headers['content-length']).toBeUndefined();
    const sheet = await sheetRows(res);
    expect(sheet.rowCount - 1).toBe(2500);
    expect(String(sheet.getRow(2).getCell(5).value)).toBe('024 555 0103');
  });

  it('writes a cell that starts with = as text', async () => {
    const res = await get('/api/orders/export', bigToken, {});
    const row = csvRows(res)[1];
    expect(row[3]).toBe(`'=HYPERLINK("x") Evil`);
  });

  it('over the cap returns 400 "Narrow the date range." and sends no file', async () => {
    BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS = 2000;
    const res = await request(app).get('/api/orders/export').set(bearer(bigToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Narrow the date range.');
    expect(res.body.code).toBe('EXPORT_TOO_LARGE');
    // exactly at the cap is fine
    BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS = 2500;
    expect((await get('/api/orders/export', bigToken, {})).status).toBe(200);
  });

  it('a rep exports own orders only', async () => {
    const list = await request(app).get('/api/orders').query({ ...OCTOBER, limit: 1 }).set(bearer(tokens.adwoa));
    const res = await get('/api/orders/export', tokens.adwoa, OCTOBER);
    expect(res.status).toBe(200);
    expect(csvRows(res).length - 1).toBe(list.body.pagination.total);
    expect(list.body.pagination.total).toBeLessThan(1445);
  });

  it('401 with no token', async () => {
    expect((await request(app).get('/api/orders/export')).status).toBe(401);
  });

  it('two tenants: tenant A sees only its own order, never tenant B rows', async () => {
    const res = await get('/api/orders/export', pair.a.users.admin.token, {});
    const text = res.body.toString('utf8');
    const rows = csvRows(res);
    expect(rows.length - 1).toBe(1);
    expect(rows[1][0]).toBe(String(pair.a.ids.order));
    expect(text).not.toContain(pair.b.marker);
    const other = await get('/api/orders/export', pair.b.users.admin.token, {});
    expect(other.body.toString('utf8')).not.toContain(pair.a.marker);
  });
});

describe('GET /api/customers/export', () => {
  it('CSV has every customer the list shows, with the F-361 columns', async () => {
    const list = await request(app).get('/api/customers').query({ limit: 1 }).set(bearer(tokens.admin));
    const res = await get('/api/customers/export', tokens.admin, {});
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/customers-\d{4}-\d{2}-\d{2}\.csv/);
    const rows = csvRows(res);
    expect(rows[0]).toEqual([
      'Name', 'Phone', 'Alternate phone', 'Email', 'State', 'Town', 'Orders', 'Delivered', 'Refused', 'Delivered value',
      'Last order', 'SMS opt-out', 'WhatsApp opt-out', 'Email opt-out',
    ]);
    expect(list.body.pagination.total).toBeGreaterThan(100);
    expect(rows.length - 1).toBe(list.body.pagination.total);
  });

  it('follows search and area like the list; opted-out customers are in, flagged', async () => {
    const area = 'Accra';
    const list = await request(app).get('/api/customers').query({ area, limit: 1 }).set(bearer(bigToken));
    const res = await get('/api/customers/export', bigToken, { area });
    expect(csvRows(res).length - 1).toBe(list.body.pagination.total);

    await prismaBase.customer.updateMany({ where: { tenantId: bigTenantId }, data: { whatsappOptOut: true } });
    const flagged = csvRows(await get('/api/customers/export', bigToken, { search: 'Evil' }));
    expect(flagged).toHaveLength(2);
    expect(flagged[1].slice(1, 3)).toEqual(['024 555 0103', '020 000 0007']);
    expect(flagged[1].slice(11)).toEqual(['No', 'Yes', 'No']);
    expect(flagged[1][0]).toBe(`'=HYPERLINK("x") Evil`);
  });

  it('XLSX keeps phones as text and streams', async () => {
    const res = await get('/api/customers/export', bigToken, { format: 'xlsx' });
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBeUndefined();
    const sheet = await sheetRows(res);
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(2).getCell(2).type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getRow(2).getCell(2).value).toBe('024 555 0103');
  });

  it('owner, admin and manager can export; a call rep and a delivery agent get 403', async () => {
    expect((await get('/api/customers/export', bigToken, {})).status).toBe(200);
    expect((await get('/api/customers/export', managerToken, {})).status).toBe(200);
    expect((await get('/api/customers/export', pair.a.users.admin.token, {})).status).toBe(200);
    expect((await get('/api/customers/export', pair.a.users.salesRep.token, {})).status).toBe(403);
    expect((await get('/api/customers/export', pair.a.users.deliveryAgent.token, {})).status).toBe(403);
    expect((await get('/api/customers/export', tokens.adwoa, {})).status).toBe(403);
  });

  it('over the cap returns 400 "Narrow the date range."', async () => {
    BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS = 0;
    const res = await request(app).get('/api/customers/export').set(bearer(bigToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Narrow the date range.');
  });

  it('two tenants: tenant A sees only its own customer, never tenant B rows', async () => {
    const res = await get('/api/customers/export', pair.a.users.admin.token, {});
    const text = res.body.toString('utf8');
    expect(csvRows(res).length - 1).toBe(1);
    expect(text).toContain(`Cust${pair.a.marker}`);
    expect(text).not.toContain(pair.b.marker);
    expect((await get('/api/customers/export', pair.b.users.admin.token, {})).body.toString('utf8')).not.toContain(pair.a.marker);
  });
});
