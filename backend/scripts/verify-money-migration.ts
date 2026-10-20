/**
 * M0-T26: proof for the money Decimal migration (M0-T21).
 *
 *   npx ts-node scripts/verify-money-migration.ts snapshot <file.json> [--url <database url>]
 *   npx ts-node scripts/verify-money-migration.ts compare  <file.json> [--url <database url>]
 *
 * snapshot: per converted column, writes count(*), count(col), sum, min, max to a JSON file.
 * compare:  reads a fresh snapshot, compares with the file, exits 1 if any sum, min or max
 *           differs by more than 0.0001 or any count differs. Else prints "zero difference" per table.
 *
 * Read only. Every value is read as col::numeric, so it works before (float, integer) and
 * after (Decimal) the migration. Default database: DATABASE_URL from backend/.env.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Prisma, PrismaClient } from '@prisma/client';

// Keep in sync with prisma/migrations/20261020150000_money_columns_to_decimal and
// scripts/rollback-money-decimal.sql.
export const MONEY_COLUMNS: Record<string, string[]> = {
  tenants: ['default_delivery_fee'],
  users: ['commission_amount', 'total_earnings'],
  customers: ['total_spent'],
  products: ['price'],
  orders: ['subtotal', 'shipping_cost', 'discount', 'total_amount', 'cod_amount', 'deposit_paid', 'balance_due'],
  order_items: ['unit_price', 'total_price'],
  transactions: ['amount'],
  expenses: ['amount'],
  form_packages: ['price', 'discount_value', 'original_price'],
  form_upsells: ['price', 'discount_value', 'original_price'],
  form_submissions: ['total_amount'],
  pending_checkouts: ['subtotal', 'shipping_cost', 'discount', 'total_amount', 'cod_amount', 'balance_due'],
  payouts: ['amount'],
  product_cost_entries: ['amount'],
};

// Intentionally tighter than the GL BALANCE_TOLERANCE (0.01): this checks a lossless migration.
const TOLERANCE = new Prisma.Decimal('0.0001');

interface ColumnStat {
  rows: string;
  nonNull: string;
  sum: string | null;
  min: string | null;
  max: string | null;
}
type Snapshot = Record<string, Record<string, ColumnStat>>;

async function takeSnapshot(prisma: PrismaClient): Promise<Snapshot> {
  const snap: Snapshot = {};
  for (const [table, cols] of Object.entries(MONEY_COLUMNS)) {
    snap[table] = {};
    for (const col of cols) {
      const sql =
        `SELECT count(*)::text AS rows, count("${col}")::text AS "nonNull", ` +
        `sum("${col}"::numeric)::text AS sum, min("${col}"::numeric)::text AS min, max("${col}"::numeric)::text AS max ` +
        `FROM "${table}"`;
      const [row] = await prisma.$queryRawUnsafe<ColumnStat[]>(sql);
      snap[table][col] = row;
    }
  }
  return snap;
}

function differs(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a !== b;
  return new Prisma.Decimal(a).minus(new Prisma.Decimal(b)).abs().gt(TOLERANCE);
}

function compareSnapshots(before: Snapshot, after: Snapshot): boolean {
  let ok = true;
  for (const [table, cols] of Object.entries(before)) {
    let tableOk = true;
    for (const [col, b] of Object.entries(cols)) {
      const a = after[table]?.[col];
      if (!a) {
        console.error(`MISSING ${table}.${col} in the new snapshot`);
        tableOk = false;
        continue;
      }
      const bad: string[] = [];
      if (a.rows !== b.rows) bad.push(`rows ${b.rows} -> ${a.rows}`);
      if (a.nonNull !== b.nonNull) bad.push(`non-null ${b.nonNull} -> ${a.nonNull}`);
      for (const k of ['sum', 'min', 'max'] as const) {
        if (differs(b[k], a[k])) bad.push(`${k} ${b[k]} -> ${a[k]}`);
      }
      if (bad.length) {
        console.error(`DIFFERENCE ${table}.${col}: ${bad.join('; ')}`);
        tableOk = false;
      }
    }
    if (tableOk) console.log(`${table}: zero difference`);
    else ok = false;
  }
  return ok;
}

async function main() {
  const [mode, file, ...rest] = process.argv.slice(2);
  const urlIdx = rest.indexOf('--url');
  const url = urlIdx >= 0 ? rest[urlIdx + 1] : process.env.DATABASE_URL;
  if (!['snapshot', 'compare'].includes(mode) || !file || !url) {
    console.error('Usage: verify-money-migration.ts <snapshot|compare> <file.json> [--url <database url>]');
    process.exit(2);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const snap = await takeSnapshot(prisma);
    if (mode === 'snapshot') {
      fs.writeFileSync(file, JSON.stringify(snap, null, 2));
      const cols = Object.values(snap).reduce((n, t) => n + Object.keys(t).length, 0);
      console.log(`snapshot written: ${file} (${Object.keys(snap).length} tables, ${cols} columns)`);
      return;
    }
    const before: Snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!compareSnapshots(before, snap)) {
      console.error('FAILED: at least one column differs by more than 0.0001');
      process.exit(1);
    }
    console.log('OK: zero difference in every table');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
