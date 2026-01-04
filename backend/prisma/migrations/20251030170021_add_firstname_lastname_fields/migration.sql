-- AlterTable: Add firstName and lastName to users table
ALTER TABLE "users" ADD COLUMN "first_name" TEXT;
ALTER TABLE "users" ADD COLUMN "last_name" TEXT;

-- AlterTable: Add firstName and lastName to customers table
ALTER TABLE "customers" ADD COLUMN "first_name" TEXT;
ALTER TABLE "customers" ADD COLUMN "last_name" TEXT;

-- Migrate existing data: Split name into firstName and lastName for users
UPDATE "users"
SET
  "first_name" = split_part("name", ' ', 1),
  "last_name" = CASE
    WHEN position(' ' in "name") > 0 THEN substring("name" from position(' ' in "name") + 1)
    ELSE ''
  END;

-- Migrate existing data: Split name into firstName and lastName for customers
UPDATE "customers"
SET
  "first_name" = split_part("name", ' ', 1),
  "last_name" = CASE
    WHEN position(' ' in "name") > 0 THEN substring("name" from position(' ' in "name") + 1)
    ELSE ''
  END;

-- Make the new columns NOT NULL
ALTER TABLE "users" ALTER COLUMN "first_name" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "last_name" SET NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "first_name" SET NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "last_name" SET NOT NULL;

-- Drop the old name column
ALTER TABLE "users" DROP COLUMN "name";
ALTER TABLE "customers" DROP COLUMN "name";
