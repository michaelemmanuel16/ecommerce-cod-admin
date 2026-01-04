-- AlterTable
ALTER TABLE "form_upsells" ADD COLUMN     "discount_type" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "discount_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "original_price" DOUBLE PRECISION,
ADD COLUMN     "product_id" INTEGER;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "item_type" TEXT NOT NULL DEFAULT 'package',
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
CREATE INDEX "form_upsells_product_id_idx" ON "form_upsells"("product_id");

-- AddForeignKey
ALTER TABLE "form_upsells" ADD CONSTRAINT "form_upsells_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
