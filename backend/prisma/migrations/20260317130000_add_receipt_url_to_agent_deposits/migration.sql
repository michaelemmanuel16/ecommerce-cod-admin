-- AlterTable
ALTER TABLE "agent_deposits" ADD COLUMN "receipt_url" TEXT;

-- Add CHECK constraint to ensure receipt_url is a valid upload path
ALTER TABLE "agent_deposits" ADD CONSTRAINT "valid_receipt_url" CHECK (receipt_url IS NULL OR receipt_url ~ '^/uploads/');
