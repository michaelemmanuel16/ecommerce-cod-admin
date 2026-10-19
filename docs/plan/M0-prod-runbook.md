# M0 production runbook (M0-T33)

**Production is not changed by this task.** Everything here ran on a local scratch database restored from the read-only dump `backups/prod_readonly_20261020_0027.dump`. The commands below are for the owner to run later, at deploy time.

## What M0 ships to the database

One migration: `20261019233746_add_agent_collections_composite_indexes`. It holds two `CREATE INDEX IF NOT EXISTS` statements and nothing else:

- `agent_collections_agent_id_status_idx` on `(agent_id, status)`
- `agent_collections_status_collection_date_idx` on `(status, collection_date)`

The "11 pending migrations" from the old plan are already applied on production (88 applied, see `M0-schema-diff.md`). The `schema.prisma` fixes (foreign key update rule, index and default declarations, unique index name) change the schema file only. They send no SQL.

## Rehearsal result (local, restored production dump)

| Step | Result |
|---|---|
| Restore dump into empty scratch DB | 4.2 s. 15,787 orders, 5,276 agent_collections, 88 rows in `_prisma_migrations` |
| `prisma migrate status` before | 89 migrations found, 1 not applied (the new one) |
| `prisma migrate deploy` | Applied only the new migration. Exit 0. Wall time 0.5 s including Prisma start-up; the migration itself took 16 ms |
| `_prisma_migrations` after | 89 rows |
| `prisma migrate status` after | "Database schema is up to date!" |
| `prisma migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma --exit-code` | Exit 2. The only differences are the 3 accepted production-only leftovers on `webhook_configs` (`tenant_id` type `varchar(255)` instead of `text`, and the foreign key that depends on it). The duplicate index `idx_webhook_configs_tenant_id` is not shown by the diff. Nothing else differs |
| Rollback: `DROP INDEX` for both indexes | Worked. `agent_collections` went back to its 5 earlier indexes |

On an empty database the same diff exits 0 (see `M0-baseline.md`).

The index build lock is short: `CREATE INDEX` (not `CONCURRENTLY`) blocks writes to `agent_collections` for the build time. At 5,276 rows this was 16 ms. Run it at any time of day.

## Runbook

All commands run on the production host by the owner. Replace the container names if they differ.

### 1. Backup (never skip)

```bash
docker exec ecommerce-cod-postgres pg_dump -U <user> -Fc <db> > backups/prod_before_m0_$(date +%Y%m%d_%H%M).dump
ls -l backups/prod_before_m0_*.dump          # must be larger than 1 KB (an empty dump is a silent failure)
docker exec -i ecommerce-cod-postgres pg_restore -l < backups/prod_before_m0_<stamp>.dump | head   # must list tables
```

Stop if the file is 1 KB or smaller, or `pg_restore -l` lists nothing.

### 2. Apply

The deploy scripts now stop with a non-zero exit when `prisma migrate deploy` fails (M0-T32). Run the normal deploy, or by hand:

```bash
docker-compose -p production -f <compose file> exec -T backend npx prisma migrate deploy
```

Expected output: `Applying migration 20261019233746_add_agent_collections_composite_indexes` then `All migrations have been successfully applied.`

### 3. Verify

```bash
docker-compose ... exec -T backend npx prisma migrate status        # "Database schema is up to date!"
docker exec ecommerce-cod-postgres psql -U <user> -d <db> -tAc "select indexname from pg_indexes where tablename='agent_collections' order by 1"
```

The list must include both new index names. The schema diff against `prisma/schema.prisma` must show only the 3 accepted `webhook_configs` items (exit 2 is expected on production because of them).

### 4. Rollback

The only rollback is to drop the 2 new indexes. Nothing else changed.

```sql
DROP INDEX IF EXISTS "agent_collections_agent_id_status_idx";
DROP INDEX IF EXISTS "agent_collections_status_collection_date_idx";
```

Also delete the row for `20261019233746_add_agent_collections_composite_indexes` from `_prisma_migrations`, or Prisma will think it is still applied. The indexes only speed up queries, so leaving them in place is also safe if the application must be rolled back. A full restore from the step 1 dump is the last resort.

### Timing

About 1 minute of owner time for backup, 1 second for the migration, 1 minute to verify.
