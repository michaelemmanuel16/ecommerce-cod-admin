# Checkout Forms (Salesgee-style builder)

## Goal

Tenants build a checkout form in under 2 minutes, see it render live as they
edit, and copy a URL or embed snippet from any row. The form's only job is to
look clean, take order details, and post. Direct-response chrome (hero,
scarcity, refund, testimonials) lives on the tenant's own landing page where
the form embeds.

## Architecture

```
/checkout-forms                       list page
   ▸ Edit/Clone/Preview/Copy URL/Copy Embed/Delete row actions

/checkout-forms/new                   editor (create mode)
/checkout-forms/:id/edit              editor (full-page, no Modal)
   ┌─────────────────────────────┬───────────────────────────┐
   │ Basics | Packages | Upsells │  Live preview iframe      │
   │ Settings | Design (NEW)     │  loads /:id/preview       │
   │                             │  parent postMessages       │
   │                             │  draft in 150ms debounce   │
   └─────────────────────────────┴───────────────────────────┘
   ↳ unsaved-changes guard (useBlocker + beforeunload)

/checkout-forms/:id/preview           admin-only preview route
   ↳ mounts <CheckoutForm draftMode>
   ↳ loads /api/checkout-forms/:id/preview-config (allows drafts)
   ↳ listens window message for live-draft patches

/form/:slug                           public hosted form
```

## Schema

The only additive change in this iteration is a `design Json?` column on
`CheckoutForm`. Shape:

```ts
design?: {
  colors?: { primary?, cta?, surface?, text? };   // palette hex
  button?: { shape?: 'square'|'rounded'|'pill'; size?: 'sm'|'md'|'lg'; label? };
  input?:  { style?: 'flat'|'outlined'|'filled'; labelColor?; priceColor? };
  page?:   { background?; productBanner?; hideProductDisplay?; offerPosition? };
}
```

The migration runs an UPDATE that, for every form with `design IS NULL`, copies
`styling.buttonColor → design.colors.cta` and `styling.accentColor →
design.colors.surface`. After backfill, `PublicCheckoutForm` reads ONLY from
`design`; `styling` and `skin` columns remain in the schema but are flagged for
drop in a follow-up PR.

### Backend validation

Zod schema `backend/src/validators/checkoutFormDesignSchema.ts` enforces:

- Colors must be one of the 12 `BRAND_PALETTE` hex literals (off-palette hex is
  snapped to the nearest swatch via `nearestPaletteHex`)
- `button.shape ∈ {square, rounded, pill}`, `button.size ∈ {sm, md, lg}`,
  `input.style ∈ {flat, outlined, filled}`
- `page.background` ∈ palette or `transparent`
- `page.productBanner` must start with `https://` and be ≤500 chars
- `button.label` ≤60 chars
- Unknown keys at every level are rejected (`strict()`)

Rejected payloads return 400 with the Zod issue list.

## Live preview transport

Same-origin iframe — the parent editor sets `<iframe src="/checkout-forms/:id/preview">`
and posts the in-memory draft over `postMessage`. The child listens, merges the
patch on top of the saved form, and re-renders. Debounced 150ms in the parent.

The child posts a `checkout-preview-ready` handshake on mount so the parent
doesn't drop updates before the iframe is listening.

## Embed

The **Copy Embed** button copies a JS auto-resize snippet (100% width,
auto-grow height via `postMessage` from `/form/:slug` ⇒ host). Slug is
HTML-escaped in the container `<div>` and JS-escaped in the script string —
malicious slugs cannot break out.

Tenant-tunable dimensions are intentionally out of scope; the snippet adapts to
container width and grows to fit content height. Platform-specific embedding
steps live in `docs/embed.md`.

## Palette

Hardcoded at `frontend/src/lib/checkoutPalette.ts` (and a mirror at
`backend/src/lib/checkoutPalette.ts`). 12 brand-neutral swatches:

```
Charcoal #0f172a    Slate    #475569    Blue   #2563eb
Indigo   #4f46e5    Purple   #7c3aed    Emerald#059669
Teal     #0d9488    Amber    #d97706    Red    #dc2626
Rose     #e11d48    Pink     #db2777    Black  #000000
```

`nearestPaletteHex(hex)` returns the closest palette swatch by Euclidean RGB
distance. Used by both the Zod normalizer (so non-palette hex saved via API is
snapped to a palette member) and the backfill SQL (existing styling colors are
mapped to nearest swatches when first read).

## Files

```
backend/
  prisma/schema.prisma                                — `design Json?` on CheckoutForm
  prisma/migrations/20260605140000_add_checkout_form_design/migration.sql
  src/lib/checkoutPalette.ts                           — 12 swatches + nearest
  src/validators/checkoutFormDesignSchema.ts           — Zod (E3)
  src/services/checkoutFormService.ts                  — + getCheckoutFormForPreview
  src/controllers/checkoutFormController.ts            — + previewCheckoutForm + design plumbing
  src/routes/checkoutFormRoutes.ts                     — + GET /:id/preview-config

frontend/
  src/lib/checkoutPalette.ts                           — mirror of backend palette
  src/lib/embedSnippet.ts                              — JS auto-resize builder
  src/types/checkout-form.ts                           — + CheckoutFormDesign
  src/components/forms/
    CheckoutFormBuilder.tsx                            — Modal-free, forwardRef, onDraftChange
    CheckoutFormPreviewPane.tsx                        — iframe + debounced postMessage
    CopyActions.tsx                                    — CopyURLButton + CopyEmbedButton
    builder/
      checkoutBuilderContextValue.ts                   — context + hook (no JSX)
      CheckoutBuilderContext.tsx                       — Provider (JSX)
      BasicsTab.tsx
      PackagesTab.tsx
      UpsellsTab.tsx
      SettingsTab.tsx
      DesignTab.tsx                                    — swatch grid + pills + URL inputs
  src/pages/
    CheckoutForms.tsx                                  — list page with Copy URL/Embed row actions
    CheckoutFormEditor.tsx                             — full-page editor + Blocker + beforeunload
    CheckoutFormPreview.tsx                            — admin-only preview route
  src/services/checkout-forms.service.ts               — + getCheckoutFormPreviewConfig

docs/
  embed.md                                             — WordPress/Shopify/Custom HTML
  features/checkout-forms.md                           — this doc
```

## Test coverage

| Layer | Tests | Notes |
|-------|-------|-------|
| Zod design validator | 26 | accept palette + snap off-palette + reject unknown enums + 60-char label + https-only banner + strict |
| Backfill migration (R1) | 6 | per-styling-key map + idempotency + no-clobber |
| Service unit | 19 | existing — slug-fetch path preserved |
| Embed snippet | 8 | URL + container ID + 100% width invariant + HTML/JS escape + origin pin |
| Frontend overall | 75+ | builder split parity + existing |

## Known follow-ups (NOT in scope)

- Drop `styling` and `skin` columns in a follow-up migration
- Order-state machine consolidation
- Embed widget bundle (`embed.js`) — Copy Embed already works via the iframe
  snippet; a per-tenant widget bundle is backlog
- Meta CAPI server-side events
- Tenant-level brand palette overrides

## COD-33 — Checkout forms API and public checkout rules (M3b T08–T09)

- **Date:** 2026-10-23 · **Type:** feature · **Branch:** `feature/m3b-checkout-payments`
- **Commits:** `3c21943` (T08), `23c7809` (upsell tenant check), `d4fdcac` (T09), `568d785` (duplicate reply), `98562b2` (town), `2b04a26` (review and simplify fixes)

### Admin API (T08)
- `GET /api/checkout-forms?archived=true|false`: archived forms are hidden by default. Each row has `ordersThisMonth`, `ordersTotal` (one grouped query) and `conversion: null` (visits come in M8, F-409).
- `DELETE /:id` archives a form that has submissions or a payment in flight (`archivedAt`, inactive, slug kept) and answers `{ archived: true, ordersTotal }`. Any other form is deleted. Both add `warning: "No active form sells this product."` when the form was the product's last active form.
- `POST /:id/restore` (super_admin, admin) clears `archivedAt`. The form stays off.
- `POST /:id/clone` (super_admin, admin) copies the form, packages and upsells by omission: name `"<name> (copy)"`, a free slug (`-2` … `-50`, then a random suffix), inactive. The Conversion API token and test event code are not copied (`capiTokenNotCopied`).
- Basics: thank-you page must be `https://`; allowed domains are hosts, stored as `https://host`; country is read-only and comes from the store (`countryNameOfTenant`). Pixel ids: Facebook digits only, GA4 `G-`, GTM `GTM-`.
- Type follows the product (F-422): a mismatched `formType` is 400; a product change across types on a form with orders is 400; add-ons on a digital form must be digital products. Every add-on product must belong to the store (400 "Upsell product not found").
- Required keys on activation (F-411): physical needs name, phone, street address and region; digital needs name, phone and email. Message: "This form can't take orders yet. Add: …". An empty fields list means the platform defaults and is not blocked.
- Standard keys `city` (saved as `town`) and `notes`. A form without a town field leaves the town empty (existing rule).
- Regions: the form's regions must be regions of its country; a new form starts with all of them. `GET /api/reference/regions` is public (`?country=` name or ISO code, or the store country from an optional login; `Cache-Control: public, max-age=86400`).
- `POST /:id/test-event` (super_admin, admin) sends one test Purchase with the stored token and test event code through `postCapiEvent` (10 s timeout).
- "Archived" means `archivedAt`, not `isActive=false`. Admin reads use `withSoftDeleted`, because the soft-delete extension still hides inactive forms.

### Public checkout (T09)
- Order of checks: form active → product active → sold out (physical `stockQuantity <= 0`: "This product is sold out") → package and add-ons → region in the form's list ("Choose a region from the list.") → server price → duplicate guard → create.
- Add-ons whose product is off or out of stock are hidden on the public form and refused on submit.
- Duplicate guard: same store, phone, package id and server total within 30 minutes. Only the submitter (same IP on the form submission) gets the order back with `orderId` and `orderNumber`. Anyone else gets a plain success. Neither creates an order or fires CAPI. The hosted page and the embed show the thank-you without an order number and fire no second browser Purchase.
- The success payload adds `orderNumber` (`#<id>`).
- `requiresManualCall` stays false: no customer block flag exists (rule comes in M7).

### Key files
- `backend/src/controllers/checkoutFormController.ts`, `publicOrderController.ts`, `referenceController.ts`
- `backend/src/utils/checkoutFormRules.ts` (new), `checkoutLocation.ts`, `slugify.ts` (new)
- `backend/src/middleware/auth.ts` (`optionalAuthenticate`), `services/metaCapiService.ts`, `services/locationService.ts`, `services/checkoutFormService.ts`
- `frontend/src/pages/PublicCheckout.tsx`, `components/public/OrderSuccess.tsx`, `frontend/embed/*`
- Tests: `integration/checkoutFormsApi.test.ts`, `integration/publicCheckoutRules.test.ts`

## COD-34 — Forms list and editor Basics, Fields and regions (M3b T10–T11)

- **Date:** 2026-10-23 · **Type:** feature · **Branch:** `feature/m3b-checkout-payments`
- **Commits:** `b4821b1` (T10), `4e65391` (T11), `610ee96` (review and simplify fixes)

### Forms list (T10)
- `pages/CheckoutForms.tsx` on ui-v2: Form (name, product, "Digital" tag), Link, Orders this month, Conversion ("—" with a tooltip until visits arrive in M8), Active switch, Actions. "Show archived" loads `?archived=true`; archived rows show an "Archived" tag and Edit and Restore only.
- Active switch: optimistic, reverts on error and shows the server text (this is how the required-key guard reaches the list).
- Clone, delete and restore share one `act()` run and update the list in place (no refetch). Clone toast: "Copy created. It stays off until you switch it on." plus "Add the Conversion API token again in Tracking." when the token was not copied.
- Delete uses `ConfirmDialog`: "<n> orders came from this form. It will be archived …" (n with a thousands separator) or "This form has no orders. It will be removed." The product warning rides on the same toast.
- Copy link and per-package links (`LinkCell`), host from `VITE_PUBLIC_CHECKOUT_URL` (fallback `window.location.origin`, also used by `lib/embedSnippet.ts`). One `copyText()` in `hooks/useCopyToClipboard.ts`; a refused clipboard opens `CopyFallbackModal` with the text.
- Roles: the `checkoutForms` menu rule in `backend/src/services/navService.ts` is manager-up (super_admin, admin, manager). `AccessGate` blocks the list and editor routes for everyone else. A manager sees the list read-only: Preview and copy only. A role with only `settings.view` no longer sees the sidebar link.

### Editor (T11)
- Basics: name, product (type shown), read-only link, description, read-only country "<country> (from your store)" with currency, read-only form type line, thank-you page (https or empty) and allowed domains (moved from Settings, same rules as the server). A product change on a form with orders shows "New orders use the new product. Past orders do not change." `validateBasics()` in `lib/checkoutBasics.ts` checks before save.
- Fields: "Sends to" options Customer name, Phone, Alternate phone, Email, Region, City or town (`town` key), Street address, Order notes (`notes`, now sent with the order), Custom field only. Up and down buttons next to drag, Show switch, width, and the note "This field helps Meta match buyers." for name, phone, email and town.
- Required-key guard: `missingKeysMessage()` in `lib/standardFields.ts` uses the "Sends to" labels; the server `GUARD_LABELS` use the same words ("Add: Region."). The banner shows in Fields and blocks saving a new or active form.
- New-form fields come from `lib/defaultFields.ts` (`NEW_FORM_FIELDS`, street address on and required). The public form keeps its old wording for saved forms with no fields (`LEGACY_EMPTY_FORM_FIELDS`).
- Regions: all regions of the store's country to start; the last one cannot be removed ("Keep at least one region.").
- Open point for the owner: the public form still shows "State" for the region field (COD-138), while F-413 says "Region". The public page is COD-36 (T16).

### Key files
- `frontend/src/pages/CheckoutForms.tsx`, `pages/checkoutForms/LinkCell.tsx`, `CopyFallbackModal.tsx`, `styles/checkoutForms.css`
- `frontend/src/components/forms/CheckoutFormBuilder.tsx`, `builder/BasicsTab.tsx`, `FieldsTab.tsx`, `FieldEditModal.tsx`, `SettingsTab.tsx`
- `frontend/src/lib/checkoutBasics.ts`, `standardFields.ts`, `defaultFields.ts` (new), `orderPayload.ts`, `embedSnippet.ts`; `hooks/useCopyToClipboard.ts`; `services/checkout-forms.service.ts`
- `backend/src/services/navService.ts`, `utils/checkoutLocation.ts`
- Tests: `CheckoutForms.test.tsx`, `CheckoutFormBuilder` and `FieldsTab` tests, `checkoutBasics.test.ts`, `accessGate.test.tsx`, `unit/navMenuCheckoutForms.test.ts`, `e2e/17-checkout-forms-list.spec.ts`
