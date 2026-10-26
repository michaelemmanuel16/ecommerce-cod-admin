import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { assertNotProduction, option } from './lib/scriptArgs';

// M5-T04 (COD-47). Proves the Payout reshape lost nothing: Payout.rep_id became payee_id.
//   snapshot --file <path>   run BEFORE migration 20261026090200: saves count, sum and every row (id, rep_id, amount, tenant)
//   verify   --file <path>   run AFTER it: compares count, sum and each row (payee_id must equal the old rep_id, kind = rep)
// Reads with raw SQL on purpose: the Prisma model only knows the shape of the current schema. Writes nothing to the database.
// Exit code 1 when anything differs.

type Row = { id: number; person: number; amount: string; tenantId: string };
type Snapshot = { takenAt: string; count: number; sum: string; rows: Row[] };

const prisma = new PrismaClient();

async function readRows(personColumn: 'rep_id' | 'payee_id'): Promise<Row[]> {
  const rows = await prisma.$queryRawUnsafe<{ id: number; person: number; amount: string; tenant_id: string; kind?: string }[]>(
    `SELECT id, ${personColumn} AS person, amount::text AS amount, tenant_id${personColumn === 'payee_id' ? ', kind::text AS kind' : ''} FROM payouts ORDER BY id`
  );
  if (personColumn === 'payee_id') {
    const notRep = rows.filter((r) => r.kind !== 'rep');
    if (notRep.length > 0) throw new Error(`Copied rows must have kind rep, found ${notRep.length} that do not`);
  }
  return rows.map((r) => ({ id: r.id, person: r.person, amount: r.amount, tenantId: r.tenant_id }));
}

// Summed by Postgres so the Decimal(19,4) value is exact.
const totalOf = async () => {
  const [t] = await prisma.$queryRawUnsafe<{ c: number; s: string }[]>(`SELECT count(*)::int AS c, coalesce(sum(amount), 0)::text AS s FROM payouts`);
  return { count: t.c, sum: t.s };
};

async function main() {
  if (!assertNotProduction()) return;
  const mode = process.argv[2];
  const file = option('--file');
  if (!file || (mode !== 'snapshot' && mode !== 'verify')) {
    console.error('Usage: ts-node scripts/check-m5-payout-copy.ts <snapshot|verify> --file <path>');
    process.exitCode = 1;
    return;
  }

  if (mode === 'snapshot') {
    const rows = await readRows('rep_id');
    const total = await totalOf();
    const snap: Snapshot = { takenAt: new Date().toISOString(), count: total.count, sum: total.sum, rows };
    fs.writeFileSync(file, JSON.stringify(snap, null, 2));
    console.log(`Before: ${snap.count} payout rows, sum ${snap.sum}. Saved to ${file}`);
    return;
  }

  const before: Snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = await readRows('payee_id');
  const after = await totalOf();
  console.log(`Before: ${before.count} rows, sum ${before.sum}`);
  console.log(`After:  ${after.count} rows, sum ${after.sum}`);

  const problems: string[] = [];
  if (before.count !== after.count) problems.push(`row count ${before.count} -> ${after.count}`);
  if (before.sum !== after.sum) problems.push(`sum ${before.sum} -> ${after.sum}`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const old of before.rows) {
    const now = byId.get(old.id);
    if (!now) problems.push(`payout ${old.id} is missing`);
    else if (now.person !== old.person || now.amount !== old.amount || now.tenantId !== old.tenantId) {
      problems.push(`payout ${old.id} changed: ${JSON.stringify(old)} -> ${JSON.stringify(now)}`);
    }
  }
  if (problems.length > 0) {
    console.error(`FAIL: ${problems.length} difference(s)\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('PASS: row count, sum and every row (payee_id = old rep_id) match.');
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
