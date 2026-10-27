-- M5-T02 (COD-47): settlement, commission and finding schema. Additive only; existing fee rules get valid_from 2000-01-01.

-- CreateEnum
CREATE TYPE "FeeBasis" AS ENUM ('flat', 'percent');

-- CreateEnum
CREATE TYPE "DeliveryFeeSource" AS ENUM ('rule', 'settlement', 'manual');

-- CreateEnum
CREATE TYPE "CommissionKind" AS ENUM ('base', 'upsell', 'reward');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('pending', 'earned', 'paid', 'void', 'no_payout');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('matched', 'short', 'over', 'unmatched');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FindingType" ADD VALUE 'fee_rule_missing';
ALTER TYPE "FindingType" ADD VALUE 'unmatched_line';
ALTER TYPE "FindingType" ADD VALUE 'charge_variance';
ALTER TYPE "FindingType" ADD VALUE 'over_pay';
ALTER TYPE "FindingType" ADD VALUE 'excess_deposit';
ALTER TYPE "FindingType" ADD VALUE 'negative_cash_held';

-- AlterEnum
ALTER TYPE "FindingStatus" ADD VALUE 'written_off';

-- DropIndex
DROP INDEX "fee_rules_tenant_id_partner_user_id_outcome_key";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_fee" DECIMAL(19,4),
ADD COLUMN     "delivery_fee_source" "DeliveryFeeSource";

-- AlterTable
ALTER TABLE "agent_aging_buckets" ADD COLUMN     "bucket_0_3" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "bucket_15_plus" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "bucket_8_14" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "agent_collections" ADD COLUMN     "settlement_line_id" INTEGER;

-- AlterTable
ALTER TABLE "agent_deposits" ADD COLUMN     "reject_reason" TEXT,
ADD COLUMN     "settlement_id" INTEGER;

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "assignee_id" INTEGER,
ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "resolved_by_id" INTEGER;

-- AlterTable
ALTER TABLE "fee_rules" ADD COLUMN     "basis" "FeeBasis" NOT NULL DEFAULT 'flat',
ADD COLUMN     "created_by_id" INTEGER,
ADD COLUMN     "valid_from" DATE NOT NULL DEFAULT '2000-01-01';

-- Existing rules start on an early date so they stay valid; new rules must give a date.
ALTER TABLE "fee_rules" ALTER COLUMN "valid_from" DROP DEFAULT;

-- CreateTable
CREATE TABLE "partner_settlements" (
    "id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "payout_date" TIMESTAMP(3) NOT NULL,
    "payout_amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(3),
    "reference" TEXT NOT NULL,
    "expected_net" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "short_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "unapplied_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "deposit_id" INTEGER,
    "recorded_by_id" INTEGER,
    "notes" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "partner_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlement_lines" (
    "id" SERIAL NOT NULL,
    "settlement_id" INTEGER NOT NULL,
    "order_id" INTEGER,
    "external_order_ref" TEXT NOT NULL,
    "exp_amount" DECIMAL(19,4) NOT NULL,
    "charge" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "outcome" "FeeOutcome",
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "matched_by" TEXT,
    "note" TEXT,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "partner_settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_entries" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER,
    "user_id" INTEGER NOT NULL,
    "kind" "CommissionKind" NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(19,4) NOT NULL,
    "earned_at" TIMESTAMP(3),
    "journal_entry_id" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlements_deposit_id_key" ON "partner_settlements"("deposit_id");

-- CreateIndex
CREATE INDEX "partner_settlements_tenant_id_idx" ON "partner_settlements"("tenant_id");

-- CreateIndex
CREATE INDEX "partner_settlements_tenant_id_partner_id_payout_date_idx" ON "partner_settlements"("tenant_id", "partner_id", "payout_date");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlements_tenant_id_partner_id_reference_key" ON "partner_settlements"("tenant_id", "partner_id", "reference");

-- CreateIndex
CREATE INDEX "partner_settlement_lines_tenant_id_idx" ON "partner_settlement_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "partner_settlement_lines_settlement_id_idx" ON "partner_settlement_lines"("settlement_id");

-- CreateIndex
CREATE INDEX "partner_settlement_lines_order_id_idx" ON "partner_settlement_lines"("order_id");

-- CreateIndex
CREATE INDEX "commission_entries_tenant_id_idx" ON "commission_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "commission_entries_tenant_id_user_id_status_idx" ON "commission_entries"("tenant_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "commission_entries_order_id_idx" ON "commission_entries"("order_id");

-- CreateIndex
CREATE INDEX "agent_collections_settlement_line_id_idx" ON "agent_collections"("settlement_line_id");

-- CreateIndex
CREATE INDEX "agent_deposits_settlement_id_idx" ON "agent_deposits"("settlement_id");

-- CreateIndex
CREATE INDEX "findings_tenant_id_assignee_id_idx" ON "findings"("tenant_id", "assignee_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_rules_tenant_id_partner_user_id_outcome_valid_from_key" ON "fee_rules"("tenant_id", "partner_user_id", "outcome", "valid_from");

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_settlement_line_id_fkey" FOREIGN KEY ("settlement_line_id") REFERENCES "partner_settlement_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_deposits" ADD CONSTRAINT "agent_deposits_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "partner_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "agent_deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_settlement_lines" ADD CONSTRAINT "partner_settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "partner_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_lines" ADD CONSTRAINT "partner_settlement_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settlement_lines" ADD CONSTRAINT "partner_settlement_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
