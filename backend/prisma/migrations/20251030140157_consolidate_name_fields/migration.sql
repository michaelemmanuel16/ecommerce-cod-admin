-- AlterTable: Add name column to customers
ALTER TABLE "customers" ADD COLUMN "name" TEXT;

-- Migrate existing customer data with smart concatenation
UPDATE "customers"
SET "name" = CASE
  WHEN "first_name" = "last_name" THEN "first_name"  -- Handle duplicates (e.g., "John" / "John")
  WHEN "last_name" IS NULL OR "last_name" = '' THEN "first_name"
  WHEN "first_name" IS NULL OR "first_name" = '' THEN "last_name"
  ELSE "first_name" || ' ' || "last_name"
END;

-- Make name column NOT NULL after data migration
ALTER TABLE "customers" ALTER COLUMN "name" SET NOT NULL;

-- Drop old columns from customers
ALTER TABLE "customers" DROP COLUMN "first_name";
ALTER TABLE "customers" DROP COLUMN "last_name";

-- AlterTable: Add name column to users
ALTER TABLE "users" ADD COLUMN "name" TEXT;

-- Migrate existing user data with smart concatenation
UPDATE "users"
SET "name" = CASE
  WHEN "first_name" = "last_name" THEN "first_name"  -- Handle duplicates
  WHEN "last_name" IS NULL OR "last_name" = '' THEN "first_name"
  WHEN "first_name" IS NULL OR "first_name" = '' THEN "last_name"
  ELSE "first_name" || ' ' || "last_name"
END;

-- Make name column NOT NULL after data migration
ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;

-- Drop old columns from users
ALTER TABLE "users" DROP COLUMN "first_name";
ALTER TABLE "users" DROP COLUMN "last_name";
