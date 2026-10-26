-- M5-T28 (COD-52): one expense category list (F-918). Data only, no DDL.
-- New list: Packaging, Software, Office and internet, Transport, Photography, Bank charges, Salaries, Marketing, Other.
-- A row whose category matches a name on the list (ignoring case and outer spaces) gets that exact spelling.
-- Every other category becomes "Other". One NOTICE line per old category and tenant is the migration log
-- (old name, row count, amount), so the owner can read what was mapped. Safe to run twice: the second run finds nothing.

DO $$
DECLARE
  r record;
  total integer := 0;
BEGIN
  FOR r IN
    SELECT coalesce(tenant_id, 'NULL') AS tenant, category AS old_category, count(*)::integer AS n, sum(amount) AS total_amount
    FROM expenses
    WHERE lower(btrim(category)) NOT IN ('packaging', 'software', 'office and internet', 'transport', 'photography',
                                          'bank charges', 'salaries', 'marketing', 'other')
    GROUP BY 1, 2
    ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'M5-T28 mapped to Other: tenant % category "%" rows % amount %', r.tenant, r.old_category, r.n, r.total_amount;
    total := total + r.n;
  END LOOP;
  RAISE NOTICE 'M5-T28 total rows mapped to Other: %', total;
END $$;

UPDATE expenses SET category = 'Other'
WHERE lower(btrim(category)) NOT IN ('packaging', 'software', 'office and internet', 'transport', 'photography',
                                     'bank charges', 'salaries', 'marketing', 'other');

UPDATE expenses e SET category = c.name
FROM (VALUES ('packaging', 'Packaging'), ('software', 'Software'), ('office and internet', 'Office and internet'),
             ('transport', 'Transport'), ('photography', 'Photography'), ('bank charges', 'Bank charges'),
             ('salaries', 'Salaries'), ('marketing', 'Marketing'), ('other', 'Other')) AS c(key, name)
WHERE lower(btrim(e.category)) = c.key AND e.category <> c.name;
