/**
 * M5-T03 (COD-47): chart of accounts for settlement and finance. The chart seed and the
 * migration SQL both add 2040, 2050, 3010, 5070 and 5080, run twice without duplicates,
 * relabel 1010, retire 1020 and 5040, and the migration stops on a clash.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { migrationStatements } from './helpers/migrationSql';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { DEFAULT_GL_ACCOUNTS, GL_ACCOUNTS } from '../../config/glAccounts';

const NEW_CODES = ['2040', '2050', '3010', '5070', '5080'];
const tenantIds: string[] = [];
let pair: TwoTenants;

// The migration file is the source of truth. Run its statements the way migrate deploy does.
const statements = migrationStatements('20261026090100_m5_chart_of_accounts');
const runMigration = async () => {
  for (const sql of statements) await prismaBase.$executeRawUnsafe(sql);
};

beforeAll(async () => {
  pair = await createTwoTenants('m5chart');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

const codesOf = async (tenantId: string) =>
  (await prismaBase.account.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }));

describe('chart seed', () => {
  it('holds 21 accounts, one per GL_ACCOUNTS code', () => {
    expect(DEFAULT_GL_ACCOUNTS).toHaveLength(21);
    expect(new Set(DEFAULT_GL_ACCOUNTS.map((a) => a.code))).toEqual(new Set(Object.values(GL_ACCOUNTS)));
  });

  it('seeding twice makes no duplicates and gives every tenant the five new accounts', async () => {
    const t = await createTenant('Chart seed twice');
    tenantIds.push(t.id);
    await seedTenantDefaults(t.id);
    const first = await codesOf(t.id);
    await seedTenantDefaults(t.id);
    const second = await codesOf(t.id);
    expect(second.map((a) => a.id)).toEqual(first.map((a) => a.id));
    expect(new Set(second.map((a) => a.code)).size).toBe(second.length);
    for (const code of NEW_CODES) {
      const a = second.find((x) => x.code === code)!;
      expect(a).toBeDefined();
      expect(a.isSystem).toBe(true);
      expect(a.isActive).toBe(true);
    }
    expect(second.find((a) => a.code === '3010')!.accountType).toBe('equity');
    expect(second.find((a) => a.code === '1010')!.name).toBe('Cash at bank and MoMo');
    expect(second.find((a) => a.code === '1020')!.isActive).toBe(false);
    expect(second.find((a) => a.code === '5040')!.isActive).toBe(false);
    expect(second.find((a) => a.code === '2030')).toBeUndefined();
  });
});

describe('chart migration SQL', () => {
  it('fills a tenant that lacks the new accounts, relabels 1010, retires 1020 and 5040, and is safe to run twice', async () => {
    const t = await createTenant('Chart migration');
    tenantIds.push(t.id);
    await seedTenantDefaults(t.id);
    await prismaBase.account.deleteMany({ where: { tenantId: t.id, code: { in: NEW_CODES } } });
    await prismaBase.account.updateMany({ where: { tenantId: t.id, code: { in: ['1020', '5040'] } }, data: { isActive: true } });
    await prismaBase.account.updateMany({ where: { tenantId: t.id, code: '1010' }, data: { name: 'Cash in Hand' } });

    await runMigration();
    const first = await codesOf(t.id);
    for (const code of NEW_CODES) expect(first.filter((a) => a.code === code)).toHaveLength(1);
    expect(first.find((a) => a.code === '1010')!.name).toBe('Cash at bank and MoMo');
    expect(first.find((a) => a.code === '1020')!.isActive).toBe(false);
    expect(first.find((a) => a.code === '5040')!.isActive).toBe(false);

    await runMigration();
    expect((await codesOf(t.id)).map((a) => a.id)).toEqual(first.map((a) => a.id));
  });

  it('keeps a 1010 name the owner changed', async () => {
    const t = await createTenant('Chart custom name');
    tenantIds.push(t.id);
    await seedTenantDefaults(t.id);
    await prismaBase.account.updateMany({ where: { tenantId: t.id, code: '1010' }, data: { name: 'Petty cash' } });
    await runMigration();
    expect((await codesOf(t.id)).find((a) => a.code === '1010')!.name).toBe('Petty cash');
  });

  it('stops with the list when a manual account already uses a new code, and writes nothing', async () => {
    const t = await createTenant('Chart clash');
    tenantIds.push(t.id);
    await seedTenantDefaults(t.id);
    await prismaBase.account.deleteMany({ where: { tenantId: t.id, code: '2040' } });
    await prismaBase.account.create({
      data: { tenantId: t.id, code: '2040', name: 'My own 2040', accountType: 'liability', normalBalance: 'credit' },
    });
    await prismaBase.account.deleteMany({ where: { tenantId: t.id, code: '5080' } });

    await expect(runMigration()).rejects.toThrow(/M5-T03 stopped[\s\S]*2040 "My own 2040"/);
    expect(await prismaBase.account.count({ where: { tenantId: t.id, code: '5080' } })).toBe(0);

    await prismaBase.account.deleteMany({ where: { tenantId: t.id, code: '2040' } });
    await runMigration();
    expect(await prismaBase.account.count({ where: { tenantId: t.id, code: { in: NEW_CODES } } })).toBe(5);
  });
});

describe('GET /api/gl/accounts', () => {
  it('keeps its shape and lists the live codes', async () => {
    const res = await request(app)
      .get('/api/gl/accounts?limit=100')
      .set('Authorization', `Bearer ${pair.a.users.admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    const codes = res.body.accounts.map((a: any) => a.code);
    for (const code of NEW_CODES) expect(codes).toContain(code);
    expect(Object.keys(res.body.accounts[0]).sort()).toEqual(expect.arrayContaining(
      ['id', 'code', 'name', 'accountType', 'normalBalance', 'isActive', 'isSystem', 'currentBalance']
    ));
  });
});
