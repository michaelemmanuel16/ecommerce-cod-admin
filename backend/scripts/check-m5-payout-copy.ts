import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { assertNotProduction, option } from './lib/scriptArgs';

// M5-T04 (COD-47). Proves the Payout reshape lost nothing: Payout.rep_id became payee_id.
//   snapshot --file <path>   run BEFORE migration 20261026090200: saves count, sum and every row (id, rep_id, amount, tenant)
//   verify   --file <path>   run AFTER it: compares count, sum and each row (payee_id must equal the old rep_id, kind = rep)
// Reads with raw SQL on purpose: the Prisma model only knows the shape of the current schema. Writes nothing to the database.
// Exit code 1 when anything differs.

type Row = { id: number; person: number; amount: string; tenantId: string; kind: string | null };
type Snapshot = { takenAt: string; sum: string; rows: Row[] };

const prisma = new PrismaClient();

// The old table has no kind column; select NULL there so one query serves both shapes.
async function readRows(personColumn: 'rep_id' | 'payee_id'): Promise<Row[]> {
  const kind = personColumn === 'payee_id' ? 'kind::text' : 'NULL';
  const rows = await prisma.$queryRawUnsafe<{ id: number; person: number; amount: string; tenant_id: string; kind: string | null }[]>(
    `SELECT id, ${personColumn} AS person, amount::text AS amount, tenant_id, ${kind} AS kind FROM payouts ORDER BY id`
  );
  return rows.map((r) => ({ id: r.id, person: r.person, amount: r.amount, tenantId: r.tenant_id, kind: r.kind }));
}

// Summed by Postgres so the Decimal(19,4) value is exact.
const totalOf = async () => {
  const [t] = await prisma.$queryRawUnsafe<{ s: string }[]>(`SELECT coalesce(sum(amount), 0)::text AS s FROM payouts`);
  return t.s;
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
    const snap: Snapshot = { takenAt: new Date().toISOString(), sum: await totalOf(), rows };
    fs.writeFileSync(file, JSON.stringify(snap, null, 2));
    console.log(`Before: ${rows.length} payout rows, sum ${snap.sum}. Saved to ${file}`);
    return;
  }

  const before: Snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = await readRows('payee_id');
  const afterSum = await totalOf();
  console.log(`Before: ${before.rows.length} rows, sum ${before.sum}`);
  console.log(`After:  ${rows.length} rows, sum ${afterSum}`);

  const problems: string[] = [];
  if (before.rows.length !== rows.length) problems.push(`row count ${before.rows.length} -> ${rows.length}`);
  if (before.sum !== afterSum) problems.push(`sum ${before.sum} -> ${afterSum}`);
  const notRep = rows.filter((r) => r.kind !== 'rep');
  if (notRep.length > 0) problems.push(`${notRep.length} copied row(s) are not kind rep`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const old of before.rows) {
    const now = byId.get(old.id);
    if (!now) problems.push(`payout ${old.id} is missing`);
    else if (now.person !== old.person || now.amount !== old.amount || now.tenantId !== old.tenantId) {
      problems.push(`payout ${old.id} changed: ${JSON.stringify({ ...old, kind: undefined })} -> ${JSON.stringify({ ...now, kind: undefined })}`);
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
