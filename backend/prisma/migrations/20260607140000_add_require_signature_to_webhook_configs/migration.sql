-- Per-config signature enforcement toggle.
-- The webhook secret column is non-nullable, so gating signature verification
-- on "has a secret" would force EVERY integration (incl. WPForms, which cannot
-- compute an HMAC over the body) to sign — breaking live order intake.
-- This explicit flag defaults to false: existing integrations keep working via
-- their API-key / unique-URL auth, and signature enforcement can be turned on
-- per webhook once the sender is confirmed to sign. When true, a missing
-- signature header no longer bypasses verification (the original fail-open bug).

ALTER TABLE "webhook_configs" ADD COLUMN "require_signature" BOOLEAN NOT NULL DEFAULT false;
