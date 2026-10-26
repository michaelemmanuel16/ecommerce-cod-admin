/**
 * M5-T03 (COD-47): chart of accounts for settlement and finance. The chart seed and the
 * migration SQL both add 2040, 2050, 3010, 5070 and 5080, run twice without duplicates,
 * relabel 1010, retire 1020 and 5040, and the migration stops on a clash.
 */
import { describe, it, expect, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { migrationStatements } from './helpers/migrationSql';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { DEFAULT_GL_ACCOUNTS, RETIRED_GL_CODES } from '../../config/glAccounts';

const MIGRATION = '20261026090100_m5_chart_of_accounts';
const tenantIds: string[] = [];

// The migration file is the source of truth. Run its statements the way migrate deploy does.
const statements = migrationStatements(MIGRATION);
const runMigration = async () => {
  for (const sql of statements) await prismaBase.$executeRawUnsafe(sql);
};

/** A tenant with the default chart, removed after the suite. */
const seededTenant = async (name: string) => {
  const t = await createTenant(name);
  tenantIds.push(t.id);
  await seedTenantDefaults(t.id);
  return t.id;
};

const accountsOf = (tenantId: string) => prismaBase.account.findMany({ where: { tenantId } });

// New codes the migration adds: the VALUES rows of its INSERT. Retired codes: the codes in its is_active = false UPDATE.
const sql = statements.join('\n');
const MIGRATION_NEW_CODES = [...sql.matchAll(/^\s*\('(\d{4})', '(?:[^']|'')+', '(?:liability|equity|expense|asset|revenue)'/gm)].map((m) => m[1]).sort();
const MIGRATION_RETIRED_CODES = [...sql.match(/code IN \(([^)]*)\) AND is_active/)![1].matchAll(/'(\d{4})'/g)].map((m) => m[1]).sort();
const NEW_CODES = MIGRATION_NEW_CODES;

afterAll(async () => {
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('chart config and migration agree', () => {
  it('the migration adds exactly the system accounts the config marks as new', () => {
    const configNew = DEFAULT_GL_ACCOUNTS.filter((a) => a.isSystem).map((a) => a.code).sort();
    expect(MIGRATION_NEW_CODES).toEqual(configNew);
  });

  it('the migration retires the config retired codes (2030 is only a stray-row guard)', () => {
    expect(MIGRATION_RETIRED_CODES.filter((c) => c !== '2030')).toEqual([...RETIRED_GL_CODES].sort());
  });
});

describe('chart seed', () => {
  it('seeding twice makes no duplicates and gives every tenant the five new accounts', async () => {
    const id = await seededTenant('Chart seed twice');
    const first = await accountsOf(id);
    await seedTenantDefaults(id);
    const second = await accountsOf(id);
    expect(second.map((a) => a.id).sort()).toEqual(first.map((a) => a.id).sort());
    expect(new Set(second.map((a) => a.code)).size).toBe(second.length);
    expect(NEW_CODES).toHaveLength(5);
    for (const code of NEW_CODES) {
      const a = second.find((x) => x.code === code)!;
      expect(a).toBeDefined();
      expect(a.isSystem).toBe(true);
      expect(a.isActive).toBe(true);
    }
    expect(second.find((a) => a.code === '3010')!.accountType).toBe('equity');
    expect(second.find((a) => a.code === '1010')!.name).toBe('Cash at bank and MoMo');
    for (const code of RETIRED_GL_CODES) expect(second.find((a) => a.code === code)!.isActive).toBe(false);
    expect(second.find((a) => a.code === '2030')).toBeUndefined();
  });
});

describe('chart migration SQL', () => {
  it('fills a tenant that lacks the new accounts, relabels 1010, retires 1020 and 5040, and is safe to run twice', async () => {
    const id = await seededTenant('Chart migration');
    await prismaBase.account.deleteMany({ where: { tenantId: id, code: { in: NEW_CODES } } });
    await prismaBase.account.updateMany({ where: { tenantId: id, code: { in: [...RETIRED_GL_CODES] } }, data: { isActive: true } });
    await prismaBase.account.updateMany({ where: { tenantId: id, code: '1010' }, data: { name: 'Cash in Hand' } });

    await runMigration();
    const first = await accountsOf(id);
    for (const code of NEW_CODES) expect(first.filter((a) => a.code === code)).toHaveLength(1);
    expect(first.find((a) => a.code === '1010')!.name).toBe('Cash at bank and MoMo');
    for (const code of RETIRED_GL_CODES) expect(first.find((a) => a.code === code)!.isActive).toBe(false);

    await runMigration();
    expect((await accountsOf(id)).map((a) => a.id).sort()).toEqual(first.map((a) => a.id).sort());
  });

  it('keeps a 1010 name the owner changed', async () => {
    const id = await seededTenant('Chart custom name');
    await prismaBase.account.updateMany({ where: { tenantId: id, code: '1010' }, data: { name: 'Petty cash' } });
    await runMigration();
    expect((await accountsOf(id)).find((a) => a.code === '1010')!.name).toBe('Petty cash');
  });

  it('stops with the list when a manual account already uses a new code, and writes nothing', async () => {
    const id = await seededTenant('Chart clash');
    await prismaBase.account.deleteMany({ where: { tenantId: id, code: { in: ['2040', '5080'] } } });
    await prismaBase.account.create({
      data: { tenantId: id, code: '2040', name: 'My own 2040', accountType: 'liability', normalBalance: 'credit' },
    });

    await expect(runMigration()).rejects.toThrow(/M5-T03 stopped[\s\S]*2040 "My own 2040"/);
    expect(await prismaBase.account.count({ where: { tenantId: id, code: '5080' } })).toBe(0);

    await prismaBase.account.deleteMany({ where: { tenantId: id, code: '2040' } });
    await runMigration();
    expect(await prismaBase.account.count({ where: { tenantId: id, code: { in: NEW_CODES } } })).toBe(5);
  });
});

describe('GET /api/gl/accounts', () => {
  it('keeps its shape and lists the live codes', async () => {
    const id = await seededTenant('Chart api');
    const admin = await mkUser(id, 'chartadmin', 'admin');
    const res = await request(app).get('/api/gl/accounts?limit=100').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const codes = res.body.accounts.map((a: any) => a.code);
    for (const code of NEW_CODES) expect(codes).toContain(code);
    expect(Object.keys(res.body.accounts[0]).sort()).toEqual(expect.arrayContaining(
      ['id', 'code', 'name', 'accountType', 'normalBalance', 'isActive', 'isSystem', 'currentBalance']
    ));
  });
});
