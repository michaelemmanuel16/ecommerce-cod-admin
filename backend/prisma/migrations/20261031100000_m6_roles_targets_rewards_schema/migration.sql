-- M6-T01 (COD-56): reward tiers, badge awards, assignment cursors; role grid and invite fields; month-close reward key.
-- Additive only. No data changes (the role data migration is M6-T02).

-- AlterTable
ALTER TABLE "commission_entries" ADD COLUMN     "period" VARCHAR(7),
ADD COLUMN     "role_id" INTEGER;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "permissions" JSONB,
ADD COLUMN     "preset_role" "UserRole",
ADD COLUMN     "target_metric" TEXT;

-- AlterTable
ALTER TABLE "targets" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'auto';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "invite_expires_at" TIMESTAMP(3),
ADD COLUMN     "invite_token_hash" TEXT,
ADD COLUMN     "invited_at" TIMESTAMP(3),
ADD COLUMN     "rep_commission_override" DECIMAL(19,4);

-- CreateTable
CREATE TABLE "reward_tiers" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role_id" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "day_off" BOOLEAN NOT NULL DEFAULT false,
    "payout" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_awards" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_cursors" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reward_tiers_tenant_id_idx" ON "reward_tiers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_tiers_tenant_id_role_id_threshold_key" ON "reward_tiers"("tenant_id", "role_id", "threshold");

-- CreateIndex
CREATE INDEX "badge_awards_tenant_id_period_idx" ON "badge_awards"("tenant_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "badge_awards_tenant_id_user_id_key_period_key" ON "badge_awards"("tenant_id", "user_id", "key", "period");

-- CreateIndex
CREATE INDEX "assignment_cursors_tenant_id_idx" ON "assignment_cursors"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_cursors_tenant_id_scope_role_key" ON "assignment_cursors"("tenant_id", "scope", "role");

-- CreateIndex
CREATE UNIQUE INDEX "commission_entries_tenant_id_user_id_kind_period_role_id_key" ON "commission_entries"("tenant_id", "user_id", "kind", "period", "role_id");

-- CreateIndex
CREATE INDEX "role_assignments_holder_id_to_date_idx" ON "role_assignments"("holder_id", "to_date");

-- CreateIndex
CREATE INDEX "targets_role_id_idx" ON "targets"("role_id");

-- CreateIndex
CREATE INDEX "targets_user_id_idx" ON "targets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_invite_token_hash_key" ON "users"("invite_token_hash");

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_tiers" ADD CONSTRAINT "reward_tiers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reward_tiers" ADD CONSTRAINT "reward_tiers_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_cursors" ADD CONSTRAINT "assignment_cursors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

