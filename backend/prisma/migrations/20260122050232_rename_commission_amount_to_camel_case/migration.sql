/*
  Warnings:

  - You are about to drop the column `commission_amount` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "commission_amount",
ADD COLUMN     "commissionAmount" DOUBLE PRECISION DEFAULT 0;
