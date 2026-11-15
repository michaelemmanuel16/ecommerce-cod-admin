-- M9 (COD-77): status callbacks now match on `provider`. Rows sent before the provider column existed get it.
-- Data only, no schema change, row count unchanged. Email rows stay NULL (no email statuses).
UPDATE "message_logs" SET "provider" = 'arkesel' WHERE "provider" IS NULL AND "channel" = 'sms';
UPDATE "message_logs" SET "provider" = 'whatsapp_cloud' WHERE "provider" IS NULL AND "channel" = 'whatsapp';
