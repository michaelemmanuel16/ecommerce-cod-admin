-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('whatsapp', 'sms');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('outbound', 'inbound');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');

-- CreateTable
CREATE TABLE "message_logs" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER,
    "customer_id" INTEGER,
    "channel" "MessageChannel" NOT NULL,
    "direction" "MessageDirection" NOT NULL DEFAULT 'outbound',
    "template_name" TEXT,
    "message_body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'pending',
    "provider_message_id" TEXT,
    "error_message" TEXT,
    "metadata" JSONB,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_logs_provider_message_id_key" ON "message_logs"("provider_message_id");

-- CreateIndex
CREATE INDEX "message_logs_order_id_idx" ON "message_logs"("order_id");

-- CreateIndex
CREATE INDEX "message_logs_customer_id_idx" ON "message_logs"("customer_id");

-- CreateIndex
CREATE INDEX "message_logs_channel_status_idx" ON "message_logs"("channel", "status");

-- CreateIndex
CREATE INDEX "message_logs_created_at_idx" ON "message_logs"("created_at");

-- CreateIndex
CREATE INDEX "message_logs_provider_message_id_idx" ON "message_logs"("provider_message_id");

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
