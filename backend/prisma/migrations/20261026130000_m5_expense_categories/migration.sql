-- M5-T28 (COD-52): one expense category list (F-918). Data only, no DDL.
-- New list: Packaging, Software, Office and internet, Transport, Photography, Bank charges, Salaries, Marketing, Other.
-- Old to new, as the owner approved (PRD F-918): COGS -> Packaging, Delivery -> Transport, Marketing -> Marketing,
-- Operations -> Other, Salaries -> Salaries, Utilities -> Office and internet, Other -> Other. A name already on the
-- new list keeps its place (exact spelling restored). Any other name -> Other.
-- Names match ignoring case and outer spaces. One NOTICE line per old category, tenant and new category is the
-- migration log (rows and amount). Safe to run twice: the second run changes nothing.

-- One statement, so the work table lives and dies in one session.
DO $$
DECLARE
  r record;
  total integer := 0;
BEGIN
  CREATE TEMP TABLE m5_expense_category_map AS
  SELECT e.id, e.tenant_id, e.category AS old_category, e.amount,
    CASE lower(btrim(e.category))
      WHEN 'cogs' THEN 'Packaging'
      WHEN 'delivery' THEN 'Transport'
      WHEN 'utilities' THEN 'Office and internet'
      WHEN 'operations' THEN 'Other'
      WHEN 'packaging' THEN 'Packaging'
      WHEN 'software' THEN 'Software'
      WHEN 'office and internet' THEN 'Office and internet'
      WHEN 'transport' THEN 'Transport'
      WHEN 'photography' THEN 'Photography'
      WHEN 'bank charges' THEN 'Bank charges'
      WHEN 'salaries' THEN 'Salaries'
      WHEN 'marketing' THEN 'Marketing'
      ELSE 'Other'
    END AS new_category
  FROM expenses e;

  FOR r IN
    SELECT coalesce(tenant_id, 'NULL') AS tenant, old_category, new_category, count(*)::integer AS n, sum(amount) AS total_amount
    FROM m5_expense_category_map
    WHERE old_category <> new_category
    GROUP BY 1, 2, 3
    ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'M5-T28 mapped: tenant % "%" -> "%" rows % amount %', r.tenant, r.old_category, r.new_category, r.n, r.total_amount;
    total := total + r.n;
  END LOOP;
  RAISE NOTICE 'M5-T28 total rows changed: %', total;

  UPDATE expenses e SET category = m.new_category
  FROM m5_expense_category_map m
  WHERE e.id = m.id AND e.category <> m.new_category;

  DROP TABLE m5_expense_category_map;
END $$;
