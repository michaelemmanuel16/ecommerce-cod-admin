-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('draft', 'verified', 'approved', 'deposited', 'reconciled');

-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'agent_collection';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "total_collected" DECIMAL(19,4) NOT NULL DEFAULT 0;

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

    CONSTRAINT "agent_collections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_collections_order_id_key" ON "agent_collections"("order_id");

-- CreateIndex
CREATE INDEX "agent_collections_agent_id_idx" ON "agent_collections"("agent_id");

-- CreateIndex
CREATE INDEX "agent_collections_status_idx" ON "agent_collections"("status");

-- CreateIndex
CREATE INDEX "agent_collections_collection_date_idx" ON "agent_collections"("collection_date");

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
