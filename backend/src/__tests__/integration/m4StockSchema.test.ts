/**
 * M4-T01 / M4-T02 (COD-38): the stock and partner schema.
 * Partial unique index on active order_fulfillment rows, unique partner profile per user,
 * and the data step that fills old `arrived` shipments.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
const db = prismaBase;

beforeAll(async () => {
  pair = await createTwoTenants('m4schema');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('active order_fulfillment unique index', () => {
  const movement = (itemKey: string | null, extra: Record<string, unknown> = {}) => {
    const { a } = pair;
    return db.inventoryTransfer.create({
      data: {
        tenantId: a.id, productId: a.ids.product, orderId: a.ids.order, quantity: 1,
        transferType: 'order_fulfillment', createdById: a.users.admin.id, itemKey, ...extra,
      },
    });
  };

  it('rejects a second active fulfilment for the same order line, and allows it once the first is reversed', async () => {
    const first = await movement('line-1');
    await expect(movement('line-1')).rejects.toMatchObject({ code: 'P2002' });

    await db.inventoryTransfer.update({ where: { id: first.id }, data: { reversedAt: new Date() } });
    await expect(movement('line-1')).resolves.toMatchObject({ itemKey: 'line-1' });
    // that new row is the one active fulfilment now
    await expect(movement('line-1')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows another order line, and other movement types for the same key', async () => {
    await expect(movement('line-2')).resolves.toBeTruthy();
    await expect(movement('line-2', { transferType: 'order_reversal' })).resolves.toBeTruthy();
    await expect(movement('line-2', { transferType: 'order_reversal' })).resolves.toBeTruthy();
  });

  it('new rows read as received and new movement types exist', async () => {
    const row = await movement('line-3', { transferType: 'receipt' });
    expect(row.status).toBe('received');
    expect(row.reversedAt).toBeNull();
  });
});

describe('DeliveryPartnerProfile', () => {
  it('userId is unique', async () => {
    const { a } = pair;
    // the harness already seeded one profile for a.users.deliveryAgent
    await expect(
      db.deliveryPartnerProfile.create({ data: { tenantId: a.id, userId: a.users.deliveryAgent.id } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('has no coverage or fallback column', async () => {
    const cols = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'delivery_partner_profiles'`;
    const names = cols.map((c) => c.column_name);
    expect(names).toEqual(expect.arrayContaining(['user_id', 'days_to_pay', 'is_trial', 'data_source', 'base_town']));
    expect(names.filter((n) => /fallback|coverage/i.test(n))).toEqual([]);
  });
});

describe('old arrived shipments (data step of the stock migration)', () => {
  it('fills quantityCounted, shortQuantity and receivedAt and leaves the status and destination', async () => {
    const { a } = pair;
    const arrivedAt = new Date('2026-09-01T10:00:00Z');
    const row = await db.inventoryShipment.create({
      data: { tenantId: a.id, productId: a.ids.product, quantity: 300, status: 'arrived', arrivedAt, createdById: a.users.admin.id },
    });
    expect(row.quantityCounted).toBeNull();

    const sql = fs.readFileSync(
      path.join(__dirname, '../../../prisma/migrations/20261024090000_m4_stock_schema/migration.sql'), 'utf8');
    const update = sql.match(/UPDATE "inventory_shipments"[\s\S]*?;/)![0];
    expect(update).toContain(`WHERE "status" = 'arrived'`);
    await db.$executeRawUnsafe(update.replace(`WHERE "status" = 'arrived'`, `WHERE "status" = 'arrived' AND "id" = ${row.id}`));

    const after = await db.inventoryShipment.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.quantityCounted).toBe(300);
    expect(after.shortQuantity).toBe(0);
    expect(after.receivedAt).toEqual(arrivedAt);
    expect(after.status).toBe('arrived');
    expect(after.destinationLocationId).toBeNull();
    expect(after.claimStatus).toBe('none');
  });
});
