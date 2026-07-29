/**
 * URL-safe slug from a display name: lowercase, non-alphanumerics collapsed to
 * single hyphens, no leading/trailing hyphen. Shared by tenant registration and
 * multi-store provisioning so both build slugs identically.
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Per-store billing email (MAN-89). A plus-addressed alias of the owner's email
 * (`owner@x.com` + store slug -> `owner+store-<slug>@x.com`) so Paystack keys a
 * DISTINCT customer per store off the same inbox — which is what makes webhook
 * routing by customer unambiguous. Any existing +tag on the owner's local part
 * is stripped first so store N doesn't stack tags on store N-1.
 */
export function perStoreBillingEmail(ownerEmail: string, slug: string): string {
  const at = ownerEmail.lastIndexOf('@');
  if (at <= 0) return ownerEmail; // not an addressable email — leave as-is
  const baseLocal = ownerEmail.slice(0, at).split('+')[0];
  const domain = ownerEmail.slice(at + 1);
  return `${baseLocal}+store-${slug}@${domain}`;
}
