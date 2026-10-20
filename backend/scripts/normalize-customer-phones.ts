import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { normalizePhone } from '../src/utils/phone';
import { assertNotProduction, groupByTenant, hasFlag } from './lib/scriptArgs';

// M1-T05 (COD-9). Normalizes customers.phone_number and alternate_phone to E.164, per tenant.
//   npm run normalize:customer-phones                       dry run (default, writes nothing)
//   npm run normalize:customer-phones -- --apply            write
// phone_number rules:
//   - not parseable            -> left as is, counted "unparseable"
//   - already normalized       -> left as is, counted "unchanged"
//   - two or more customers of the same tenant share the normalized value (counting customers that
//     already hold it) -> collision: every row of that group keeps its old value and goes to the CSV report.
//     Nothing is merged.
//   - otherwise                -> updated
// alternate_phone has no unique index: normalized when parseable, else left alone (rows of a collision group are left fully unchanged).
// Idempotent: a second --apply changes 0 rows. Collision rows are reported again on every run.
// Plain PrismaClient on purpose: no tenant extension, so every tenant is visible; rows are grouped by tenant_id.
// Refuses to run when NODE_ENV=production unless --allow-production.
const prisma = new PrismaClient();
const apply = hasFlag('--apply');
const BATCH = 200;

interface Row {
  id: number;
  tenantId: string | null;
  phoneNumber: string;
  alternatePhone: string | null;
}

const csvCell = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function main() {
  if (!assertNotProduction()) return;
  console.log(apply ? 'MODE: apply (writes)' : 'MODE: dry run (no writes; pass --apply to write)');

  const customers: Row[] = await prisma.customer.findMany({
    select: { id: true, tenantId: true, phoneNumber: true, alternatePhone: true },
    orderBy: { id: 'asc' },
  });
  const orderCounts = new Map<number, number>();
  for (const g of await prisma.order.groupBy({ by: ['customerId'], _count: { _all: true } })) {
    orderCounts.set(g.customerId, g._count._all);
  }

  const totals = { customers: customers.length, changed: 0, unchanged: 0, unparseable: 0, collisionGroups: 0, collisionRows: 0, altChanged: 0 };
  const report: string[] = ['customer_id,tenant_id,phone,normalized,order_count'];

  for (const [tenantId, rows] of groupByTenant(customers)) {
    const normalized = new Map<number, string | null>(rows.map((r) => [r.id, normalizePhone(r.phoneNumber)]));
    // Group by the normalized value; a customer already holding it counts as a member.
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const n = normalized.get(r.id);
      if (n) groups.set(n, [...(groups.get(n) ?? []), r]);
    }

    const tenant = { changed: 0, unchanged: 0, unparseable: 0, collisionGroups: 0, collisionRows: 0, altChanged: 0 };
    tenant.collisionGroups = [...groups.values()].filter((members) => members.length > 1).length;
    const updates: Array<{ id: number; data: { phoneNumber?: string; alternatePhone?: string } }> = [];

    // Each row is classified once: unparseable, unchanged, collision (including a row already stored normalized) or update.
    for (const r of rows) {
      const n = normalized.get(r.id) ?? null;
      const inCollision = !!n && groups.get(n)!.length > 1;
      const data: { phoneNumber?: string; alternatePhone?: string } = {};
      if (!n) tenant.unparseable++;
      else if (inCollision) {
        tenant.collisionRows++;
        report.push([r.id, tenantId, r.phoneNumber, n, orderCounts.get(r.id) ?? 0].map(csvCell).join(','));
      } else if (n === r.phoneNumber) tenant.unchanged++;
      else {
        data.phoneNumber = n;
        tenant.changed++;
      }
      // Rows of a collision group stay fully unchanged, alternate phone included.
      const alt = r.alternatePhone && !inCollision ? normalizePhone(r.alternatePhone) : null;
      if (alt && alt !== r.alternatePhone) {
        data.alternatePhone = alt;
        tenant.altChanged++;
      }
      if (data.phoneNumber || data.alternatePhone) updates.push({ id: r.id, data });
    }

    if (apply) {
      for (let i = 0; i < updates.length; i += BATCH) {
        await prisma.$transaction(
          updates.slice(i, i + BATCH).map((u) => prisma.customer.update({ where: { id: u.id }, data: u.data }))
        );
      }
    }
    console.log(
      `tenant ${tenantId ?? 'NULL'}: ${rows.length} customers, ${apply ? 'changed' : 'would change'} ${tenant.changed}, unchanged ${tenant.unchanged}, ` +
        `unparseable ${tenant.unparseable}, collision groups ${tenant.collisionGroups} (${tenant.collisionRows} rows), alternate phones ${apply ? 'changed' : 'would change'} ${tenant.altChanged}`
    );
    for (const k of Object.keys(tenant) as Array<keyof typeof tenant>) totals[k] += tenant[k];
  }

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `phone-collisions-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(outFile, report.join('\n') + '\n');

  console.log(
    `Total: ${totals.customers} customers, ${apply ? 'changed' : 'would change'} ${totals.changed}, unchanged ${totals.unchanged}, unparseable ${totals.unparseable}, ` +
      `collision groups ${totals.collisionGroups}, collision rows ${totals.collisionRows}, alternate phones ${apply ? 'changed' : 'would change'} ${totals.altChanged}`
  );
  console.log(`Collision report: ${outFile}`);
}

main()
  .catch((err) => {
    console.error('Normalize failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
