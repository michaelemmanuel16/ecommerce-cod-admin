/**
 * COD-138: City/Town and Nearest landmark. The state never goes in the town field again.
 * Public checkout saves the chosen town + landmark; the import leaves the town empty when the file has none;
 * GET /api/locations/towns follows the tenant's store country (two tenants, two countries).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { clearCurrencyCache } from '../../utils/currency';
import { bearer } from './helpers/superAdminToken';

jest.mock('../../middleware/bulkRateLimiter', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { bulkImportRateLimiter: pass, bulkOrderRateLimiter: pass };
});

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let ghTenant: string;
let ngTenant: string;
let ghToken: string;
let ngToken: string;
let agentToken: string;
let ownerToken: string;
let formSlug: string;
let optionalFormSlug: string;
let seq = 0;

const phone = () => `024${String(SUFFIX).slice(-4)}${String(seq++).padStart(3, '0')}`;
const ip = () => `10.8.${seq}.${seq + 1}`;
const checkout = (slug: string, formData: Record<string, unknown>) =>
  request(app)
    .post(`/api/public/forms/${slug}/orders`)
    .set('X-Forwarded-For', ip())
    .send({ formData, selectedPackage: { name: 'One', price: 10, quantity: 1 }, totalAmount: 10 });

async function makeForm(tenantId: string, productId: number, slug: string, fields: unknown[]) {
  const form = await (prismaBase as any).checkoutForm.create({
    data: { name: slug, slug, productId, fields, styling: {}, regions: { available: ['Ashanti', 'Greater Accra'] }, tenantId, codEnabled: true },
  });
  await (prismaBase as any).formPackage.create({ data: { formId: form.id, name: 'One', price: 10, quantity: 1 } });
}

beforeAll(async () => {
  ghTenant = (await createTenant('Town Gh')).id;
  ngTenant = (await createTenant('Town Ng', { currency: 'NGN' })).id;
  clearCurrencyCache();
  await seedTenantDefaults(ghTenant);
  const mk = async (tenantId: string, label: string, role: any) => {
    const u = await prismaBase.user.create({
      data: { email: `town-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId },
    });
    return generateAccessToken({ id: u.id, email: u.email, role, tenantId });
  };
  ghToken = await mk(ghTenant, 'gh', 'sales_rep');
  ngToken = await mk(ngTenant, 'ng', 'sales_rep');
  agentToken = await mk(ghTenant, 'agent', 'delivery_agent');
  ownerToken = await mk(ghTenant, 'owner', 'super_admin');
  const product = await prismaBase.product.create({
    data: { name: `Town Prod ${SUFFIX}`, sku: `TW-${SUFFIX}`, category: 'test', price: 10, stockQuantity: 1000, tenantId: ghTenant },
  });
  formSlug = `town-form-${SUFFIX}`;
  await makeForm(ghTenant, product.id, formSlug, []);
  // A seller who switched City/Town and Nearest landmark off.
  optionalFormSlug = `town-form-off-${SUFFIX}`;
  await makeForm(ghTenant, product.id, optionalFormSlug, [
    { label: 'City/Town', type: 'select', standardKey: 'town', required: false, enabled: false },
    { label: 'Nearest landmark', type: 'text', standardKey: 'landmark', required: false, enabled: false },
  ]);
  await prismaBase.product.create({ data: { sku: `TWI-${SUFFIX}`, name: 'Copybook Set', category: 'x', price: 50, stockQuantity: 500, tenantId: ghTenant } });
});

afterAll(async () => {
  await deleteTenantRows([ghTenant, ngTenant]);
  await prismaBase.$disconnect();
});

describe('public checkout writes the chosen town', () => {
  it('Ashanti + Adum + landmark saves area, deliveryArea, landmark and an address with the landmark', async () => {
    const p = phone();
    const res = await checkout(formSlug, { name: 'Kofi Town', phoneNumber: p, state: 'Ashanti', town: ' Adum ', landmark: 'Opposite Kejetia market' });
    expect(res.status).toBe(201);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: res.body.orderId }, include: { customer: true } });
    expect(order.deliveryState).toBe('Ashanti');
    expect(order.deliveryArea).toBe('Adum');
    expect(order.deliveryAddress).toContain('Opposite Kejetia market');
    expect(order.customer.area).toBe('Adum');
    expect(order.customer.landmark).toBe('Opposite Kejetia market');

    const withStreet = await checkout(formSlug, { name: 'Ama Street', phoneNumber: phone(), state: 'Greater Accra', town: 'Madina', landmark: 'Near the mall', address: '12 High St' });
    const o2 = await prismaBase.order.findUniqueOrThrow({ where: { id: withStreet.body.orderId } });
    expect(o2.deliveryAddress).toBe('12 High St, Near the mall');
  });

  it('a missing town or landmark is a 400 when the field is on', async () => {
    const noTown = await checkout(formSlug, { name: 'No Town', phoneNumber: phone(), state: 'Ashanti', landmark: 'Near the church' });
    expect(noTown.status).toBe(400);
    expect(noTown.body.error).toMatch(/town/);
    const noLandmark = await checkout(formSlug, { name: 'No Mark', phoneNumber: phone(), state: 'Ashanti', town: 'Adum' });
    expect(noLandmark.status).toBe(400);
    expect(noLandmark.body.error).toMatch(/landmark/);
  });

  it('a form with the fields switched off takes the order, and the town stays empty (never the state)', async () => {
    const res = await checkout(optionalFormSlug, { name: 'Off Form', phoneNumber: phone(), state: 'Ashanti' });
    expect(res.status).toBe(201);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: res.body.orderId }, include: { customer: true } });
    expect(order.deliveryArea).toBeNull();
    expect(order.customer.area).toBe('');
  });

  it('the public form payload carries the towns of its states', async () => {
    const res = await request(app).get(`/api/public/forms/${formSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.form.towns['Greater Accra']).toEqual(expect.arrayContaining(['Madina', 'Tema', 'Kasoa']));
    expect(res.body.form.towns.Ashanti).toContain('Adum');
  });
});

describe('New order sheet (manual order) landmark', () => {
  it('saves the landmark on the customer and in the delivery address', async () => {
    const product = await prismaBase.product.findFirstOrThrow({ where: { tenantId: ghTenant, sku: `TW-${SUFFIX}` } });
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(ownerToken))
      .send({
        customerName: 'Manual Landmark',
        customerPhone: phone(),
        deliveryAddress: '14 Adum Road',
        deliveryState: 'Ashanti',
        deliveryArea: 'Adum',
        landmark: 'Opposite Kejetia market',
        orderItems: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
        subtotal: 10,
        totalAmount: 10,
      });
    expect(res.status).toBe(201);
    const id = res.body.order?.id ?? res.body.id;
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    expect(order.deliveryAddress).toBe('14 Adum Road, Opposite Kejetia market');
    expect(order.deliveryArea).toBe('Adum');
    expect(order.customer.landmark).toBe('Opposite Kejetia market');
  });
});

describe('import without a town column value', () => {
  it('saves deliveryArea as empty, not the region', async () => {
    const p = phone();
    const csv = `customer_name,phone,address,region,product,quantity,price,status\nImp Buyer,${p},1 Import Rd,Ashanti,Copybook Set,1,50,pending_confirmation\n`;
    const res = await request(app).post('/api/orders/upload').set(bearer(ownerToken)).attach('file', Buffer.from(csv), 'orders.csv');
    expect(res.status).toBe(200);
    expect(res.body.results.success).toBe(1);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: res.body.results.orderIds[0] }, include: { customer: true } });
    expect(order.deliveryState).toBe('Ashanti');
    expect(order.deliveryArea).toBe('');
    expect(order.customer.area).toBe('');
  });
});

describe('GET /api/locations/towns', () => {
  it('needs a login', async () => {
    const res = await request(app).get('/api/locations/towns').query({ state: 'Ashanti' });
    expect(res.status).toBe(401);
  });

  it('needs the state', async () => {
    const res = await request(app).get('/api/locations/towns').set(bearer(ghToken));
    expect(res.status).toBe(400);
  });

  it('follows the tenant store country: Ghana list for A, library list for B', async () => {
    const a = await request(app).get('/api/locations/towns').query({ state: 'Greater Accra' }).set(bearer(ghToken));
    expect(a.status).toBe(200);
    expect(a.body.country).toBe('GH');
    expect(a.body.towns).toEqual(expect.arrayContaining(['Madina', 'Spintex', 'Tema', 'Kasoa']));

    const b = await request(app).get('/api/locations/towns').query({ state: 'Lagos' }).set(bearer(ngToken));
    expect(b.status).toBe(200);
    expect(b.body.country).toBe('NG');
    expect(b.body.towns.length).toBeGreaterThan(0);
    expect(b.body.towns).not.toContain('Madina');

    // Tenant B has no Greater Accra, tenant A has no Lagos.
    const bGh = await request(app).get('/api/locations/towns').query({ state: 'Greater Accra' }).set(bearer(ngToken));
    expect(bGh.body.towns).toEqual([]);
    const aLagos = await request(app).get('/api/locations/towns').query({ state: 'Lagos' }).set(bearer(ghToken));
    expect(aLagos.body.towns).toEqual([]);
  });

  it('a role that cannot create orders or customers is refused', async () => {
    const res = await request(app).get('/api/locations/towns').query({ state: 'Ashanti' }).set(bearer(agentToken));
    expect(res.status).toBe(403);
  });
});
