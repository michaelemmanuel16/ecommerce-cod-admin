-- AlterTable: Product.cogs widens to Decimal(19,4) (F-611, landed cost has 4 places). Widening only; no value changes.
ALTER TABLE "products" ALTER COLUMN "cogs" SET DATA TYPE DECIMAL(19,4);
