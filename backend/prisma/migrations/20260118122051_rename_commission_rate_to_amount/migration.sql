/*
  Warnings:

  - You are about to drop the column `commission_rate` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" RENAME COLUMN "commission_rate" TO "commission_amount";
