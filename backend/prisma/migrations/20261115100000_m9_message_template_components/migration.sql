-- M9 (COD-78 T09): a WhatsApp template keeps the components Meta returned (header, body, footer, buttons). Nullable, no backfill.
ALTER TABLE "message_templates" ADD COLUMN "components" JSONB;
