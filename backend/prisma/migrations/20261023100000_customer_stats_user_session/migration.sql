-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "created_by_id" INTEGER,
ADD COLUMN     "delivered_orders" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "delivered_value" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "last_order_at" TIMESTAMP(3),
ADD COLUMN     "refused_orders" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "requires_manual_call" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN     "contact_person" TEXT,
ADD COLUMN     "support_whatsapp" TEXT,
ADD COLUMN     "time_zone" TEXT NOT NULL DEFAULT 'Africa/Accra';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "photo_url" TEXT;

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_label" TEXT,
    "ip" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_tenant_id_idx" ON "user_sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "customers_tenant_id_area_idx" ON "customers"("tenant_id", "area");

-- CreateIndex
CREATE INDEX "customers_tenant_id_refused_orders_idx" ON "customers"("tenant_id", "refused_orders");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
