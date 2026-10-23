-- M3b-T07 (COD-32): finding types for unmatched payments, failed ledger posts and unsettled Paystack money,
-- and the journal source type for Paystack payouts. Transaction.fee_unknown already exists (payment_connections).
-- Undo: enum values added to FindingType and JournalSourceType cannot be removed.
ALTER TYPE "FindingType" ADD VALUE IF NOT EXISTS 'payment_unmatched';
ALTER TYPE "FindingType" ADD VALUE IF NOT EXISTS 'ledger_post_failed';
ALTER TYPE "FindingType" ADD VALUE IF NOT EXISTS 'paystack_unsettled';
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'paystack_payout';
