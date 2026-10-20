-- M1-T10: failed-delivery fee entries are keyed on the OrderHistory row (one per failed_delivery move, D6).
-- A new source type keeps them apart from legacy `failed_delivery` entries keyed on a Delivery id.
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'order_failed_delivery';
