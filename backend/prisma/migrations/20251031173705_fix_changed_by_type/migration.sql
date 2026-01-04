/*
  Warnings:

  - The `changed_by` column on the `order_history` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "order_history" DROP COLUMN "changed_by",
ADD COLUMN     "changed_by" INTEGER;
