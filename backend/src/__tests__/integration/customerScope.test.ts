/**
 * COD-30 F7a/F7b: one customer row scope for the Customers page and the global search (`customerScope`).
 * Rep: customers they created or have an order with. Delivery agent: customers of their deliveries.
 * Accountant and inventory manager: all customers and all orders of a customer, like orderScope.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

const SUFFIX = Date.now();
const TAG = `Cscope${SUFFIX}`;
let tenantId: string;
const U: Record<string, { id: number; token: string }> = {};
const C: Record<string, number> = {};

const mkUser = async (label: string, role: any) => {
  const u = await prismaBase.user.create({
    data: { email: `cs-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId },
  });
  U[label] = { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId }) };
};
let phoneSeq = 0;
const mkCustomer = async (label: string, extra: Record<string, unknown> = {}) => {
  const c = await prismaBase.customer.create({
    data: {
      firstName: `${TAG}${label}`, lastName: 'Buyer', phoneNumber: `+233245${String(SUFFIX).slice(-4)}${String(phoneSeq++).padStart(3, '0')}`,
      address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId, ...extra,
    },
  });
  C[label] = c.id;
};
const mkOrder = (customerId: number, extra: Record<string, unknown>) =>
  prismaBase.order.create({
    data: {
      customerId, status: 'pending_confirmation', subtotal: 10, totalAmount: 10, codAmount: 10, tenantId,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
    } as any,
  });
const searchCustomers = async (label: string) =>
  ((await request(app).get('/api/search').query({ q: TAG }).set(bearer(U[label].token))).body.customers as Array<{ id: number }>).map((c) => c.id).sort();

beforeAll(async () => {
  tenantId = (await createTenant('Customer Scope')).id;
  await Promise.all([
    mkUser('rep', 'sales_rep'), mkUser('otherRep', 'sales_rep'), mkUser('agent', 'delivery_agent'),
    mkUser('accountant', 'accountant'), mkUser('inventory', 'inventory_manager'),
  ]);
  await mkCustomer('created', { createdById: U.rep.id });          // rep created it, no order
  await mkCustomer('repOrder');                                    // order of the rep
  await mkCustomer('agentOrder');                                  // delivery of the agent, other rep
  await mkCustomer('unrelated');
  await mkOrder(C.repOrder, { customerRepId: U.rep.id });
  await mkOrder(C.agentOrder, { customerRepId: U.otherRep.id, deliveryAgentId: U.agent.id });
  await mkOrder(C.agentOrder, { customerRepId: U.otherRep.id });   // a second order of that customer, not the agent's
  await mkOrder(C.unrelated, { customerRepId: U.otherRep.id });
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('global search customer scope', () => {
  it('a rep finds customers they created (no order) and customers of their orders', async () => {
    expect(await searchCustomers('rep')).toEqual([C.created, C.repOrder].sort());
  });

  it('a delivery agent finds only their delivery customers', async () => {
    expect(await searchCustomers('agent')).toEqual([C.agentOrder]);
  });

  it('accountant and inventory manager find all customers', async () => {
    const all = [C.created, C.repOrder, C.agentOrder, C.unrelated].sort();
    expect(await searchCustomers('accountant')).toEqual(all);
    expect(await searchCustomers('inventory')).toEqual(all);
  });
});

describe('Customers page scope matches the search', () => {
  const list = async (label: string) =>
    ((await request(app).get('/api/customers').query({ search: TAG, limit: 50 }).set(bearer(U[label].token))).body.customers as Array<{ id: number }>)
      .map((c) => c.id).sort();

  it('same ids for rep, agent, accountant and inventory manager', async () => {
    for (const label of ['rep', 'agent', 'accountant', 'inventory']) {
      expect(await list(label)).toEqual(await searchCustomers(label));
    }
  });
});

describe('customer details order list', () => {
  const detail = async (label: string, id: number) => {
    const res = await request(app).get(`/api/customers/${id}`).set(bearer(U[label].token));
    expect(res.status).toBe(200);
    return (res.body.customer ?? res.body).orders as Array<{ id: number }>;
  };

  it('accountant and inventory manager see every order of the customer', async () => {
    expect(await detail('accountant', C.agentOrder)).toHaveLength(2);
    expect(await detail('inventory', C.agentOrder)).toHaveLength(2);
  });

  it('a delivery agent still sees only their own order of the customer', async () => {
    expect(await detail('agent', C.agentOrder)).toHaveLength(1);
  });
});
