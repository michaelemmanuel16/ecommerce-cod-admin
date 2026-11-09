-- Migration: M7 Lead Conversion Schema (COD-63, M7-T01)
--
-- CallOutcome counts before migration (dev DB snapshot):
--   confirmed:     1417
--   rescheduled:    407
--   no_answer:      470
--   cancelled:      616
--   other:           44
--   not_reachable:  301
--   declined:       301
--   Total:         3556
--
-- CallOutcome mapping:
--   rescheduled   -> call_back_later (407)
--   no_answer     -> not_reachable   (470 + 301 = 771)
--   cancelled     -> declined        (616 + 301 = 917)
--   confirmed     -> confirmed       (1417)
--   other         -> other (legacy)  (44)
--   wrong_number  -> wrong_number    (0)
--   Total after:   3556 (no rows lost)
--
-- Verification query:
--   SELECT outcome, count(*) FROM calls GROUP BY outcome ORDER BY outcome;

-- CreateEnum
CREATE TYPE "CustomerRiskLevel" AS ENUM ('normal', 'high');

-- CreateEnum
CREATE TYPE "CustomerResponse" AS ENUM ('yes', 'no', 'change');

-- CreateEnum
CREATE TYPE "UpsellKind" AS ENUM ('package', 'addon');

-- CreateEnum
CREATE TYPE "UpsellStatus" AS ENUM ('active', 'void');

-- Create new CallOutcome enum and migrate calls.outcome
CREATE TYPE "CallOutcome_new" AS ENUM ('confirmed', 'not_reachable', 'call_back_later', 'declined', 'wrong_number', 'other');

ALTER TABLE "calls" ALTER COLUMN "outcome" TYPE "CallOutcome_new" USING (
  CASE "outcome"::text
    WHEN 'rescheduled' THEN 'call_back_later'::"CallOutcome_new"
    WHEN 'no_answer' THEN 'not_reachable'::"CallOutcome_new"
    WHEN 'cancelled' THEN 'declined'::"CallOutcome_new"
    WHEN 'confirmed' THEN 'confirmed'::"CallOutcome_new"
    WHEN 'not_reachable' THEN 'not_reachable'::"CallOutcome_new"
    WHEN 'declined' THEN 'declined'::"CallOutcome_new"
    ELSE 'other'::"CallOutcome_new"
  END
);

DROP TYPE "CallOutcome";
ALTER TYPE "CallOutcome_new" RENAME TO "CallOutcome";

-- AlterTable Customer
ALTER TABLE "customers" ADD COLUMN "cod_blocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cod_override" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cod_override_note" TEXT,
ADD COLUMN "cod_override_by_id" INTEGER,
ADD COLUMN "cod_override_at" TIMESTAMP(3),
ADD COLUMN "risk_level" "CustomerRiskLevel" NOT NULL DEFAULT 'normal',
ADD COLUMN "wrong_number" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable Order
ALTER TABLE "orders" ADD COLUMN "auto_confirm_sent_at" TIMESTAMP(3),
ADD COLUMN "customer_response" "CustomerResponse",
ADD COLUMN "said_no" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable SystemConfig
ALTER TABLE "system_config" ADD COLUMN "auto_confirm_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "auto_confirm_channel" TEXT NOT NULL DEFAULT 'whatsapp';

-- CreateTable UpsellLine
CREATE TABLE "upsell_lines" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "rep_id" INTEGER NOT NULL,
    "kind" "UpsellKind" NOT NULL,
    "source_id" INTEGER,
    "extra_value" DECIMAL(19,4) NOT NULL,
    "status" "UpsellStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "upsell_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable ConfirmToken
CREATE TABLE "confirm_tokens" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "response" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "confirm_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upsell_lines_tenant_id_idx" ON "upsell_lines"("tenant_id");
CREATE INDEX "upsell_lines_order_id_idx" ON "upsell_lines"("order_id");
CREATE INDEX "upsell_lines_rep_id_idx" ON "upsell_lines"("rep_id");

-- CreateIndex
CREATE UNIQUE INDEX "confirm_tokens_token_key" ON "confirm_tokens"("token");
CREATE INDEX "confirm_tokens_tenant_id_idx" ON "confirm_tokens"("tenant_id");
CREATE INDEX "confirm_tokens_order_id_idx" ON "confirm_tokens"("order_id");
CREATE INDEX "confirm_tokens_token_idx" ON "confirm_tokens"("token");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_cod_override_by_id_fkey" FOREIGN KEY ("cod_override_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upsell_lines" ADD CONSTRAINT "upsell_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "upsell_lines" ADD CONSTRAINT "upsell_lines_rep_id_fkey" FOREIGN KEY ("rep_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "upsell_lines" ADD CONSTRAINT "upsell_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "confirm_tokens" ADD CONSTRAINT "confirm_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "confirm_tokens" ADD CONSTRAINT "confirm_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
