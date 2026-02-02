-- AlterTable
ALTER TABLE "account_transactions" ADD COLUMN     "running_balance" DECIMAL(19,4) NOT NULL DEFAULT 0;
