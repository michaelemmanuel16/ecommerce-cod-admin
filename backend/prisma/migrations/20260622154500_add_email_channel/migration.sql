-- MAN-77: Email channel prerequisites (additive only).
-- Adds the `email` message channel, a `skipped` message status (for opt-out /
-- no-address sends), and per-customer email opt-out + unsubscribe token.
--
-- M1 note: `ALTER TYPE ... ADD VALUE` is split from any use of the new value.
-- This migration only ADDs enum values and columns; it never inserts a row that
-- references 'email'/'skipped', so there is no same-transaction use. Safe on
-- PostgreSQL >= 12 (deploy runs 15-alpine).

-- AlterEnum
ALTER TYPE "MessageChannel" ADD VALUE IF NOT EXISTS 'email';

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'skipped';

-- AlterTable
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "email_opt_out" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "unsubscribe_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customers_unsubscribe_token_key" ON "customers"("unsubscribe_token");
