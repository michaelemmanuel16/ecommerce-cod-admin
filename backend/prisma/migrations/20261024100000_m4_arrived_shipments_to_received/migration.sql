-- M4-T12 (F-606, F-611): the old `arrived` status becomes `received`. An old arrival counted every unit: counted = quantity,
-- short = 0, received_at = arrived_at. Old rows keep their gl_journal_entry_id; no ledger entry is posted for them.
UPDATE "inventory_shipments"
SET "quantity_counted" = "quantity",
    "short_quantity" = 0,
    "status" = 'received',
    "received_at" = COALESCE("arrived_at", "updated_at")
WHERE "status" = 'arrived';
