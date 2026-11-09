/**
 * M7-T07 (COD-64, F-355, F-766, F-317, F-765): Customer and order creation for reps.
 *
 * Rules:
 * - Reps can add and edit customers, never delete (403).
 * - A rep sees the customers they created (createdById) plus customers on their own orders;
 *   tested with two reps to prove scope.
 * - Duplicate phone on create returns the existing customer (200 with duplicate: true and the record), not 409.
 * - Phone normalising matches checkout (formatPhoneNumber / checkout phone rule). Phone with letters is a 400.
 * - A rep-created order gets customerRepId = the rep and appears in their queue.
 * - Archived products and packages are not selectable (400).
 * - The stock check is the same function checkout uses (no second version).
 * - Webhook order intake: phone only is required.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';
import { generateAccessToken } from '../../utils/jwt';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import webhookService from '../../services/webhookService';

jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: { triggerStatusChangeWorkflows: () => Promise.resolve() },
  registerWorkflowListeners: jest.fn(),
}));

const SUFFIX = Date.now();
let tenantId: string;
const tenantIds: string[] = [];

let rep1Id: number;
let rep1Token: string;
let rep2Id: number;
let rep2Token: string;
let adminId: number;
let adminToken: string;

let activeProductId: number;
let archivedProductId: number;
let lowStockProductId: number;
let formPackageId: number;
let archivedFormPackageId: number;
let webhookApiKey: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const makePhone = (offset: number) => `+233245${String(SUFFIX).slice(-4)}${String(offset).padStart(3, '0')}`;

beforeAll(async () => {
  tenantId = (await createTenant('Rep Customer and Order')).id;
  tenantIds.push(tenantId);
  await seedTenantDefaults(tenantId);

  const makeUser = async (name: string, role: string) => {
    const user = await prismaBase.user.create({
      data: {
        email: `${name}-${SUFFIX}@codadmin.test`,
        password: 'hash',
        firstName: name,
        lastName: 'RepTest',
        role,
        tenantId,
      } as any,
    });
    const token = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId,
    });
    return { id: user.id, token };
  };

  const rep1 = await makeUser('rep1', 'sales_rep');
  rep1Id = rep1.id;
  rep1Token = rep1.token;

  const rep2 = await makeUser('rep2', 'sales_rep');
  rep2Id = rep2.id;
  rep2Token = rep2.token;

  const admin = await makeUser('admin', 'super_admin');
  adminId = admin.id;
  adminToken = admin.token;

  // Products: active with stock, active with low stock, archived
  const activeProd = await prismaBase.product.create({
    data: {
      name: `Active Prod ${SUFFIX}`,
      sku: `SKU-ACT-${SUFFIX}`,
      category: 'General',
      price: 100,
      stockQuantity: 50,
      isActive: true,
      tenantId,
    },
  });
  activeProductId = activeProd.id;

  const lowStockProd = await prismaBase.product.create({
    data: {
      name: `Low Stock Prod ${SUFFIX}`,
      sku: `SKU-LOW-${SUFFIX}`,
      category: 'General',
      price: 50,
      stockQuantity: 2,
      isActive: true,
      tenantId,
    },
  });
  lowStockProductId = lowStockProd.id;

  const archivedProd = await prismaBase.product.create({
    data: {
      name: `Archived Prod ${SUFFIX}`,
      sku: `SKU-ARC-${SUFFIX}`,
      category: 'General',
      price: 80,
      stockQuantity: 20,
      isActive: false,
      tenantId,
    },
  });
  archivedProductId = archivedProd.id;

  await stockUp(tenantId, activeProductId, 50);
  await stockUp(tenantId, lowStockProductId, 2);
  await stockUp(tenantId, archivedProductId, 20);

  // Checkout form and packages: active and archived
  const form = await prismaBase.checkoutForm.create({
    data: {
      name: `Form ${SUFFIX}`,
      slug: `form-${SUFFIX}`,
      fields: [],
      styling: {},
      regions: { available: ['Greater Accra', 'Ashanti'] },
      productId: activeProductId,
      isActive: true,
      tenantId,
    } as never,
  });

  const pkg = await prismaBase.formPackage.create({
    data: {
      formId: form.id,
      name: '1 Set',
      price: 100,
      quantity: 1,
    },
  });
  formPackageId = pkg.id;

  const archivedForm = await prismaBase.checkoutForm.create({
    data: {
      name: `Archived Form ${SUFFIX}`,
      slug: `archived-form-${SUFFIX}`,
      fields: [],
      styling: {},
      regions: { available: ['Greater Accra', 'Ashanti'] },
      productId: activeProductId,
      isActive: false,
      archivedAt: new Date(),
      tenantId,
    } as never,
  });

  const archivedPkg = await prismaBase.formPackage.create({
    data: {
      formId: archivedForm.id,
      name: 'Archived Package',
      price: 150,
      quantity: 2,
    },
  });
  archivedFormPackageId = archivedPkg.id;

  // Webhook config for intake test
  webhookApiKey = `wh-key-${SUFFIX}`;
  await prismaBase.webhookConfig.create({
    data: {
      name: `Shopify Webhook ${SUFFIX}`,
      url: `https://example.com/wh-${SUFFIX}`,
      apiKey: webhookApiKey,
      secret: `sec-${SUFFIX}`,
      fieldMapping: { customerPhone: 'customer_phone' },
      isActive: true,
      productId: activeProductId,
      tenantId,
    },
  });
}, 30000);

afterAll(async () => {
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('M7-T07: customer and order creation for reps', () => {
  let custRep1Id: number;
  let custRep1OrderCustId: number;
  let custRep2Id: number;
  let custRep2OrderCustId: number;

  describe('Rule 1: Reps can add and edit customers, never delete (403)', () => {
    it('rep can add a new customer and createdById is stamped', async () => {
      const res = await request(app)
        .post('/api/customers')
        .set(bearer(rep1Token))
        .send({
          firstName: 'Kwame',
          lastName: 'Mensah',
          phoneNumber: makePhone(1),
          address: '10 High St',
          state: 'Greater Accra',
          area: 'Accra',
        });

      expect(res.status).toBe(201);
      expect(res.body.customer).toBeDefined();
      expect(res.body.customer.firstName).toBe('Kwame');
      expect(res.body.customer.createdById).toBe(rep1Id);
      custRep1Id = res.body.customer.id;
    });

    it('rep can edit customer they created', async () => {
      const res = await request(app)
        .put(`/api/customers/${custRep1Id}`)
        .set(bearer(rep1Token))
        .send({
          landmark: 'Opposite Shell',
          notes: 'Call before delivery',
        });

      expect(res.status).toBe(200);
      expect(res.body.customer.landmark).toBe('Opposite Shell');
      expect(res.body.customer.notes).toBe('Call before delivery');
    });

    it('rep can never delete a customer (returns 403)', async () => {
      const res = await request(app)
        .delete(`/api/customers/${custRep1Id}`)
        .set(bearer(rep1Token));

      expect(res.status).toBe(403);

      const stillActive = await prismaBase.customer.findUnique({
        where: { id: custRep1Id },
      });
      expect(stillActive?.isActive).toBe(true);
    });

    it('other rep also cannot delete the customer (returns 403)', async () => {
      const res = await request(app)
        .delete(`/api/customers/${custRep1Id}`)
        .set(bearer(rep2Token));

      expect(res.status).toBe(403);
    });
  });

  describe('Rule 2: Rep sees created customers + customers on own orders (two reps to prove scope)', () => {
    beforeAll(async () => {
      // Rep 1 creates Customer B with an order
      const custB = await prismaBase.customer.create({
        data: {
          firstName: 'CustomerB',
          lastName: 'Rep1Order',
          phoneNumber: makePhone(2),
          address: '20 Main St',
          state: 'Greater Accra',
          area: 'Accra',
          tenantId,
        },
      });
      custRep1OrderCustId = custB.id;
      await prismaBase.order.create({
        data: {
          customerId: custB.id,
          customerRepId: rep1Id,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          deliveryAddress: '20 Main St',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          tenantId,
        } as any,
      });

      // Rep 2 creates Customer C (createdById = rep2Id, no order)
      const resC = await request(app)
        .post('/api/customers')
        .set(bearer(rep2Token))
        .send({
          firstName: 'CustomerC',
          lastName: 'Rep2Created',
          phoneNumber: makePhone(3),
          address: '30 Kumasi Rd',
          state: 'Ashanti',
          area: 'Kumasi',
        });
      expect(resC.status).toBe(201);
      custRep2Id = resC.body.customer.id;

      // Rep 2 has Customer D with an order
      const custD = await prismaBase.customer.create({
        data: {
          firstName: 'CustomerD',
          lastName: 'Rep2Order',
          phoneNumber: makePhone(4),
          address: '40 Kumasi Rd',
          state: 'Ashanti',
          area: 'Kumasi',
          tenantId,
        },
      });
      custRep2OrderCustId = custD.id;
      await prismaBase.order.create({
        data: {
          customerId: custD.id,
          customerRepId: rep2Id,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          deliveryAddress: '40 Kumasi Rd',
          deliveryState: 'Ashanti',
          deliveryArea: 'Kumasi',
          tenantId,
        } as any,
      });
    });

    it('Rep 1 sees created customers (custRep1Id) and order customers (custRep1OrderCustId), but NOT Rep 2 customers', async () => {
      const res = await request(app)
        .get('/api/customers')
        .set(bearer(rep1Token))
        .query({ limit: 50 });

      expect(res.status).toBe(200);
      const ids: number[] = res.body.customers.map((c: any) => c.id);
      expect(ids).toContain(custRep1Id);
      expect(ids).toContain(custRep1OrderCustId);
      expect(ids).not.toContain(custRep2Id);
      expect(ids).not.toContain(custRep2OrderCustId);
    });

    it('Rep 2 sees created customers (custRep2Id) and order customers (custRep2OrderCustId), but NOT Rep 1 customers', async () => {
      const res = await request(app)
        .get('/api/customers')
        .set(bearer(rep2Token))
        .query({ limit: 50 });

      expect(res.status).toBe(200);
      const ids: number[] = res.body.customers.map((c: any) => c.id);
      expect(ids).toContain(custRep2Id);
      expect(ids).toContain(custRep2OrderCustId);
      expect(ids).not.toContain(custRep1Id);
      expect(ids).not.toContain(custRep1OrderCustId);
    });

    it('Rep 1 cannot view details of Customer C (Rep 2 customer) -> 403', async () => {
      const res = await request(app)
        .get(`/api/customers/${custRep2Id}`)
        .set(bearer(rep1Token));

      expect(res.status).toBe(403);
    });

    it('Rep 2 can view details of Customer C -> 200', async () => {
      const res = await request(app)
        .get(`/api/customers/${custRep2Id}`)
        .set(bearer(rep2Token));

      expect(res.status).toBe(200);
      expect(res.body.customer.id).toBe(custRep2Id);
    });

    it('Rep 1 cannot edit Customer C (Rep 2 customer) -> 403', async () => {
      const res = await request(app)
        .put(`/api/customers/${custRep2Id}`)
        .set(bearer(rep1Token))
        .send({ landmark: 'Hacked' });

      expect(res.status).toBe(403);
    });
  });

  describe('Rule 3: Duplicate phone on create returns existing customer (200 with duplicate: true), phone normalization, phone with letters', () => {
    it('duplicate phone on create returns existing customer with 200 and duplicate: true flag', async () => {
      const existingPhone = makePhone(1); // belongs to custRep1Id
      const res = await request(app)
        .post('/api/customers')
        .set(bearer(rep1Token))
        .send({
          firstName: 'Another',
          lastName: 'Person',
          phoneNumber: existingPhone,
          address: 'New Address',
          state: 'Greater Accra',
          area: 'Accra',
        });

      expect(res.status).toBe(200);
      expect(res.body.duplicate).toBe(true);
      expect(res.body.customer).toBeDefined();
      expect(res.body.customer.id).toBe(custRep1Id);
    });

    it('duplicate phone normalization matches across local 024, 233, and +233 formats', async () => {
      // Create a customer with a dedicated local number
      const localPhone = '0245559876';
      const created = await request(app)
        .post('/api/customers')
        .set(bearer(rep1Token))
        .send({
          firstName: 'PhoneFormat',
          lastName: 'Tester',
          phoneNumber: localPhone,
          address: 'Accra Mall',
          state: 'Greater Accra',
          area: 'Accra',
        });
      expect(created.status).toBe(201);
      const createdId = created.body.customer.id;

      // Duplicate check with international form +233245559876
      const dup1 = await request(app)
        .post('/api/customers')
        .set(bearer(rep1Token))
        .send({
          firstName: 'PhoneFormat2',
          phoneNumber: '+233245559876',
          address: 'Accra Mall',
          state: 'Greater Accra',
          area: 'Accra',
        });
      expect(dup1.status).toBe(200);
      expect(dup1.body.duplicate).toBe(true);
      expect(dup1.body.customer.id).toBe(createdId);

      // Duplicate check with format without leading plus 233245559876
      const dup2 = await request(app)
        .post('/api/customers')
        .set(bearer(rep1Token))
        .send({
          firstName: 'PhoneFormat3',
          phoneNumber: '233245559876',
          address: 'Accra Mall',
          state: 'Greater Accra',
          area: 'Accra',
        });
      expect(dup2.status).toBe(200);
      expect(dup2.body.duplicate).toBe(true);
      expect(dup2.body.customer.id).toBe(createdId);

      // Rep 2 cannot open this customer -> 409 PHONE_BELONGS_TO_OTHER_CUSTOMER with name only
      const dupRep2 = await request(app)
        .post('/api/customers')
        .set(bearer(rep2Token))
        .send({
          firstName: 'PhoneFormat4',
          phoneNumber: '233245559876',
          address: 'Accra Mall',
          state: 'Greater Accra',
          area: 'Accra',
        });
      expect(dupRep2.status).toBe(409);
      expect(dupRep2.body.code).toBe('PHONE_BELONGS_TO_OTHER_CUSTOMER');
      expect(dupRep2.body.message).toContain('This number belongs to PhoneFormat Tester');
      expect(dupRep2.body.customerId).toBeUndefined();
    });

    it('phone number with letters returns 400 on customer create', async () => {
      const res = await request(app)
        .post('/api/customers')
        .set(bearer(rep1Token))
        .send({
          firstName: 'Bad',
          lastName: 'Phone',
          phoneNumber: '024abc5555',
          address: '1 St',
          state: 'Greater Accra',
          area: 'Accra',
        });

      expect(res.status).toBe(400);
    });

    it('phone number with letters returns 400 on order create', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set(bearer(rep1Token))
        .send({
          customerName: 'Bad Order Phone',
          customerPhone: '024555xxxx',
          deliveryAddress: '1 St',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          totalAmount: 100,
          orderItems: [{ productId: activeProductId, quantity: 1, unitPrice: 100 }],
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Rule 4: Rep-created order gets customerRepId = the rep and appears in their queue', () => {
    it('rep-created order is assigned to rep and appears in pending_confirmation queue', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set(bearer(rep1Token))
        .send({
          customerId: custRep1Id,
          deliveryAddress: '10 High St',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          totalAmount: 100,
          orderItems: [{ productId: activeProductId, quantity: 1, unitPrice: 100 }],
        });

      expect(res.status).toBe(201);
      const order = res.body.order;
      expect(order.customerRepId).toBe(rep1Id);
      expect(order.status).toBe('pending_confirmation');

      // Verify order is in Rep 1's queue
      const rep1Queue = await prismaBase.order.findMany({
        where: {
          customerRepId: rep1Id,
          status: 'pending_confirmation',
          deletedAt: null,
        },
      });
      expect(rep1Queue.map((o) => o.id)).toContain(order.id);

      // Verify order is NOT in Rep 2's queue
      const rep2Queue = await prismaBase.order.findMany({
        where: {
          customerRepId: rep2Id,
          status: 'pending_confirmation',
          deletedAt: null,
        },
      });
      expect(rep2Queue.map((o) => o.id)).not.toContain(order.id);
    });

    it('when customer is created during rep order creation, createdById is set to the rep', async () => {
      const newPhone = makePhone(7);
      const res = await request(app)
        .post('/api/orders')
        .set(bearer(rep1Token))
        .send({
          customerName: 'Inline Customer',
          customerPhone: newPhone,
          deliveryAddress: '55 Osu Oxford St',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          totalAmount: 100,
          orderItems: [{ productId: activeProductId, quantity: 1, unitPrice: 100 }],
        });

      expect(res.status).toBe(201);
      const order = res.body.order;
      expect(order.customerRepId).toBe(rep1Id);

      const customer = await prismaBase.customer.findUniqueOrThrow({
        where: { id: order.customerId },
      });
      expect(customer.createdById).toBe(rep1Id);

      // Rep 1 sees this customer in their list
      const listRes = await request(app)
        .get('/api/customers')
        .set(bearer(rep1Token))
        .query({ search: 'Inline Customer' });
      expect(listRes.status).toBe(200);
      expect(listRes.body.customers.map((c: any) => c.id)).toContain(customer.id);
    });
  });

  describe('Rule 5 & 6: Archived products and packages are not selectable (400), stock check', () => {
    it('order creation with archived product returns 400', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set(bearer(rep1Token))
        .send({
          customerId: custRep1Id,
          deliveryAddress: '10 High St',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          totalAmount: 80,
          orderItems: [{ productId: archivedProductId, quantity: 1, unitPrice: 80 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error ?? res.body.message).toContain('Archived products are not selectable');
    });

    it('order creation with active package succeeds', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set(bearer(rep1Token))
        .send({
          customerId: custRep1Id,
          packageId: formPackageId,
          deliveryAddress: '10 High St',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          totalAmount: 100,
          orderItems: [{ productId: activeProductId, quantity: 1, unitPrice: 100, metadata: { packageId: formPackageId } }],
        });

      expect(res.status).toBe(201);
    });

    it('order creation with archived package returns 400', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set(bearer(rep1Token))
        .send({
          customerId: custRep1Id,
          packageId: archivedFormPackageId,
          deliveryAddress: '10 High St',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          totalAmount: 150,
          orderItems: [{ productId: activeProductId, quantity: 1, unitPrice: 150, metadata: { packageId: archivedFormPackageId } }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error ?? res.body.message).toContain('Archived packages are not selectable');
    });

    it('stock check rejects order exceeding available stock (400)', async () => {
      // lowStockProductId has stockQuantity = 2
      const res = await request(app)
        .post('/api/orders')
        .set(bearer(rep1Token))
        .send({
          customerId: custRep1Id,
          deliveryAddress: '10 High St',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          totalAmount: 500,
          orderItems: [{ productId: lowStockProductId, quantity: 10, unitPrice: 50 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error ?? res.body.message).toContain('Insufficient stock for product');
    });
  });

  describe('Rule 7: Webhook order intake requires phone only', () => {
    it('webhook intake with phone ONLY succeeds and creates order + customer', async () => {
      const phoneOnly = makePhone(8);
      const res = await request(app)
        .post('/api/webhooks/import')
        .set('x-api-key', webhookApiKey)
        .send({
          orders: [
            {
              customer_phone: phoneOnly,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.results.success).toBe(1);
      expect(res.body.results.failed).toBe(0);

      // Verify customer was created with Unknown name and phone
      const customer = await prismaBase.customer.findFirst({
        where: { phoneNumber: phoneOnly, tenantId },
      });
      expect(customer).not.toBeNull();
      expect(customer?.firstName).toBe('Unknown');

      // Verify order was created
      const order = await prismaBase.order.findFirst({
        where: { customerId: customer!.id, tenantId },
      });
      expect(order).not.toBeNull();
      expect(order?.status).toBe('pending_confirmation');
      expect(order?.source).toBe('webhook');
    });

    it('webhook intake without phone fails the order', async () => {
      const res = await request(app)
        .post('/api/webhooks/import')
        .set('x-api-key', webhookApiKey)
        .send({
          orders: [
            {
              customer_name: 'No Phone Person',
              address: 'Somewhere',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.results.failed).toBe(1);
      expect(res.body.results.errors[0].error).toContain('Customer phone number is required');
    });
  });
});
