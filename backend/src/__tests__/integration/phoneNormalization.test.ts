/**
 * M1-T05 (COD-9): every customer write path stores the normalized phone (E.164), and every lookup
 * finds a customer stored in the normalized or an old format. Unparseable input is kept as typed.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { generateAccessToken } from '../../utils/jwt';
import orderService from '../../services/orderService';
import customerService from '../../services/customerService';
import webhookService from '../../services/webhookService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();
// Unique digits per run so reruns never collide.
const tail = String(SUFFIX).slice(-6);
// 0 24 5 n + 5 digits = 10 digits
const num = (n: number) => {
  const t = tail.slice(-5);
  return { local: `0245${n}${t}`, e164: `+233245${n}${t}`, national: `245${n}${t}`, intl: `233245${n}${t}` };
};

let tenantId: string;
let productId: number;
let formSlug: string;
let adminToken: string;
const userIds: number[] = [];

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const customerByPhone = (phone: string) => prismaBase.customer.findFirst({ where: { tenantId, phoneNumber: phone } });
const customerCount = (phones: string[]) => prismaBase.customer.count({ where: { tenantId, phoneNumber: { in: phones } } });

const orderBase = () => ({
  orderItems: [{ productId, quantity: 1, unitPrice: 10 }],
  subtotal: 10,
  totalAmount: 10,
  deliveryAddress: '1 Test St',
  deliveryState: 'Greater Accra',
  deliveryArea: 'Accra',
});

beforeAll(async () => {
  const tenant = await createTenant('Phone Norm');
  tenantId = tenant.id;
  const admin = await prismaBase.user.create({
    data: { email: `phone-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Admin', lastName: 'T', role: 'admin', tenantId },
  });
  userIds.push(admin.id);
  adminToken = generateAccessToken({ id: admin.id, email: admin.email, role: admin.role, tenantId });
  const product = await prismaBase.product.create({
    data: { name: `Phone Prod ${SUFFIX}`, sku: `PH-${SUFFIX}`, category: 'test', price: 10, stockQuantity: 1000, tenantId },
  });
  productId = product.id;
  formSlug = `phone-form-${SUFFIX}`;
  const form = await (prismaBase as any).checkoutForm.create({
    data: { name: 'Phone form', slug: formSlug, productId, fields: [], styling: {}, regions: [], tenantId, codEnabled: true },
  });
  await (prismaBase as any).formPackage.create({ data: { formId: form.id, name: 'One', price: 10, quantity: 1 } });
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('write paths store E.164', () => {
  it('public checkout (also alternatePhone, and reuses a customer stored in an old format)', async () => {
    const p = num(1);
    const alt = num(2);
    const res = await request(app)
      .post(`/api/public/forms/${formSlug}/orders`)
      .send({
        formData: { name: 'Pub Buyer', phoneNumber: p.local, alternatePhone: alt.local, address: '1 St', state: 'Greater Accra' },
        selectedPackage: { name: 'One', price: 10, quantity: 1 },
        totalAmount: 10,
      });
    expect(res.status).toBe(201);
    const stored = await customerByPhone(p.e164);
    expect(stored).not.toBeNull();
    expect(stored!.alternatePhone).toBe(alt.e164);
    expect(await customerByPhone(p.local)).toBeNull();

    // A customer saved before normalization existed is found and reused, not duplicated.
    const old = num(3);
    const oldCustomer = await prismaBase.customer.create({
      data: { firstName: 'Old', lastName: 'Format', phoneNumber: old.local, address: 'x', state: 'x', area: 'x', tenantId },
    });
    const res2 = await request(app)
      .post(`/api/public/forms/${formSlug}/orders`)
      .set('X-Forwarded-For', '10.9.9.9')
      .send({
        formData: { name: 'Old Format', phoneNumber: old.e164, address: '1 St', state: 'Greater Accra' },
        selectedPackage: { name: 'One', price: 10, quantity: 1 },
        totalAmount: 10,
      });
    expect(res2.status).toBe(201);
    const order = await prismaBase.order.findUnique({ where: { id: res2.body.orderId } });
    expect(order!.customerId).toBe(oldCustomer.id);
    expect(await customerCount([old.local, old.e164])).toBe(1);
  });

  it('manual order create and update', async () => {
    const p = num(4);
    const alt = num(5);
    const created = await inTenant(() =>
      orderService.createOrder({ ...orderBase(), customerName: 'Manual Buyer', customerPhone: `${p.local.slice(0, 4)} ${p.local.slice(4, 7)} ${p.local.slice(7)}`, alternatePhone: alt.local } as any)
    );
    const customer = await prismaBase.customer.findUnique({ where: { id: created.customerId } });
    expect(customer!.phoneNumber).toBe(p.e164);
    expect(customer!.alternatePhone).toBe(alt.e164);

    const newPhone = num(6);
    await inTenant(() => orderService.updateOrder(created.id, { customerPhone: newPhone.local, alternatePhone: alt.national }));
    const updated = await prismaBase.customer.findUnique({ where: { id: created.customerId } });
    expect(updated!.phoneNumber).toBe(newPhone.e164);
    expect(updated!.alternatePhone).toBe(alt.e164);
  });

  it('manual order keeps unparseable input as typed instead of failing', async () => {
    const created = await inTenant(() =>
      orderService.createOrder({ ...orderBase(), customerName: 'Conny', customerPhone: `Hallo die Conny ${SUFFIX}` } as any)
    );
    const customer = await prismaBase.customer.findUnique({ where: { id: created.customerId } });
    expect(customer!.phoneNumber).toBe(`Hallo die Conny ${SUFFIX}`);
  });

  it('import: normalized on create, and an old-format customer is matched by the duplicate check and the lookup', async () => {
    const p = num(7);
    const alt = num(8);
    const row = {
      customerPhone: p.intl,
      customerFirstName: 'Imp',
      customerLastName: 'Orter',
      customerAlternatePhone: alt.local,
      subtotal: 10,
      totalAmount: 10,
      deliveryAddress: '1 Import St',
      deliveryState: 'Greater Accra',
      deliveryArea: 'Accra',
    };
    const first = await inTenant(() => orderService.bulkImportOrders([row as any], undefined, undefined, undefined, true));
    expect(first.success).toBe(1);
    const stored = await customerByPhone(p.e164);
    expect(stored!.alternatePhone).toBe(alt.e164);

    // Same order again in another phone format: duplicate, no new customer.
    const again = await inTenant(() => orderService.bulkImportOrders([{ ...row, customerPhone: p.local } as any], undefined, undefined, undefined, true));
    expect(again.duplicates).toBe(1);
    expect(await customerCount([p.local, p.intl, p.e164])).toBe(1);

    // Customer saved in an old format: another import row reuses it.
    const old = num(9);
    const oldCustomer = await prismaBase.customer.create({
      data: { firstName: 'Old', lastName: 'Imp', phoneNumber: old.local, address: 'x', state: 'x', area: 'x', tenantId },
    });
    const third = await inTenant(() => orderService.bulkImportOrders([{ ...row, customerPhone: old.e164, totalAmount: 20, subtotal: 20 } as any], undefined, undefined, undefined, true));
    expect(third.success).toBe(1);
    expect(await customerCount([old.local, old.e164])).toBe(1);
    const order = await prismaBase.order.findFirst({ where: { customerId: oldCustomer.id } });
    expect(order).not.toBeNull();
  });

  it('webhook intake', async () => {
    const p = num(1).local.replace(/^0245/, '0246');
    const customer = await inTenant(() =>
      (webhookService as any).findOrCreateCustomer({ customerFirstName: 'Hook', deliveryAddress: 'x' }, { customer_phone: p, alternative_phone_number: num(2).local.replace(/^0245/, '0246') })
    );
    expect(customer.phoneNumber).toBe(`+233${p.slice(1)}`);
    expect(customer.alternatePhone).toBe(`+233${num(2).local.slice(1).replace(/^245/, '246')}`);
  });

  it('customer form create and update, and the duplicate check sees old formats', async () => {
    const p = num(1).local.replace(/^0245/, '0247');
    const created = await inTenant(() =>
      customerService.createCustomer({ firstName: 'Form', phoneNumber: p, alternatePhone: p.replace(/^0247/, '0248'), address: 'x', state: 'x', area: 'x' } as any)
    );
    expect(created.phoneNumber).toBe(`+233${p.slice(1)}`);
    expect(created.alternatePhone).toBe(`+233${p.slice(1).replace(/^247/, '248')}`);

    // Duplicate in another format of the same number
    await expect(
      inTenant(() => customerService.createCustomer({ firstName: 'Dup', phoneNumber: `233${p.slice(1)}`, address: 'x', state: 'x', area: 'x' } as any))
    ).rejects.toThrow(/already exists/);

    // Old-format customer: creating the same number in E.164 is a duplicate
    const old = num(1).local.replace(/^0245/, '0249');
    await prismaBase.customer.create({ data: { firstName: 'Old', lastName: 'F', phoneNumber: old, address: 'x', state: 'x', area: 'x', tenantId } });
    await expect(
      inTenant(() => customerService.createCustomer({ firstName: 'Dup', phoneNumber: `+233${old.slice(1)}`, address: 'x', state: 'x', area: 'x' } as any))
    ).rejects.toThrow(/already exists/);

    // Update normalizes; an old-format customer can be re-saved with its own number
    const oldRow = await customerByPhone(old);
    const updated = await inTenant(() => customerService.updateCustomer(String(oldRow!.id), { phoneNumber: old }));
    expect(updated.phoneNumber).toBe(`+233${old.slice(1)}`);
    // ...but not with another customer's number
    await expect(inTenant(() => customerService.updateCustomer(String(oldRow!.id), { phoneNumber: p }))).rejects.toThrow(/already in use/);
  });
});

describe('lookups find both formats', () => {
  it('customer search, order search and find-by-phone', async () => {
    const p = num(1).local.replace(/^0245/, '0250');
    const customer = await prismaBase.customer.create({
      data: { firstName: 'Search', lastName: 'Old', phoneNumber: p, address: 'x', state: 'x', area: 'x', tenantId },
    });
    const norm = await prismaBase.customer.create({
      data: { firstName: 'Search', lastName: 'New', phoneNumber: `+233${num(1).local.slice(1).replace(/^245/, '251')}`, address: 'x', state: 'x', area: 'x', tenantId },
    });
    const normLocal = `0${norm.phoneNumber.slice(4)}`;

    // customer stored as old 0250..., found by +233250...
    for (const term of [p, `+233${p.slice(1)}`, `233${p.slice(1)}`, `${p.slice(1)}`]) {
      const res = await request(app).get('/api/customers').query({ search: term }).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.customers.map((c: any) => c.id)).toContain(customer.id);
    }
    // customer stored as +233251..., found by 0251...
    for (const term of [normLocal, norm.phoneNumber]) {
      const res = await request(app).get('/api/customers').query({ search: term }).set('Authorization', `Bearer ${adminToken}`);
      expect(res.body.customers.map((c: any) => c.id)).toContain(norm.id);
    }
    // order search
    await prismaBase.order.create({
      data: {
        customerId: customer.id, subtotal: 10, shippingCost: 0, totalAmount: 10, codAmount: 10, deliveryAddress: 'x',
        deliveryState: 'x', deliveryArea: 'x', tenantId,
      } as any,
    });
    const orders = await inTenant(() => orderService.getAllOrders({ search: `+233${p.slice(1)}` } as any));
    expect(orders.orders.some((o: any) => o.customerId === customer.id)).toBe(true);

    // find by phone
    const found = await inTenant(() => customerService.getCustomerByPhone(`+233${p.slice(1)}`));
    expect(found!.id).toBe(customer.id);
  });
});
