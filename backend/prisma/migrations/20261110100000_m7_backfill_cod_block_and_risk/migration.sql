-- M7 (COD-64): cod_blocked and risk_level were added with defaults only. Set them from the existing
-- refusal counts so customers who were already blocked (3+ refusals) or high risk (2+) stay that way.
UPDATE "customers" SET "risk_level" = 'high' WHERE "refused_orders" >= 2 AND "risk_level" = 'normal';
UPDATE "customers" SET "cod_blocked" = true WHERE "refused_orders" >= 3 AND "cod_override" = false AND "cod_blocked" = false;
