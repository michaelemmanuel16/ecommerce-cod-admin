-- M1 (COD-9, M1-T01): order lifecycle columns, reasons, status_version and its trigger.
-- Additive only: new enums, new nullable or defaulted columns, new enum values, new indexes, one trigger. Nothing is dropped.
-- CallOutcome gets not_reachable and declined as values only. The rename of the old values and wrong_number land in M7.
-- The existing (status, delivery_date) index stays.
-- Undo: DROP TRIGGER orders_status_version_bump ON orders; DROP FUNCTION orders_status_version_bump();
--       then drop the new columns, indexes and enums. Enum values added to CallOutcome cannot be removed.

-- CreateEnum
CREATE TYPE "DeclineReason" AS ENUM ('price_too_high', 'prank_or_mistake', 'changed_mind', 'bought_elsewhere', 'wrong_number', 'other');

-- CreateEnum
CREATE TYPE "FailureReason" AS ENUM ('not_reachable', 'refused', 'wrong_address', 'rescheduled', 'other');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('user', 'system', 'integration', 'ai');

-- CreateEnum
CREATE TYPE "CallSource" AS ENUM ('manual', 'auto_confirm', 'tap_to_call');

-- AlterEnum
ALTER TYPE "CallOutcome" ADD VALUE 'not_reachable';
ALTER TYPE "CallOutcome" ADD VALUE 'declined';

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "callback_at" TIMESTAMP(3),
ADD COLUMN     "decline_reason" "DeclineReason",
ADD COLUMN     "source" "CallSource" NOT NULL DEFAULT 'manual',
ADD COLUMN     "started_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "order_history" ADD COLUMN     "actor_kind" "ActorKind",
ADD COLUMN     "forced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "from_status" "OrderStatus";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_by_id" INTEGER,
ADD COLUMN     "decline_reason" "DeclineReason",
ADD COLUMN     "dispatched_at" TIMESTAMP(3),
ADD COLUMN     "failure_reason" "FailureReason",
ADD COLUMN     "first_contact_at" TIMESTAMP(3),
ADD COLUMN     "next_attempt_date" TIMESTAMP(3),
ADD COLUMN     "returned_at" TIMESTAMP(3),
ADD COLUMN     "status_version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "orders_tenant_id_confirmed_at_idx" ON "orders"("tenant_id", "confirmed_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_dispatched_at_idx" ON "orders"("tenant_id", "dispatched_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_status_delivery_date_idx" ON "orders"("tenant_id", "status", "delivery_date");

-- CreateIndex
CREATE INDEX "orders_tenant_id_delivery_date_idx" ON "orders"("tenant_id", "delivery_date");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- orders.status_version is the optimistic lock for the order state machine (M1-T08).
-- This trigger raises it by 1 on every status change, including raw SQL updates that bypass the app.
-- The WHEN clause also requires NEW.status_version = OLD.status_version. If the app sets status_version
-- itself in the same UPDATE (to old + 1), the values differ, the trigger skips, and the bump is not counted twice.
CREATE OR REPLACE FUNCTION orders_status_version_bump() RETURNS trigger AS $$
BEGIN
  NEW.status_version := OLD.status_version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_status_version_bump
  BEFORE UPDATE ON "orders"
  FOR EACH ROW
  WHEN (NEW."status" IS DISTINCT FROM OLD."status" AND NEW."status_version" = OLD."status_version")
  EXECUTE FUNCTION orders_status_version_bump();
