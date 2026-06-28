-- Bulk email campaigns + per-campaign MessageLog linkage (MAN-83).
-- Additive only: a new table, one nullable column + FK on message_logs, and a
-- partial-unique index that enforces one send row per (campaign, customer) for
-- campaign sends without touching workflow/transactional logs (campaign_id NULL).

-- CreateEnum
CREATE TYPE "EmailCampaignStatus" AS ENUM ('queued', 'sending', 'completed');

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "EmailCampaignStatus" NOT NULL DEFAULT 'queued',
    "audience_total" INTEGER NOT NULL DEFAULT 0,
    "no_email_count" INTEGER NOT NULL DEFAULT 0,
    "opted_out_count" INTEGER NOT NULL DEFAULT 0,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_campaigns_tenant_id_idx" ON "email_campaigns"("tenant_id");

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: link MessageLog rows to a campaign
ALTER TABLE "message_logs" ADD COLUMN "campaign_id" INTEGER;

-- CreateIndex
CREATE INDEX "message_logs_campaign_id_idx" ON "message_logs"("campaign_id");

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Idempotency backstop: at most one send row per (campaign, customer). Partial so
-- it never constrains workflow/transactional logs (campaign_id IS NULL). Not
-- expressible in the Prisma schema, so it lives here only.
CREATE UNIQUE INDEX "message_logs_campaign_customer_key" ON "message_logs"("campaign_id", "customer_id") WHERE "campaign_id" IS NOT NULL;
