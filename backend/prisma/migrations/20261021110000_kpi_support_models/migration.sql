-- M1 (COD-9, M1-T02): minimal Target, Finding, FeeRule and FxRate models.
-- Additive only: new enums, new tables, indexes and foreign keys. Every table has a required tenant_id (FK to tenants, ON DELETE CASCADE).
-- Minimal shape from M1; extended in M5/M6.
-- targets.role_id has no foreign key yet: the Role table arrives in M2.
-- fx_rates is unique per (tenant, pair, date, source), so a manual override and the automatic rate of one day can both be stored.
-- Undo: DROP TABLE targets, findings, fee_rules, fx_rates; then drop the five enums.

-- CreateEnum
CREATE TYPE "TargetScope" AS ENUM ('north_star', 'quarter', 'month', 'role', 'person', 'daily');

-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('ledger_gap', 'stock_gap', 'short_pay', 'cash_gap', 'unpaid_term', 'repeat_refuser');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('open', 'explained', 'closed');

-- CreateEnum
CREATE TYPE "FeeOutcome" AS ENUM ('delivered', 'failed', 'returned');

-- CreateEnum
CREATE TYPE "FxSource" AS ENUM ('auto', 'manual');

-- CreateTable
CREATE TABLE "targets" (
    "id" SERIAL NOT NULL,
    "scope" "TargetScope" NOT NULL,
    "metric" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,
    "parent_id" INTEGER,
    "role_id" INTEGER,
    "user_id" INTEGER,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" SERIAL NOT NULL,
    "type" "FindingType" NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'open',
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "amount" DECIMAL(19,4),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rules" (
    "id" SERIAL NOT NULL,
    "partner_user_id" INTEGER NOT NULL,
    "outcome" "FeeOutcome" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" SERIAL NOT NULL,
    "from_currency" VARCHAR(3) NOT NULL,
    "to_currency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(19,8) NOT NULL,
    "date" DATE NOT NULL,
    "source" "FxSource" NOT NULL,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "targets_tenant_id_idx" ON "targets"("tenant_id");

-- CreateIndex
CREATE INDEX "targets_tenant_id_scope_period_start_idx" ON "targets"("tenant_id", "scope", "period_start");

-- CreateIndex
CREATE INDEX "findings_tenant_id_idx" ON "findings"("tenant_id");

-- CreateIndex
CREATE INDEX "findings_tenant_id_type_status_idx" ON "findings"("tenant_id", "type", "status");

-- CreateIndex
CREATE INDEX "findings_tenant_id_type_subject_type_subject_id_idx" ON "findings"("tenant_id", "type", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "fee_rules_tenant_id_idx" ON "fee_rules"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_rules_tenant_id_partner_user_id_outcome_key" ON "fee_rules"("tenant_id", "partner_user_id", "outcome");

-- CreateIndex
CREATE INDEX "fx_rates_tenant_id_idx" ON "fx_rates"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_tenant_id_from_currency_to_currency_date_source_key" ON "fx_rates"("tenant_id", "from_currency", "to_currency", "date", "source");

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_partner_user_id_fkey" FOREIGN KEY ("partner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
