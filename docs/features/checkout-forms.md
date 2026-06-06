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
