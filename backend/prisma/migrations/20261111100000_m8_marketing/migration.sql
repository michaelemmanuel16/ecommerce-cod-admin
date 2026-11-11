-- CreateEnum
CREATE TYPE "MetaConnectionStatus" AS ENUM ('connected', 'disconnected');

-- CreateEnum
CREATE TYPE "MetaSpendSource" AS ENUM ('api');

-- CreateEnum
CREATE TYPE "MetaMappingKind" AS ENUM ('prefix', 'campaign');

-- AlterEnum
ALTER TYPE "FindingType" ADD VALUE 'fx_missing';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "fx_rate" DECIMAL(19,8),
ADD COLUMN     "meta_ad_account_id" INTEGER,
ADD COLUMN     "original_amount" DECIMAL(19,4),
ADD COLUMN     "original_currency" VARCHAR(3);

-- CreateTable
CREATE TABLE "meta_ad_accounts" (
    "id" SERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "MetaConnectionStatus" NOT NULL DEFAULT 'connected',
    "status_reason" TEXT,
    "access_token" TEXT NOT NULL,
    "token_type" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connected_by_id" INTEGER,
    "last_pulled_at" TIMESTAMP(3),
    "last_pull_error" TEXT,
    "failed_pull_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "meta_ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_spend_days" (
    "id" SERIAL NOT NULL,
    "ad_account_id" INTEGER NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "campaign_name" TEXT NOT NULL,
    "campaign_status" TEXT,
    "date" DATE NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "spend" DECIMAL(19,4) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "link_clicks" INTEGER NOT NULL DEFAULT 0,
    "landing_page_views" INTEGER NOT NULL DEFAULT 0,
    "checkouts_started" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "pulled_at" TIMESTAMP(3) NOT NULL,
    "source" "MetaSpendSource" NOT NULL DEFAULT 'api',
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "meta_spend_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_campaign_mappings" (
    "id" SERIAL NOT NULL,
    "kind" "MetaMappingKind" NOT NULL,
    "prefix" TEXT,
    "ad_account_id" INTEGER,
    "campaign_id" TEXT,
    "product_id" INTEGER NOT NULL,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "meta_campaign_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_ad_accounts_tenant_id_idx" ON "meta_ad_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_ad_accounts_tenant_id_account_id_key" ON "meta_ad_accounts"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "meta_spend_days_tenant_id_idx" ON "meta_spend_days"("tenant_id");

-- CreateIndex
CREATE INDEX "meta_spend_days_tenant_id_date_idx" ON "meta_spend_days"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meta_spend_days_ad_account_id_campaign_id_date_key" ON "meta_spend_days"("ad_account_id", "campaign_id", "date");

-- CreateIndex
CREATE INDEX "meta_campaign_mappings_tenant_id_idx" ON "meta_campaign_mappings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_campaign_mappings_tenant_id_kind_prefix_key" ON "meta_campaign_mappings"("tenant_id", "kind", "prefix");

-- CreateIndex
CREATE UNIQUE INDEX "meta_campaign_mappings_tenant_id_ad_account_id_campaign_id_key" ON "meta_campaign_mappings"("tenant_id", "ad_account_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_meta_ad_account_id_expense_date_key" ON "expenses"("meta_ad_account_id", "expense_date");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_meta_ad_account_id_fkey" FOREIGN KEY ("meta_ad_account_id") REFERENCES "meta_ad_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ad_accounts" ADD CONSTRAINT "meta_ad_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meta_ad_accounts" ADD CONSTRAINT "meta_ad_accounts_connected_by_id_fkey" FOREIGN KEY ("connected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_spend_days" ADD CONSTRAINT "meta_spend_days_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meta_spend_days" ADD CONSTRAINT "meta_spend_days_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "meta_ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_campaign_mappings" ADD CONSTRAINT "meta_campaign_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meta_campaign_mappings" ADD CONSTRAINT "meta_campaign_mappings_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "meta_ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_campaign_mappings" ADD CONSTRAINT "meta_campaign_mappings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_campaign_mappings" ADD CONSTRAINT "meta_campaign_mappings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

