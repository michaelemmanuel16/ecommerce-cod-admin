/*
  Warnings:

  - A unique constraint covering the columns `[reference_number]` on the table `agent_deposits` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `deposit_method` to the `agent_deposits` table without a default value. This is not possible if the table is not empty.
  - Made the column `reference_number` on table `agent_deposits` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "agent_deposits" ADD COLUMN     "deposit_method" TEXT NOT NULL,
ALTER COLUMN "reference_number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "agent_deposits_reference_number_key" ON "agent_deposits"("reference_number");
