-- Add allowed_origins to CheckoutForm: a per-form Origin allowlist for the
-- embed widget config endpoint (GET /api/public/forms/:slug/config). When
-- non-empty, only requests whose Origin header matches an entry receive the
-- config; empty array means no host-page has been authorized yet.
ALTER TABLE "checkout_forms"
  ADD COLUMN "allowed_origins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
