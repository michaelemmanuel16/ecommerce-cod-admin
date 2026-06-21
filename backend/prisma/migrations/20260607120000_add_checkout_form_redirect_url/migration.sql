-- Add an optional custom redirect (thank-you) URL to CheckoutForm.
-- When set, the public checkout redirects here after a successful COD order
-- instead of showing the built-in success screen.
ALTER TABLE "checkout_forms" ADD COLUMN "redirect_url" TEXT;
