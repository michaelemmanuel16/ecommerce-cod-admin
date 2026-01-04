-- AlterTable
ALTER TABLE "webhook_configs" ADD COLUMN "unique_url" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "webhook_configs" ADD COLUMN "product_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "webhook_configs_unique_url_key" ON "webhook_configs"("unique_url");

-- CreateIndex
CREATE INDEX "webhook_configs_product_id_idx" ON "webhook_configs"("product_id");

-- AddForeignKey
ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
