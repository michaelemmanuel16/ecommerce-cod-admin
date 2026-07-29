# Manual (runbook-gated) migrations

SQL here is **NOT** part of Prisma's migration history and does **NOT** run on
`prisma migrate deploy`. Each is a destructive, go-live-gated step applied by
hand, with a paired `rollback.sql`.

## 20260706120500_null_owner_tenant_id (MAN-86-B)

Nulls each store owner's `users.tenant_id` so owners are reached via
`tenants.owner_user_id` + `store_memberships` instead of a single tenant row.
This is what actually "turns on" multi-store data-wise; it is deferred from
Migration A so the foundation ships at zero runtime risk.

**Preconditions**
1. Verified prod DB backup taken and restore-tested.
2. Migration A (`20260706120000_add_owner_fk_and_store_membership`) deployed.
3. `SELECT count(*) FROM tenants t WHERE t.owner_user_id IS NULL AND EXISTS
   (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.role='super_admin'
   AND u.is_active);` returns **0** (every eligible tenant has an owner).
4. Owner read-switch live (platformService reads `Tenant.ownerUser`).

**Apply (go-live)**
```bash
psql "$DATABASE_URL" -f forward.sql
# then set MULTI_STORE_ENABLED=true and restart the API
```

**Rollback**
```bash
psql "$DATABASE_URL" -f rollback.sql
# then set MULTI_STORE_ENABLED=false and restart the API
```

Rollback repopulates `tenant_id` from each owner's default `store_membership`
(written by Migration A), so the round-trip is lossless.
