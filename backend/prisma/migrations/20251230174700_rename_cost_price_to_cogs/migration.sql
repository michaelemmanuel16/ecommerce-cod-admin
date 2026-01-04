/*
  Warnings:

  - You are about to drop the column `cost_price` on the `products` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "products" DROP COLUMN "cost_price",
ADD COLUMN     "batch_quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "cogs" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "product_cost_entries" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'purchase',
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_cost_entries_product_id_idx" ON "product_cost_entries"("product_id");

-- AddForeignKey
ALTER TABLE "product_cost_entries" ADD CONSTRAINT "product_cost_entries_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
