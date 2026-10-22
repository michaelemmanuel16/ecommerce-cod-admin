/** F-319: file reading, one test per row check, the duplicate rule and the problems file. */
import { describe, it, expect } from '@jest/globals';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import {
  checkRows, CheckContext, editDistance, isDuplicateOf, isForwardStatus, matchRegion, problemsCsv, readSheet, SheetRow, SPLIT_MESSAGE,
} from '../../services/orderImportService';

const REGIONS = ['Ahafo', 'Ashanti', 'Bono', 'Greater Accra', 'Western'];
const ctx: CheckContext = {
  regions: REGIONS,
  countryName: 'Ghana',
  products: [{ id: 1, name: 'Copybook Set', sku: 'MG-01' }, { id: 2, name: 'Pen Pack', sku: 'PEN-1' }, { id: 3, name: 'Pen Refill', sku: 'PEN-2' }],
  reps: [{ id: 10, name: 'Adwoa Darko' }],
  agents: [{ id: 20, name: 'Kofi Mensah' }],
};
const good = {
  customer_name: 'Ama Mensah', phone: '0245550103', address: '12 Oak Street', region: 'Ashanti', product: 'Copybook Set',
  quantity: '2', price: '50', status: 'confirmed',
};
const check = (over: Record<string, string> = {}) => {
  const rows: SheetRow[] = [{ row: 2, cells: { ...good, ...over } }];
  return checkRows(rows, ctx)[0];
};
const problem = (over: Record<string, string>) => check(over).problems;

describe('checkRows', () => {
  it('a good row is ready and maps to import data', () => {
    const r = check();
    expect(r.problems).toEqual([]);
    expect(r.data).toMatchObject({
      customerFirstName: 'Ama', customerLastName: 'Mensah', deliveryState: 'Ashanti', productId: 1, quantity: 2, status: 'confirmed', sourceRow: 2,
    });
    expect(r.data!.totalAmount.toString()).toBe('100');
  });

  it('phone: 9 to 15 digits, with or without the leading 0', () => {
    expect(problem({ phone: '245550103' })).toEqual([]);
    expect(problem({ phone: '+233 24 555 0103' })).toEqual([]);
    expect(problem({ phone: '12345678' })).toEqual(['Phone must have 9 to 15 digits']);
    expect(problem({ phone: '1234567890123456' })).toEqual(['Phone must have 9 to 15 digits']);
    expect(problem({ phone: '' })).toEqual(['Phone is missing']);
  });

  it('region: exact match is accepted, "Region" suffix and case ignored', () => {
    expect(check({ region: 'ashanti region' }).data!.deliveryState).toBe('Ashanti');
    expect(check({ region: 'GREATER ACCRA' }).data!.deliveryState).toBe('Greater Accra');
  });

  it('region: a near match shows "Did you mean Ashanti?" and is not auto-fixed', () => {
    const r = check({ region: 'Ashante' });
    expect(r.problems).toEqual(['State "Ashante" is not in the list. Did you mean Ashanti?']);
    expect(r.data).toBeUndefined();
  });

  it('region: no near match, and missing', () => {
    expect(problem({ region: 'Lagos' })).toEqual(['State "Lagos" is not one of Ghana\'s states']);
    expect(problem({ region: '' })).toEqual(['State is missing']);
  });

  it('product: name or SKU, case-insensitive; unknown and ambiguous are problems', () => {
    expect(check({ product: 'mg-01' }).data!.productId).toBe(1);
    expect(check({ product: 'copybook' }).data!.productId).toBe(1);
    expect(problem({ product: 'Keyboard' })).toEqual(['Product "Keyboard" was not found']);
    expect(problem({ product: 'Pen' })).toEqual(['Product "Pen" matches more than one product. Use the SKU']);
    expect(problem({ product: '' })).toEqual(['Product is missing']);
  });

  it('quantity: a whole number above 0', () => {
    for (const q of ['0', '1.5', 'two', '-1', '']) expect(problem({ quantity: q })).toEqual(['Quantity must be a whole number above 0']);
  });

  it('price: a number; thousands commas and a currency sign are read', () => {
    expect(check({ price: 'GH₵ 1,200.50' }).data!.unitPrice.toString()).toBe('1200.5');
    expect(problem({ price: 'abc' })).toEqual(['Price must be a number above 0']);
    expect(problem({ price: '0' })).toEqual(['Price must be a number above 0']);
    expect(problem({ price: '' })).toEqual(['Price is missing']);
  });

  it('price: an older file with only a total amount column works', () => {
    const r = check({ price: '', 'total amount': '120' });
    expect(r.data!.totalAmount.toString()).toBe('120');
    expect(r.data!.unitPrice.toString()).toBe('60');
  });

  it('status: blank is pending_confirmation; payment_pending, payment_failed and digital_delivered are rejected', () => {
    expect(check({ status: '' }).data!.status).toBe('pending_confirmation');
    expect(check({ status: 'Out For Delivery' }).data!.status).toBe('out_for_delivery');
    for (const s of ['payment_pending', 'payment_failed', 'digital_delivered']) expect(problem({ status: s })).toEqual([`Status ${s} cannot be imported`]);
    expect(problem({ status: 'shipped' })).toEqual(['Status "shipped" is not recognised']);
    for (const s of ['cancelled', 'delivered', 'returned', 'failed_delivery']) expect(problem({ status: s })).toEqual([]);
  });

  it('date: dd/mm/yyyy is the row date; a future or malformed date is a problem', () => {
    expect(check({ date: '03/10/2026' }).data!.orderDate).toEqual(new Date(2026, 9, 3));
    expect(check({ date: '2026-10-03' }).data!.orderDate).toEqual(new Date(2026, 9, 3));
    expect(problem({ date: '31/02/2026' })).toEqual(['Date must be dd/mm/yyyy and not in the future']);
    expect(problem({ date: '01/01/2999' })).toEqual(['Date must be dd/mm/yyyy and not in the future']);
  });

  it('rep and agent names map to users; an unknown name is a row problem', () => {
    const r = check({ 'assigned rep': 'adwoa darko', 'delivery agent': 'Kofi Mensah' });
    expect(r.data).toMatchObject({ assignedRepName: 'adwoa darko', assignedAgentName: 'Kofi Mensah' });
    expect(problem({ 'assigned rep': 'Nobody Here' })).toEqual(['Call rep "Nobody Here" was not found']);
    expect(problem({ 'delivery agent': 'Nobody Here' })).toEqual(['Delivery agent "Nobody Here" was not found']);
  });

  it('address: missing and too short', () => {
    expect(problem({ address: '' })).toEqual(['Address is missing']);
    expect(problem({ address: 'abc' })).toEqual(['Address is too short']);
  });

  it('a row with several problems lists them all', () => {
    expect(problem({ phone: '1', quantity: '0', region: 'Ashante' })).toHaveLength(3);
  });
});

describe('matchRegion and editDistance', () => {
  it('edit distance', () => {
    expect(editDistance('ashante', 'ashanti')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });
  it('no region list: any non-empty region passes', () => {
    expect(matchRegion('Anywhere', [], 'x')).toEqual({ region: 'Anywhere' });
  });
});

describe('duplicate rule', () => {
  const at = new Date('2026-10-20T12:00:00Z');
  const existing = (over: Record<string, unknown> = {}) => ({
    id: 1, status: 'pending_confirmation' as const, deliveryAddress: '12 Oak Street', totalAmount: new Prisma.Decimal(100),
    createdAt: new Date('2026-10-20T00:00:00Z'), deletedAt: null, ...over,
  });
  const row = { deliveryAddress: '12 oak street.', totalAmount: new Prisma.Decimal(100) };

  it('same address and amount within 24 hours', () => {
    expect(isDuplicateOf(existing(), row, at)).toBe(true);
    expect(isDuplicateOf(existing({ createdAt: new Date('2026-10-19T13:00:00Z') }), row, at)).toBe(true);
  });
  it('not a duplicate after 24 hours, with another amount or another address', () => {
    expect(isDuplicateOf(existing({ createdAt: new Date('2026-10-19T11:00:00Z') }), row, at)).toBe(false);
    expect(isDuplicateOf(existing({ totalAmount: new Prisma.Decimal(101) }), row, at)).toBe(false);
    expect(isDuplicateOf(existing({ deliveryAddress: '5 Elm Road' }), row, at)).toBe(false);
  });
  it('an order deleted a while ago does not count', () => {
    expect(isDuplicateOf(existing({ deletedAt: new Date(Date.now() - 3_600_000) }), row, at)).toBe(false);
  });
  it('a later status moves the existing order forward', () => {
    expect(isForwardStatus('pending_confirmation', 'delivered')).toBe(true);
    expect(isForwardStatus('delivered', 'confirmed')).toBe(false);
    expect(isForwardStatus('confirmed', 'cancelled')).toBe(false);
  });
});

describe('readSheet', () => {
  const csv = (text: string) => ({ originalname: 'orders.csv', buffer: Buffer.from(text) });

  it('reads a CSV with a BOM and gives row numbers from 2', async () => {
    const sheet = await readSheet(csv('﻿phone,product\n0245550103,Pen\n0245550104,Pen\n'));
    expect(sheet.headers).toEqual(['phone', 'product']);
    expect(sheet.rows.map((r) => r.row)).toEqual([2, 3]);
  });

  it('reads semicolon separators and skips blank rows', async () => {
    const sheet = await readSheet(csv('phone;product\n0245550103;Pen\n;\n0245550104;Pen\n'));
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[1].cells).toEqual({ phone: '0245550104', product: 'Pen' });
  });

  it('2,000 rows pass; 2,001 rows return the split message', async () => {
    const body = (n: number) => `phone\n${Array.from({ length: n }, (_, i) => `02455${String(i).padStart(5, '0')}`).join('\n')}\n`;
    expect((await readSheet(csv(body(2000)))).rows).toHaveLength(2000);
    await expect(readSheet(csv(body(2001)))).rejects.toThrow(SPLIT_MESSAGE);
  });

  it('reads only the first sheet of an XLSX and says so', async () => {
    const wb = new ExcelJS.Workbook();
    const first = wb.addWorksheet('Orders');
    first.addRow(['phone', 'quantity']);
    first.addRow(['0245550103', 2]);
    wb.addWorksheet('Old').addRow(['x']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const sheet = await readSheet({ originalname: 'orders.xlsx', buffer });
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0].cells).toEqual({ phone: '0245550103', quantity: '2' });
    expect(sheet.note).toContain('first sheet');
  });

  it('refuses an unsupported extension', async () => {
    await expect(readSheet({ originalname: 'orders.txt', buffer: Buffer.from('x') })).rejects.toThrow('Unsupported file format');
  });
});

describe('problemsCsv', () => {
  it('keeps the file columns and adds a problem column; formulas become text', () => {
    const text = problemsCsv(['phone', 'address'], [{ cells: { phone: '123', address: '=SUM(A1)' }, problems: ['Phone must have 9 to 15 digits', 'State is missing'] }]);
    expect(text.replace(/^﻿/, '').split('\r\n')).toEqual([
      'phone,address,problem',
      "123,'=SUM(A1),Phone must have 9 to 15 digits; State is missing",
      '',
    ]);
  });
});
