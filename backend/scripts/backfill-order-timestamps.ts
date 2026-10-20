import { PrismaClient } from '@prisma/client';
import { assertNotProduction, hasFlag, option } from './lib/scriptArgs';

// M1-T06 (COD-9). Fills the order lifecycle timestamps added in M1-T01 for old orders.
// Sources (first row wins; a field that already has a value is never touched; no source row = stays empty, never guessed):
//   confirmedAt (+ confirmedById) <- first order_history row 'confirmed'. confirmedById is the row's changed_by when
//                                    that id is a user; it is set only together with confirmedAt.
//   dispatchedAt   <- first 'out_for_delivery' row, else first 'delivered' row.
//   firstContactAt <- earliest calls.created_at for the order (every call has a rep: calls.sales_rep_id).
//   returnedAt     <- first 'returned' row, whatever the current status is (an order may have been returned, then moved on).
// Fills run for every order that has a source row. "Applies" only decides what is counted in the report: orders whose
// current status says the field should exist. The fill itself does not look at the current status.
// Set-based SQL, one transaction per tenant. It does not touch status, so the orders_status_version_bump trigger stays quiet.
// Idempotent. Plain PrismaClient on purpose: no tenant extension, so every tenant is visible.
// Dry run by default (writes nothing). Flags: --apply (write), --tenant <id> (one tenant only), --allow-production (needed when NODE_ENV=production).
const prisma = new PrismaClient();
const dryRun = !hasFlag('--apply');
const onlyTenant = option('--tenant');

// Plain `tenant_id = $1` so the tenant_id indexes work; a NULL tenant_id is its own group and takes no parameter.
const tenantWhere = (tenantId: string | null, column: string) => (tenantId === null ? `${column} IS NULL` : `${column} = $1`);
const tenantArgs = (tenantId: string | null) => (tenantId === null ? [] : [tenantId]);

const PAST_CONFIRMATION = ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'failed_delivery', 'returned'];
const WENT_OUT = ['out_for_delivery', 'delivered', 'failed_delivery', 'returned'];

interface Field {
  label: string;
  column: string;
  applies: string[]; // current statuses where the field should exist
  src: (scope: string) => string; // one row per order: order_id, ts (and by_id for confirmed); `scope` selects the tenant's order ids
  set: string; // SET clause; `s` is the source row
}

const FIELDS: Field[] = [
  {
    label: 'confirmedAt',
    column: 'confirmed_at',
    applies: PAST_CONFIRMATION,
    src: (scope) => `SELECT DISTINCT ON (h.order_id) h.order_id, h.created_at AS ts, u.id AS by_id
          FROM order_history h LEFT JOIN users u ON u.id = h.changed_by
          WHERE h.status = 'confirmed' AND h.order_id IN (${scope})
          ORDER BY h.order_id, h.created_at, h.id`,
    set: `confirmed_at = s.ts, confirmed_by_id = s.by_id`,
  },
  {
    label: 'dispatchedAt',
    column: 'dispatched_at',
    applies: WENT_OUT,
    // out_for_delivery sorts before delivered, so a delivered row is used only when there is no out_for_delivery row.
    src: (scope) => `SELECT DISTINCT ON (order_id) order_id, created_at AS ts
          FROM order_history
          WHERE status IN ('out_for_delivery', 'delivered') AND order_id IN (${scope})
          ORDER BY order_id, (status = 'delivered')::int, created_at, id`,
    set: `dispatched_at = s.ts`,
  },
  {
    label: 'firstContactAt',
    column: 'first_contact_at',
    applies: PAST_CONFIRMATION,
    src: (scope) => `SELECT order_id, MIN(created_at) AS ts
          FROM calls
          WHERE sales_rep_id IS NOT NULL AND order_id IN (${scope})
          GROUP BY order_id`,
    set: `first_contact_at = s.ts`,
  },
  {
    label: 'returnedAt',
    column: 'returned_at',
    applies: ['returned'],
    src: (scope) => `SELECT DISTINCT ON (order_id) order_id, created_at AS ts
          FROM order_history
          WHERE status = 'returned' AND order_id IN (${scope})
          ORDER BY order_id, created_at, id`,
    set: `returned_at = s.ts`,
  },
];

interface Counts { applies: number; already: number; filledApplies: number; filledAll: number; stillEmpty: number }
const zero = (): Counts => ({ applies: 0, already: 0, filledApplies: 0, filledAll: 0, stillEmpty: 0 });

async function main() {
  if (!assertNotProduction()) return;
  console.log(dryRun ? 'MODE: dry run (no writes; pass --apply to write)' : 'MODE: apply (writes)');

  const tenants = await prisma.$queryRawUnsafe<Array<{ tenant_id: string | null }>>(
    `SELECT DISTINCT tenant_id FROM orders ORDER BY tenant_id`,
  );
  const targets = tenants.map((t) => t.tenant_id).filter((id) => onlyTenant === undefined || id === onlyTenant);

  const totals = new Map<string, Counts>(FIELDS.map((f) => [f.label, zero()]));
  let totalOrders = 0;

  for (const tenantId of targets) {
    const result = await prisma.$transaction(
      async (tx) => {
        const [{ n }] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT COUNT(*)::int AS n FROM orders WHERE ${tenantWhere(tenantId, 'tenant_id')}`,
          ...tenantArgs(tenantId),
        );
        const perField = new Map<string, Counts>();
        const scope = `SELECT id FROM orders WHERE ${tenantWhere(tenantId, 'tenant_id')}`;
        for (const f of FIELDS) {
          const src = f.src(scope);
          const statuses = f.applies.map((s) => `'${s}'`).join(', ');
          const [r] = await tx.$queryRawUnsafe<Array<Record<string, number>>>(
            `SELECT
               COUNT(*) FILTER (WHERE o.status IN (${statuses}))::int AS applies,
               COUNT(*) FILTER (WHERE o.status IN (${statuses}) AND o.${f.column} IS NOT NULL)::int AS already,
               COUNT(*) FILTER (WHERE o.status IN (${statuses}) AND o.${f.column} IS NULL AND s.order_id IS NOT NULL)::int AS filled_applies,
               COUNT(*) FILTER (WHERE o.${f.column} IS NULL AND s.order_id IS NOT NULL)::int AS filled_all
             FROM orders o LEFT JOIN (${src}) s ON s.order_id = o.id
             WHERE ${tenantWhere(tenantId, 'o.tenant_id')}`,
            ...tenantArgs(tenantId),
          );
          if (!dryRun) {
            const updated = await tx.$executeRawUnsafe(
              `UPDATE orders o SET ${f.set} FROM (${src}) s
               WHERE s.order_id = o.id AND o.${f.column} IS NULL AND ${tenantWhere(tenantId, 'o.tenant_id')}`,
              ...tenantArgs(tenantId),
            );
            if (updated !== r.filled_all) throw new Error(`${f.label}: updated ${updated} rows, expected ${r.filled_all}`);
          }
          perField.set(f.label, {
            applies: r.applies,
            already: r.already,
            filledApplies: r.filled_applies,
            filledAll: r.filled_all,
            stillEmpty: r.applies - r.already - r.filled_applies,
          });
        }
        return { n, perField };
      },
      { timeout: 120000, maxWait: 30000 },
    );

    totalOrders += result.n;
    console.log(`tenant ${tenantId ?? 'NULL'}: ${result.n} orders`);
    for (const f of FIELDS) {
      const c = result.perField.get(f.label)!;
      console.log(`  ${f.label}: applies ${c.applies}, already set ${c.already}, ${dryRun ? 'would fill' : 'filled'} ${c.filledApplies}, still empty ${c.stillEmpty}` +
        (c.filledAll !== c.filledApplies ? ` (plus ${c.filledAll - c.filledApplies} ${dryRun ? 'would be ' : ''}filled on orders outside "applies")` : ''));
      const t = totals.get(f.label)!;
      t.applies += c.applies; t.already += c.already; t.filledApplies += c.filledApplies; t.filledAll += c.filledAll; t.stillEmpty += c.stillEmpty;
    }
  }

  console.log(`Total: ${totalOrders} orders in ${targets.length} tenant(s)`);
  for (const f of FIELDS) {
    const t = totals.get(f.label)!;
    console.log(`  ${f.label}: applies ${t.applies}, already set ${t.already}, ${dryRun ? 'would fill' : 'filled'} ${t.filledApplies}, still empty ${t.stillEmpty}, ${dryRun ? 'would fill' : 'filled'} in all ${t.filledAll}`);
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
