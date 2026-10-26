-- M5-T03 (COD-47): chart of accounts for settlement and finance (F-903).
-- Adds 2040, 2050, 3010, 5070, 5080 to every tenant, relabels 1010, and retires 1020, 5040 and 2030.
-- Safe to run twice: the insert skips existing rows and the clash check accepts our own rows.

-- Stop first if a person already made an account with one of the new codes. Our own rows
-- (system account with the exact name below) are not a clash, so a second run passes.
DO $$
DECLARE
  clashes text;
BEGIN
  SELECT string_agg(format('tenant %s: %s "%s"', coalesce(a.tenant_id, 'NULL'), a.code, a.name), '; ' ORDER BY a.tenant_id, a.code)
    INTO clashes
  FROM accounts a
  WHERE a.code IN ('2040', '2050', '3010', '5070', '5080')
    AND NOT (a.is_system AND (a.code, a.name) IN (
      ('2040', 'Unapplied Partner Receipts'),
      ('2050', 'Supplier Payables'),
      ('3010', 'Owner''s Equity'),
      ('5070', 'Delivery Fees'),
      ('5080', 'Meta Ad Spend')
    ));
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'M5-T03 stopped: accounts with a new code already exist. Rename or remove them, then run again. %', clashes;
  END IF;
END $$;

-- One new account per tenant per code.
INSERT INTO accounts (code, name, description, account_type, normal_balance, is_system, is_active, current_balance, updated_at, tenant_id)
SELECT v.code, v.name, 'Default account: ' || v.name, v.account_type::"AccountType", v.normal_balance::"NormalBalance", true, true, 0, now(), t.id
FROM tenants t
CROSS JOIN (VALUES
  ('2040', 'Unapplied Partner Receipts', 'liability', 'credit'),
  ('2050', 'Supplier Payables', 'liability', 'credit'),
  ('3010', 'Owner''s Equity', 'equity', 'credit'),
  ('5070', 'Delivery Fees', 'expense', 'debit'),
  ('5080', 'Meta Ad Spend', 'expense', 'debit')
) AS v(code, name, account_type, normal_balance)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- One cash account: 1010 keeps its code and gets the new label. A name an owner already changed is left alone.
UPDATE accounts SET name = 'Cash at bank and MoMo', updated_at = now() WHERE code = '1010' AND name = 'Cash in Hand';

-- Retired codes stay for history (Aug and Sep) and take no new postings. 2030 is not in the chart; this only covers a stray row.
UPDATE accounts SET is_active = false, updated_at = now() WHERE code IN ('1020', '5040', '2030') AND is_active;
