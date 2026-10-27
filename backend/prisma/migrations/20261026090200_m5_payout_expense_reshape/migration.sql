-- M5-T04 (COD-47): one payout record (F-913), expense source and ledger link (F-917), period notes (F-923).
-- Payout.rep_id becomes payee_id. Every old row is copied (payee_id = rep_id, kind = rep) before the old column is dropped.

-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('manual', 'meta', 'delivery_fee', 'ai');

-- CreateEnum
CREATE TYPE "ExpensePaidFrom" AS ENUM ('momo', 'bank', 'cash');

-- CreateEnum
CREATE TYPE "PayoutKind" AS ENUM ('rep', 'agent');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "journal_entry_id" INTEGER,
ADD COLUMN     "paid_from" "ExpensePaidFrom",
ADD COLUMN     "source" "ExpenseSource" NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN     "period_notes" JSONB;

-- AlterTable: new payout columns, copy, then tighten
ALTER TABLE "payouts" ADD COLUMN     "kind" "PayoutKind" NOT NULL DEFAULT 'rep',
ADD COLUMN     "payee_id" INTEGER,
ADD COLUMN     "recorded_by_id" INTEGER,
ADD COLUMN     "reference" TEXT;

UPDATE "payouts" SET "payee_id" = "rep_id", "kind" = 'rep';

ALTER TABLE "payouts" ALTER COLUMN "payee_id" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "payouts" DROP CONSTRAINT "payouts_rep_id_fkey";

-- DropIndex
DROP INDEX "payouts_rep_id_idx";

-- AlterTable
ALTER TABLE "payouts" DROP COLUMN "rep_id";

-- AlterTable
ALTER TABLE "commission_entries" ADD COLUMN     "payout_id" INTEGER;

-- CreateIndex
CREATE INDEX "expenses_journal_entry_id_idx" ON "expenses"("journal_entry_id");

-- CreateIndex
CREATE INDEX "payouts_payee_id_idx" ON "payouts"("payee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_tenant_id_payee_id_method_reference_key" ON "payouts"("tenant_id", "payee_id", "method", "reference");

-- CreateIndex
CREATE INDEX "commission_entries_payout_id_idx" ON "commission_entries"("payout_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_payee_id_fkey" FOREIGN KEY ("payee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
