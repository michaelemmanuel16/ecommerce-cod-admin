-- Add paystack_provider column to system_config
ALTER TABLE "system_config" ADD COLUMN IF NOT EXISTS "paystack_provider" JSONB;
