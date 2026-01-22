/*
  Warnings:

  - You are about to alter the column `cogs` on the `products` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to drop the column `commission_rate` on the `users` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('draft', 'verified', 'approved', 'deposited', 'reconciled');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "JournalSourceType" AS ENUM ('order_delivery', 'agent_deposit', 'expense', 'payout', 'manual', 'reversal', 'order_return', 'agent_collection');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "current_balance" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "gl_journal_entry_id" INTEGER,
ADD COLUMN     "revenue_recognized" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "cogs" DROP NOT NULL,
ALTER COLUMN "cogs" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "users" DROP COLUMN "commission_rate",
ADD COLUMN     "commission_amount" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "total_collected" DECIMAL(19,4) NOT NULL DEFAULT 0;

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

-- CreateTable
CREATE TABLE "agent_aging_buckets" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "bucket_0_1" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "bucket_2_3" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "bucket_4_7" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "bucket_8_plus" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "oldest_collection_date" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_aging_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_balances" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "total_collected" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_deposited" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "current_balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "last_settlement_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "block_reason" TEXT,
    "blocked_at" TIMESTAMP(3),
    "blocked_by_id" INTEGER,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "agent_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_collections" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "status" "CollectionStatus" NOT NULL DEFAULT 'draft',
    "collection_date" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" INTEGER,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "allocated_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,

    CONSTRAINT "agent_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_deposits" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'pending',
    "deposit_date" TIMESTAMP(3) NOT NULL,
    "reference_number" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deposit_method" TEXT NOT NULL,

    CONSTRAINT "agent_deposits_pkey" PRIMARY KEY ("id")
);

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

-- CreateIndex
CREATE INDEX "account_transactions_account_id_created_at_idx" ON "account_transactions"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "account_transactions_account_id_idx" ON "account_transactions"("account_id");

-- CreateIndex
CREATE INDEX "account_transactions_journal_entry_id_idx" ON "account_transactions"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_aging_buckets_agent_id_key" ON "agent_aging_buckets"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_balances_agent_id_key" ON "agent_balances"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_collections_order_id_key" ON "agent_collections"("order_id");

-- CreateIndex
CREATE INDEX "agent_collections_agent_id_idx" ON "agent_collections"("agent_id");

-- CreateIndex
CREATE INDEX "agent_collections_collection_date_idx" ON "agent_collections"("collection_date");

-- CreateIndex
CREATE INDEX "agent_collections_status_idx" ON "agent_collections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_deposits_reference_number_key" ON "agent_deposits"("reference_number");

-- CreateIndex
CREATE INDEX "agent_deposits_agent_id_deposit_date_idx" ON "agent_deposits"("agent_id", "deposit_date");

-- CreateIndex
CREATE INDEX "agent_deposits_agent_id_idx" ON "agent_deposits"("agent_id");

-- CreateIndex
CREATE INDEX "agent_deposits_deposit_date_idx" ON "agent_deposits"("deposit_date");

-- CreateIndex
CREATE INDEX "agent_deposits_status_idx" ON "agent_deposits"("status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_entry_number_key" ON "journal_entries"("entry_number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversing_entry_id_key" ON "journal_entries"("reversing_entry_id");

-- CreateIndex
CREATE INDEX "journal_entries_created_at_idx" ON "journal_entries"("created_at");

-- CreateIndex
CREATE INDEX "journal_entries_entry_date_idx" ON "journal_entries"("entry_date");

-- CreateIndex
CREATE INDEX "journal_entries_is_voided_idx" ON "journal_entries"("is_voided");

-- CreateIndex
CREATE INDEX "journal_entries_source_type_source_id_idx" ON "journal_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "journal_entries_source_type_source_id_is_voided_idx" ON "journal_entries"("source_type", "source_id", "is_voided");

-- CreateIndex
CREATE INDEX "orders_deleted_at_customer_id_idx" ON "orders"("deleted_at", "customer_id");

-- CreateIndex
CREATE INDEX "orders_deleted_at_status_idx" ON "orders"("deleted_at", "status");

-- CreateIndex
CREATE INDEX "orders_gl_journal_entry_id_idx" ON "orders"("gl_journal_entry_id");

-- CreateIndex
CREATE INDEX "orders_revenue_recognized_idx" ON "orders"("revenue_recognized");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_gl_journal_entry_id_fkey" FOREIGN KEY ("gl_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_aging_buckets" ADD CONSTRAINT "agent_aging_buckets_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_balances" ADD CONSTRAINT "agent_balances_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_balances" ADD CONSTRAINT "agent_balances_blocked_by_id_fkey" FOREIGN KEY ("blocked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_deposits" ADD CONSTRAINT "agent_deposits_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_deposits" ADD CONSTRAINT "agent_deposits_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversing_entry_id_fkey" FOREIGN KEY ("reversing_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
