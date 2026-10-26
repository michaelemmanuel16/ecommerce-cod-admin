-- M5-T06: delivery fee entries (delivered, failed, returned) get their own source type.
-- sourceId is the order id; external_ref is "<outcome>:<OrderHistory id>", so a repeat of a move posts nothing twice.
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'delivery_fee';
