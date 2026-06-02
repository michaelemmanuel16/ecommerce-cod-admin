-- MAN-66 follow-up: WebhookEvent.tenant_id backfill + NOT NULL flip.
-- The original 20260601190000_per_tenant_paystack migration only swapped the
-- unique index; this finishes the job so the cross-tenant guard (Postgres
-- treats NULL as distinct in unique indexes) can't be bypassed by legacy
-- null-tenant rows.

-- Step 1: backfill tenant_id from the related order via payment_reference.
-- WebhookEvent doesn't store orderId directly, but every paystack event has
-- a reference that the webhook handler writes back onto orders.payment_reference.
UPDATE "webhook_events" we
SET "tenant_id" = o."tenant_id"
FROM "orders" o
WHERE we."tenant_id" IS NULL
  AND we."reference" = o."payment_reference"
  AND o."tenant_id" IS NOT NULL;

-- Step 2: any remaining null rows pre-date tenant scoping (single-tenant
-- deploys) AND were never reconciled to an order. They can't be matched —
-- delete them so the NOT NULL flip succeeds. Replays of those references
-- against new per-tenant webhook URLs will land cleanly under the new tuple.
DELETE FROM "webhook_events" WHERE "tenant_id" IS NULL;

-- Step 3: enforce tenant_id on all future rows.
ALTER TABLE "webhook_events" ALTER COLUMN "tenant_id" SET NOT NULL;
