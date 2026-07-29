-- MAN-89: per-store billing email (plus-addressed alias of the owner's email,
-- e.g. owner+store-acme@x.com) so Paystack keys a DISTINCT customer per store.
-- Additive, nullable, no backfill — existing tenants keep NULL and bill to the
-- owner's plain email. Reverse = DROP COLUMN "billing_email".
ALTER TABLE "tenants" ADD COLUMN "billing_email" TEXT;
