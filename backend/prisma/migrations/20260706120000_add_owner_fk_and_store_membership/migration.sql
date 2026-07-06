-- MAN-86 (Migration A) — additive, equivalence-preserving foundation for
-- multi-store-per-login. Ships with the feature flag OFF: owners keep their
-- User.tenantId, so all existing single-store behavior is unchanged.
--
-- This migration ONLY adds structure and backfills it. It does NOT null any
-- owner's tenantId — that destructive step is MAN-86-B (see
-- prisma/migrations-manual/20260706120500_null_owner_tenant_id/), applied by
-- runbook at go-live behind MULTI_STORE_ENABLED.
--
-- Ordering (per MSL-C2/E6): add the owner FK → create the membership join →
-- backfill owner_user_id (deterministic MAN-85 tiebreak) → record each owner's
-- ORIGINAL tenantId on a default membership (the rollback source for MAN-86-B).

-- ── Structure ────────────────────────────────────────────────────────────────

-- AlterTable: denormalized single owner per store. onDelete=SET NULL keeps the
-- existing tenant-delete cascade working; MAN-87 upgrades it to RESTRICT once the
-- delete-account flow is redesigned to delete the owner row last.
ALTER TABLE "tenants" ADD COLUMN "owner_user_id" INTEGER;

-- CreateTable: one owner login ↔ many isolated stores.
CREATE TABLE "store_memberships" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_memberships_tenant_id_idx" ON "store_memberships"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_memberships_user_id_tenant_id_key" ON "store_memberships"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "tenants_owner_user_id_idx" ON "tenants"("owner_user_id");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill ─────────────────────────────────────────────────────────────────

-- Step 1: set each tenant's owner to its deterministic super_admin.
-- Canonical MAN-85 tiebreak: earliest created_at, then lowest id. DISTINCT ON
-- collapses co-founder setups to exactly one owner. Tenants with zero active
-- super_admins are intentionally left NULL (no eligible owner) — the owner reads
-- already tolerate a null owner, matching the legacy findFirst(...) => null.
UPDATE "tenants" AS t
SET "owner_user_id" = picked.id
FROM (
  SELECT DISTINCT ON (u."tenant_id") u."tenant_id", u."id"
  FROM "users" AS u
  WHERE u."role" = 'super_admin'
    AND u."is_active" = true
    AND u."tenant_id" IS NOT NULL
  ORDER BY u."tenant_id", u."created_at" ASC, u."id" ASC
) AS picked
WHERE t."id" = picked."tenant_id"
  AND t."owner_user_id" IS NULL;

-- Step 2: record each owner's ORIGINAL tenantId on a default membership. This is
-- the rollback source: MAN-86-B nulls the owner's User.tenantId, and rollback
-- repopulates it from this row. Re-runnable (ON CONFLICT DO NOTHING).
INSERT INTO "store_memberships" ("user_id", "tenant_id", "role", "is_default", "created_at", "updated_at")
SELECT t."owner_user_id", t."id", 'super_admin', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" AS t
WHERE t."owner_user_id" IS NOT NULL
ON CONFLICT ("user_id", "tenant_id") DO NOTHING;
