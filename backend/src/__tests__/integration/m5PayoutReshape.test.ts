/**
 * M5-T04 (COD-47): the Payout reshape. The migration SQL runs on an old-shaped payouts table in a
 * scratch schema: every row is copied (payee_id = old rep_id, kind rep) and nothing is lost.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { migrationStatements } from './helpers/migrationSql';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

const SCHEMA = 'm5_payout_copy_test';
const statements = migrationStatements('20261026090200_m5_payout_expense_reshape');

let pair: TwoTenants;

beforeAll(async () => {
  pair = await createTwoTenants('m5payout');
}, 30000);

afterAll(async () => {
  await prismaBase.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('payout reshape migration', () => {
  it('copies every old payout row into the new shape with the same count and sum', async () => {
    await prismaBase.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prismaBase.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);

    const result = await prismaBase.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      // The tables the migration touches, in their M4 shape (only the columns it reads or constrains).
      for (const sql of [
        `CREATE TABLE tenants (id text PRIMARY KEY)`,
        `CREATE TABLE users (id serial PRIMARY KEY)`,
        `CREATE TABLE journal_entries (id serial PRIMARY KEY)`,
        `CREATE TABLE expenses (id serial PRIMARY KEY)`,
        `CREATE TABLE system_config (id serial PRIMARY KEY)`,
        `CREATE TABLE commission_entries (id serial PRIMARY KEY)`,
        `CREATE TABLE payouts (
           id serial PRIMARY KEY, rep_id integer NOT NULL, amount decimal(19,4) NOT NULL, method text NOT NULL,
           status text NOT NULL DEFAULT 'completed', payout_date timestamp NOT NULL DEFAULT now(), notes text,
           tenant_id text NOT NULL REFERENCES tenants(id),
           CONSTRAINT payouts_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES users(id))`,
        `CREATE INDEX payouts_rep_id_idx ON payouts(rep_id)`,
        `INSERT INTO tenants (id) VALUES ('t1'), ('t2')`,
        `INSERT INTO users DEFAULT VALUES`,
        `INSERT INTO users DEFAULT VALUES`,
        `INSERT INTO payouts (rep_id, amount, method, notes, tenant_id) VALUES
           (1, 1234.5678, 'cash', 'first', 't1'), (2, 20, 'momo', NULL, 't1'), (2, 0.0001, 'bank', 'tiny', 't2')`,
      ]) await tx.$executeRawUnsafe(sql);

      const [before] = await tx.$queryRawUnsafe<{ c: number; s: string }[]>(`SELECT count(*)::int c, sum(amount)::text s FROM payouts`);
      for (const sql of statements) await tx.$executeRawUnsafe(sql);
      const [after] = await tx.$queryRawUnsafe<{ c: number; s: string }[]>(`SELECT count(*)::int c, sum(amount)::text s FROM payouts`);
      const rows = await tx.$queryRawUnsafe<any[]>(`SELECT id, payee_id, kind::text kind, reference, recorded_by_id, notes, method FROM payouts ORDER BY id`);
      const repColumn = await tx.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'payouts' AND column_name = 'rep_id'`
      );
      return { before, after, rows, repColumn };
    });

    expect(result.before).toEqual({ c: 3, s: '1254.5679' });
    expect(result.after).toEqual(result.before);
    expect(result.rows.map((r) => [r.id, r.payee_id, r.kind, r.reference, r.recorded_by_id])).toEqual([
      [1, 1, 'rep', null, null],
      [2, 2, 'rep', null, null],
      [3, 2, 'rep', null, null],
    ]);
    expect(result.rows.map((r) => [r.notes, r.method])).toEqual([['first', 'cash'], [null, 'momo'], ['tiny', 'bank']]);
    expect(result.repColumn).toHaveLength(0);
  });

  it('the live table has payee_id, kind and reference and no rep_id', async () => {
    const cols = await prismaBase.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payouts'`
    );
    const names = cols.map((c) => c.column_name);
    expect(names).toEqual(expect.arrayContaining(['payee_id', 'kind', 'method', 'reference', 'recorded_by_id']));
    expect(names).not.toContain('rep_id');
  });
});

describe('M5 payout, expense and config fields', () => {
  it('a payout names its payee, kind and recorder, and a reference is unique per payee and method', async () => {
    const { a } = pair;
    const data = {
      tenantId: a.id, payeeId: a.users.salesRep.id, kind: 'rep' as const, amount: '50', method: 'momo',
      reference: 'MOMO-1', recordedById: a.users.admin.id,
    };
    const first = await prismaBase.payout.create({ data });
    expect(first.kind).toBe('rep');
    await expect(prismaBase.payout.create({ data })).rejects.toThrow();
    await expect(prismaBase.payout.create({ data: { ...data, method: 'bank' } })).resolves.toBeDefined();
    // two payouts with no reference (old rows) never clash
    const noRef = { ...data, reference: undefined };
    await prismaBase.payout.create({ data: noRef });
    await prismaBase.payout.create({ data: noRef });
  });

  it('an expense defaults to source manual and takes paidFrom; system config keeps period notes', async () => {
    const { a } = pair;
    const expense = await prismaBase.expense.create({
      data: { tenantId: a.id, category: 'Other', amount: '10', description: 'm5 test', expenseDate: new Date('2026-10-01'), paidFrom: 'momo' },
    });
    expect(expense.source).toBe('manual');
    expect(expense.paidFrom).toBe('momo');
    expect(expense.journalEntryId).toBeNull();

    const config = await prismaBase.systemConfig.upsert({
      where: { tenantId: a.id },
      create: { tenantId: a.id, periodNotes: { '2026-08': 'Booked with the older cost per set.' } },
      update: { periodNotes: { '2026-08': 'Booked with the older cost per set.' } },
    });
    expect(config.periodNotes).toEqual({ '2026-08': 'Booked with the older cost per set.' });
    await prismaBase.expense.delete({ where: { id: expense.id } });
  });
});
