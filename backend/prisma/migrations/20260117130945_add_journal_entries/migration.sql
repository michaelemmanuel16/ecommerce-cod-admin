-- CreateEnum
CREATE TYPE "JournalSourceType" AS ENUM ('order_delivery', 'agent_deposit', 'expense', 'payout', 'manual', 'reversal');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "current_balance" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" SERIAL NOT NULL,
    "entry_number" TEXT NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "source_type" "JournalSourceType" NOT NULL,
    "source_id" INTEGER,
    "is_voided" BOOLEAN NOT NULL DEFAULT false,
    "voided_at" TIMESTAMP(3),
    "voided_by" INTEGER,
    "void_reason" TEXT,
    "reversing_entry_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_transactions" (
    "id" SERIAL NOT NULL,
    "journal_entry_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "debit_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_entry_number_key" ON "journal_entries"("entry_number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversing_entry_id_key" ON "journal_entries"("reversing_entry_id");

-- CreateIndex
CREATE INDEX "journal_entries_source_type_source_id_idx" ON "journal_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "journal_entries_entry_date_idx" ON "journal_entries"("entry_date");

-- CreateIndex
CREATE INDEX "journal_entries_created_at_idx" ON "journal_entries"("created_at");

-- CreateIndex
CREATE INDEX "journal_entries_is_voided_idx" ON "journal_entries"("is_voided");

-- CreateIndex
CREATE INDEX "journal_entries_source_type_source_id_is_voided_idx" ON "journal_entries"("source_type", "source_id", "is_voided");

-- CreateIndex
CREATE INDEX "account_transactions_journal_entry_id_idx" ON "account_transactions"("journal_entry_id");

-- CreateIndex
CREATE INDEX "account_transactions_account_id_idx" ON "account_transactions"("account_id");

-- CreateIndex
CREATE INDEX "account_transactions_account_id_created_at_idx" ON "account_transactions"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_deleted_at_status_idx" ON "orders"("deleted_at", "status");

-- CreateIndex
CREATE INDEX "orders_deleted_at_customer_id_idx" ON "orders"("deleted_at", "customer_id");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversing_entry_id_fkey" FOREIGN KEY ("reversing_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
