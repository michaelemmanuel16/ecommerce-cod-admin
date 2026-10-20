/**
 * M1-T07: scripts/backfill-digital-delivery-date.ts fills deliveryDate on old digital_delivered
 * orders from the payment time, is idempotent, and does nothing without --apply.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'child_process';
import path from 'path';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

const SUFFIX = Date.now();
const HISTORY_AT = new Date('2026-09-10T08:00:00.000Z');
const PAID_AT = new Date('2026-09-11T08:00:00.000Z');
let tenantId: string;
let withHistory: number;
let withPayment: number;
let withNothing: number;

const run = (...args: string[]) =>
  execFileSync(
    path.join(__dirname, '../../../node_modules/.bin/ts-node'),
    ['scripts/backfill-digital-delivery-date.ts', ...args],
    { cwd: path.join(__dirname, '../../..'), env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' },
  );

const dateOf = async (id: number) => (await prismaBase.order.findUniqueOrThrow({ where: { id } })).deliveryDate;

beforeAll(async () => {
  const tenant = await createTenant('DD Backfill');
  tenantId = tenant.id;
  const customer = await prismaBase.customer.create({
    data: {
      firstName: 'Yaa', lastName: 'Boateng', phoneNumber: `+2332${SUFFIX}`.slice(0, 15),
      address: '4 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId,
    },
  });
  const mk = async () =>
    (await prismaBase.order.create({
      data: { customerId: customer.id, status: 'digital_delivered', orderType: 'digital', subtotal: 20, totalAmount: 20, tenantId },
    })).id;
  withHistory = await mk();
  withPayment = await mk();
  withNothing = await mk();
  await prismaBase.orderHistory.create({ data: { orderId: withHistory, status: 'digital_delivered', createdAt: HISTORY_AT, tenantId } });
  await prismaBase.transaction.create({
    data: { orderId: withPayment, type: 'payment', amount: 20, paymentMethod: 'paystack', status: 'paid', createdAt: PAID_AT, tenantId },
  });
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('backfill-digital-delivery-date', () => {
  it('writes nothing by default (dry run)', async () => {
    run();
    expect(await dateOf(withHistory)).toBeNull();
    expect(await dateOf(withPayment)).toBeNull();
  });

  it('fills from history, then from the paid transaction, and leaves an order with neither', async () => {
    run('--apply');
    expect(await dateOf(withHistory)).toEqual(HISTORY_AT);
    expect(await dateOf(withPayment)).toEqual(PAID_AT);
    expect(await dateOf(withNothing)).toBeNull();
  });

  it('a second run changes nothing', async () => {
    const out = run('--apply');
    expect(out).toContain(`tenant ${tenantId}: 1 without deliveryDate, filled 0, unresolved 1`);
    expect(await dateOf(withHistory)).toEqual(HISTORY_AT);
  });

  it('refuses to run in production without --allow-production', () => {
    expect(() =>
      execFileSync(path.join(__dirname, '../../../node_modules/.bin/ts-node'), ['scripts/backfill-digital-delivery-date.ts', '--apply'], {
        cwd: path.join(__dirname, '../../..'), env: { ...process.env, NODE_ENV: 'production' }, stdio: 'pipe',
      }),
    ).toThrow();
  });
});
