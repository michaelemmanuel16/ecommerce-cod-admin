/**
 * M5-T10 (COD-49): the data migration that adds partner_payout_record to every existing Owner role. Safe to run twice,
 * leaves the Legacy MCP role and other roles alone.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { migrationStatements } from './helpers/migrationSql';
import { LEGACY_MCP_ROLE_NAME } from '../../config/defaultRoles';

const statements = migrationStatements('20261026150000_m5_owner_role_partner_payout_tool');
const run = async () => { for (const sql of statements) await prismaBase.$executeRawUnsafe(sql); };
const TOOL = 'partner_payout_record';
const OLD_14 = ['orders_search', 'financial_summary'];
let tenantId: string;
const toolsOf = async (name: string) => (await prismaBase.role.findFirstOrThrow({ where: { tenantId, name } })).tools as string[] | null;

beforeAll(async () => {
  tenantId = (await createTenant('Owner Tool')).id;
  await prismaBase.role.createMany({
    data: [
      { tenantId, name: 'Owner', tools: OLD_14 },
      { tenantId, name: LEGACY_MCP_ROLE_NAME, tools: OLD_14, isSystem: true },
      { tenantId, name: 'Finance clerk', tools: OLD_14 },
      { tenantId, name: 'Owner copy', tools: OLD_14 },
    ],
  });
  await prismaBase.$executeRawUnsafe(`INSERT INTO "roles" ("tenant_id","name","tools","updated_at") VALUES ('${tenantId}','Owner null tools', NULL, now())`);
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('owner role migration', () => {
  it('adds the tool to the Owner role only, and twice changes nothing more', async () => {
    await run();
    expect(await toolsOf('Owner')).toEqual([...OLD_14, TOOL]);
    expect(await toolsOf(LEGACY_MCP_ROLE_NAME)).toEqual(OLD_14);
    expect(await toolsOf('Finance clerk')).toEqual(OLD_14);
    expect(await toolsOf('Owner copy')).toEqual(OLD_14);
    expect(await toolsOf('Owner null tools')).toBeNull();
    await run();
    expect(await toolsOf('Owner')).toEqual([...OLD_14, TOOL]);
  });
});
