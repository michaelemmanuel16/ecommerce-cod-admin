# M8 wave 5, lane A: COD-74 T14 (Marketing page) + COD-75 T16 (mapping dialog, "Not mapped" strip)

Worktree `.claude/worktrees/m8-a`, branch `m8/lane-a` (reset to `feature/m8-marketing` at the T10/T11 merge). Test DB `ecommerce_cod_test_a`. **No schema changes.** Lane B only adds backend test files: do not touch `src/__tests__/integration/m8*`.

Read first: repo `CLAUDE.md`; `docs/plan/M8.md` rows T14, T16; the mockup `docs/mockups/v2/marketing.html` (+ `app.css`, `DESIGN-SPEC.md`); the backend `src/services/marketing/marketingKpiService.ts`, `marketingFunnelService.ts`, `controllers/marketingKpiController.ts`, `controllers/marketingMappingController.ts`, `routes/marketingRoutes.ts` for exact response shapes. Copy a restyled v2 page for structure (`pages/Reports.tsx` or `pages/Financial.tsx`: `useV2Page()`, v2 tokens, tiles, tables, date range control). Nav: `components/shell/navModel.ts` has `marketing` with `to: null`; set it to `/marketing` and add the route in `App.tsx` guarded by `marketing:view` the same way other pages are guarded.

## Commit 1 (backend, small): per-product rows
`GET /api/marketing/products?from&to` (marketing:view). In `marketingFunnelService.ts`, `products({from,to})`: one row per product that has a mapped campaign with spend in range: product id/name, spend (sum of its campaigns' store spend from `campaigns()`, same MoneyView shape), Meta purchases, orders placed / confirmed / delivered (= `funnel({productId})`), yield and max CPA (`maxCpa({to, productId})`), cost per placed order = spend / placed (null when 0), `lowData`. Reuse the existing functions; no new math. Integration test on `_a`: one product row equals its funnel and max CPA; a call rep gets 403.

## Commit 2: T14 Marketing page `/marketing`
Mockup is the look. Build only these parts (the mockup's agent cards, agent drawer and daily chart are later milestones: leave them out, no placeholders):
1. Header "Marketing", subline "Meta ad results by product, from ad click to delivered order." Meta line: "Meta account: connected, pulled <relative time>" from `GET /api/meta-ads/accounts` (latest `lastPulledAt`). Date range: Today, This week, This month, Last month (store time zone), plus the previous period shown under each tile as a change.
2. Tiles from `/summary`: Ad spend (₦ account figure first when present, store figure "About GH₵…" with the rate), Max CPA (with yield %), Projected cost per delivered, Actual cost per delivered (label from the API: "Actual, delivered in range"), Order-to-cash yield. Show the API `message` text when a value is null ("Not enough closed orders", "No room for ads at this price"). Show "N days wait for an FX rate" when `spendDaysWaitingForRate > 0`.
3. Funnel row from `/funnel`: impressions, link clicks, landing page views, checkouts started, orders placed, confirmed, delivered, each with the step-to-step %. Product filter (all products / one) re-queries `productId`.
4. Per-product table from `/products`: product, spend, Meta purchases, placed, confirmed, delivered, yield, max CPA, cost per placed order, "Low data" tag.
5. Campaigns table from `/campaigns/performance`: campaign, product (or "Not mapped"), spend, impressions, link clicks, LPV, checkouts, Meta purchases, CPA, max CPA, projected delivered (column label "Projected delivered (Meta purchases)"), status chip, "Low data" tag. Totals row from `totals`. Status chip colours: Winning green, On track neutral/blue, Over max CPA red, Not mapped amber, Paused grey, null shows the max CPA message in muted text. Note under the table: "Max CPA is profit per delivered order before ads times the product's yield. Status compares CPA with that max CPA."
6. No Meta account connected (accounts list empty): one empty state with "Connect Meta Ads" linking to `/settings?tab=integrations&section=meta-ads`. No other content.
7. ₦ figures as the API gives them (already rounded); format with the app's money formatter. Plain words, no emojis, v2 tokens, light and dark, works at 1440 px and 760 px (tables scroll inside their card at 760 px). No dead buttons.

## Commit 3: T16 mapping dialog and "Not mapped" strip
1. Strip above the campaigns table when `/campaigns/unmapped` has rows: "<₦ total> Meta spend has no product. <n> campaigns are not mapped." with a "Map campaigns" button (marketing:update only).
2. Dialog (app's own dialog component), opened from the strip or from a "Not mapped" chip / a product cell (update users only): campaign name and spend; product select (active products); choice "Only this campaign" (PUT `/mappings/campaigns`) or "All campaigns whose name starts with <prefix>" (POST `/mappings/rules`, prefix input prefilled with the text before the first `_` plus `_`, editable). For a mapped campaign, a "Remove mapping" option (PUT with `productId: null`). Show the archived-product warning the API returns.
3. On save: invalidate the campaigns, products, unmapped and funnel queries so the table updates at once; toast "Mapping saved".
4. Read-only users see the strip text without the button and no dialog triggers.

## Tests
Vitest + Testing Library, API mocked: tiles show values and the null messages; previous-period change shows; status chip text per status; null status shows the message; empty state when no account; totals row; strip shows and opens the dialog; saving a pick and a rule calls the right endpoint and refetches; read-only user sees no Map button.

## Checks
Backend: `npx prisma generate && npx tsc --noEmit && npm run lint`, the new integration test by name `--runInBand --forceExit` (time-box). Frontend: `npx tsc --noEmit && npm run lint`, new test files by name with `npx vitest run <files>`. No full suites.

## Report
Three commits: `feat(M8): per-product marketing rows (COD-74)`, `feat(M8): Marketing page (COD-74)`, `feat(M8): campaign mapping dialog and Not mapped strip (COD-75)`. Do not push. Reply: shas, files, check output, changes from spec and why.
