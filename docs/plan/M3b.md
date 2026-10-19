# M3b task plan: Checkout and payments

**Goal**: Move checkout forms, the public checkout and online payment onto one provider interface and into the v2 shell. Paystack stays and works as today (decision O2; the Ghana check, the GH₵ test charge and R14 are removed). A paid digital order settles through one neutral webhook, creates its order only after payment succeeds (R9), and books its fee once.

**Why a separate milestone**: the PRD put the payment work in M5 (area files) and the checkout restyle in M3. Two planners wrote overlapping tasks. Opus decision 2026-10-18: payments get their own milestone, after M3 and before M5. This file holds every task for area 04 (F-400 to F-423, except F-409 in M8) and F-934. M3 and M5 no longer plan them.

**Done when** (PRD §10 has no M3b row; this list is the testable version):
1. (Removed, O2: the Ghana check and the R14 result file are not built.) Paystack works as today.
2. `publicOrderController` and the settlement code import only the `PaymentProvider` interface (test greps for `paystackService`). A fake provider passes the contract tests.
3. A digital order in the store currency pays through the neutral webhook route. The order is created after payment succeeds. The same event sent twice creates one order. The callback page shows Confirming, then Order received.
4. Checkout forms: all tabs save; the public form `/form/:slug` works at 390 px; browser Purchase `eventID` equals the server `event_id` for COD; order ids in messages use `#<id>`.
5. The method matrix holds: physical forms COD only while `features.prepaidPhysical` is off; digital forms online in full. A tampered request with a disabled method returns 400.
6. The provider fee is booked to 5060 on the payment day; a Paystack payout import credits 1030.
7. Static checks: no `target="_blank"` in public components; no "(Nigeria only)" text; no second regions list.

**Depends on**: M3 (base components, `ConfirmDialog`, shell, Settings shell), M2 (audit, registry), M1 (state machine, `regions.ts`, `Finding`), M0 (Decimal money, F-405 fix, legacy webhook removed).

**Order against other milestones**: M3b starts after M3 is merged. M4 depends on M3 only, so M4 does not wait for M3b. M3b and M4 touch different code (checkout and payments against stock), so with two builders they run in parallel. With one builder the order is M3, M3b, M4. M4-T07 reads upsell lines from `OrderItem` rows and M4-T37 (e2e) places a public order on whichever public form is merged, so neither waits for M3b. M5, M8 (forms stats UI) and M9 (Connections page) depend on M3b.

**PR**: one PR for the whole milestone. Branch `feature/m3b-checkout-payments` from `develop` (after M3 is merged), into `develop`. Never push to `main`. No push before owner approval. The owner reviews at one internal gate on the same branch: G1 after M3b-T19 (forms, public page, tracking tests).

**Owner of every task**: builder, with Opus review.

Legend: XS = 2 h, S = 3-4 h, M = 5-6 h, L = 7-8 h. Run `npx prisma generate` first. Hand-migrate the test database after each new migration. Jest with `--forceExit`. Frontend visual checks use the `agent-browser` or `claude-in-chrome` tools.

Scope notes (what is not in M3b even though a screen mentions it): form stats, visit counter and device split (M8, F-409); Connections page and the Paystack settings card (M9, F-1204); prepaid physical orders (after M12; the flag `features.prepaidPhysical` stays off); `payment_pending` and `payment_failed` creation path (none in release one, R9); a second payment provider (none in release one; the interface allows one later); Meta spend and finance cards (M8, M5). The Orders page, order drawer and `ConfirmDialog` stay in M3.

## Tasks

| ID | Task | Effort (h) | Size | Depends on | F-IDs | Done criteria (testable) |
|---|---|---|---|---|---|---|
| M3b-T02 | Create branch `feature/m3b-checkout-payments`. Migration. New `PaymentConnection` (tenantId, provider, mode, publicKey, encrypted secretKey, isEnabled, supportedCurrencies[], lastCheckedAt). `CheckoutForm`: `archivedAt`, `paymentProvider`. `Order`: `paymentProvider`. `Transaction`: provider and fee fields. `PendingCheckout`: status values and `lastCheckedAt`. The new model is scoped. This is the only task in the plan that creates `PaymentConnection`. | 5 | M | M3 | F-400, F-404, F-406, F-408 | `migrate deploy` passes on dev, test and the production-dump copy, and on an empty database it equals `schema.prisma`. Migration applied to the test DB by hand. Scoped-list test green. Two-tenant insert test for `PaymentConnection`. Provider secret keys are stored with the existing `enc:v1:` encryption. |
| M3b-T03 | Payment provider interface: `PaymentProvider` (`initialize`, `verify`, `verifyWebhook`, `parseWebhook`, `supportedMethods`, `fee`, capabilities), registry, Paystack adapter (wraps `paystackService`), `toMinor(amount, currency)`, status mapping (`success`, `abandoned`, `failed`, `pending`), fake provider for tests. `publicOrderController`, the verify route and `paystackSettlementService` use the interface only. Amounts are minor units inside the adapter only. | 8 | L | M3b-T02 | F-400, F-401 | Contract test runs against the Paystack adapter (mocked HTTP) and the fake provider. A second stub provider plugs in with no controller change. `toMinor(249.00, 'GHS')` is `24900`. Test greps controllers and settlement for `paystackService` imports and finds none. Existing Paystack tests pass. |
| M3b-T04 | `PaymentConnection` service and routes: `GET/PUT /api/payment-connections`, `POST /api/payment-connections/:id/test` (stores `supportedCurrencies`, `lastCheckedAt`; reports the key check), keys encrypted with `enc:v1:` and masked on read, read fallback from `SystemConfig.paystackProvider` JSON, copy script. Public config returns only the public key. Live keys in test mode are rejected (existing rule kept). | 7 | L | M3b-T03 | F-400, F-401 | Secret never appears in a response or log (test). Old tenants still pay through the fallback (integration). Two-tenant test. A form with a currency not in `supportedCurrencies` returns the F-401 message (unit). Live key in test mode is rejected. |
| M3b-T05 | Form payment rules: tenant flag `features.prepaidPhysical` (default false); method matrix (form type x flag: physical forms COD only, online methods behind the flag, digital forms online in full only); server rejects a method the form does not allow (`PUT /api/checkout-forms/:id` rejects online methods on a physical form while the flag is off; stored toggles stay); new rows store `online_full` / `online_deposit` and `Order.paymentProvider`; old names still read and accepted for 90 days. Remove the shipping-charge dead field; drop `Tenant.defaultDeliveryFee` only after a query shows it is empty or unused (result in PR). | 6 | M | M3b-T04 | F-402, F-400, F-423 | Unit test for the full matrix. Integration: tampered request with a disabled method returns 400. Old method names still work on the public API. Digital forms force full online payment. Query result for `Tenant.defaultDeliveryFee` is in the PR. |
| M3b-T06 | Neutral webhook route and online order creation: signature check, `WebhookEvent` replay guard, tenant-scoped, order created only after success (R9), `PendingCheckout` states; provider-neutral verify API for the callback page. | 7 | L | M3b-T04 | F-404, F-405 | Bad signature returns 401 and is logged. The same event sent twice creates one order. `charge.success` in the store currency creates a `digital_delivered` order with `paymentStatus` paid and a download link. A webhook for another tenant's reference returns 404. `GET /api/payments/verify/:reference` works for the callback page. Deposit and full-payment amounts are major units (Decimal). |
| M3b-T07 | Provider fee hook and Paystack payout posting: fee booked to 5060 on the payment day; payout import credits 1030. Both accounts are live in the chart (M5-T03 adds only 2040, 2050, 3010, 5070, 5080). | 6 | M | M3b-T06 | F-406, F-934 | Each settled payment posts the sale and the fee in one hook that other code can subscribe to. A failure is not swallowed: it opens a Finding (`Finding` exists from M1-T02). `POST /api/financial/paystack-payouts` credits 1030 and debits bank; 1030 stops only growing. A payout above the 1030 balance warns and is allowed with a note. A `paystack_unsettled` Finding opens for old unsettled sales. |
| M3b-T08 | Checkout forms API. List with stats; archive instead of delete when submissions exist (`archivedAt`), restore, clone (`POST /:id/clone`, new slug, starts inactive); basics validation (https thank-you URL, allowed domains, country read-only from store); standard keys `city` and `notes`; required-key guard per form type; type must match product type; regions of the store's country from the M1-T03 `regions.ts` helper and `GET /api/reference/regions` (no second list); design fields `labelColor`, `priceColor`, `background`, `productBanner` with palette validation; `POST /:id/test-event`; preview route limited to owner, admin, manager. | 8 | L | M3b-T05 | F-408, F-411, F-412, F-413, F-416, F-417, F-418, F-419, F-422 | Integration tests per rule. Clone has a unique slug and `isActive=false`. Form without a required key cannot be activated. Manager gets 200 on preview; call rep 403. Test greps for a second regions list and finds none. |
| M3b-T09 | Public checkout server rules. Sold-out check, region from the form list, package and upsell price recalculated on the server, upsell lines become `OrderItem` (`itemType = upsell`) with no stock move at creation, out-of-stock upsell hidden, duplicate guard (same phone, package, total in 30 minutes), `requiresManualCall` passes through (field from M3-T02, rule is M7), success payload carries the order number. Pixel and CAPI code unchanged. | 6 | M | M3b-T08 | F-420, F-414, F-415 | Integration: tampered price is ignored; sold-out product returns "This product is sold out"; duplicate within 30 minutes returns the same order. Existing CAPI tests green. |
| M3b-T10 | Checkout forms list UI: columns, active switch, clone, preview, archive instead of delete (message "1,198 orders came from this form"), "Show archived" toggle with restore, copy link and copy embed code (toast "Link copied.", package links, real host from config), role guard. | 6 | M | M3b-T08, M3-T29 | F-408, F-410 | Playwright: clone makes an inactive copy named "<name> (copy)". Archived form shows "Form not found" on the public URL. |
| M3b-T11 | Form editor shell, Basics tab (read-only slug and country, https thank-you URL, allowed domains, product select) and Fields tab (nine field types, "Sends to" keys incl. city and notes, drag with up / down buttons, width, required-key guard message) and the region list editor (regions of the store's country); form type tag physical / digital. | 8 | L | M3b-T10 | F-411, F-412, F-413, F-422 | Component test: guard text "This form can't take orders yet. Add: Street address." A new form starts with all regions of the store's country; the last region cannot be removed. |
| M3b-T12 | Packages tab (live final price, percent discounts shown as GH₵, badge, one default) and Upsells tab (product or manual, image, hint "35% of buyers also buy" only with at least 30 orders). | 6 | M | M3b-T11 | F-414, F-415 | Unit test: 2 sets = 2 x 249 - 49 = 449; 3 sets = 629. Component test for the hint threshold. |
| M3b-T13 | Payment tab (COD / deposit / full by the F-402 matrix, flag note, provider line, F-401 currency warning "This payment account cannot take <currency>", text "(Nigeria only)" removed, "Real customers cannot pay yet" only in test mode, "Online payment is paused" form note) and Tracking tab (pixel and GA4 / TikTok / GTM ids with validation, write-only CAPI token "Connected / Replace", "Send a test event", link to `/connections`). | 7 | L | M3b-T12, M3b-T05, M3b-T04 | F-402, F-416, F-401 | Component tests for the matrix and the currency warning. Playwright: token field never shows the value; test event shows the Meta response (mocked). |
| M3b-T14 | Design tab (colours, button shape / size / label, "Field style", hide product display, order summary, offer position) plus label colour, price colour, background and banner upload (jpeg, png, webp, 1 MB). Public page reads the new options. | 6 | M | M3b-T13 | F-417, F-418 | Playwright: change primary colour; live preview updates; public page shows banner. Admin dark mode does not change the public form colours. |
| M3b-T15 | Live preview pane (mobile 390 px / desktop 1024 px, `postMessage` with origin check, store currency, "Preview only." button, no pixels, no orders) and the preview modal from the list. | 5 | M | M3b-T14 | F-419 | Playwright: edit a field label, preview updates at once. Network log shows no pixel call from preview. |
| M3b-T16 | Public checkout page restyle: product header, package selector, add-ons, "Your information", order summary, one button per enabled method, refund note, terms in the same page (no `target="_blank"`), `?package=` lock, correct currency symbol, region select, sold-out message, works in an iframe. | 8 | L | M3b-T09, M3-T29 | F-420 | Playwright at 390 px: place a COD order on the fixture form. Lighthouse run recorded (target under 2 s on 4G is a GUESS). Grep finds no `target="_blank"` in public components. |
| M3b-T17 | Order success screen ("Order placed", `#24118`, what happens next, support WhatsApp, WhatsApp-confirm line when auto-confirm is on) and "This form is not available." screen; digital form rendering (no address fields, email required, online only). | 4 | S | M3b-T16 | F-421, F-422 | Component tests for both screens inside an iframe. |
| M3b-T18 | Payment callback page (provider-neutral, handles slow payment channels): states Confirming, Order received and Payment issue; keeps polling while the payment is pending, then stops with a clear message; reads `reference` or `trxref`. | 5 | M | M3b-T06, M3b-T05 | F-403, F-402 | Page shows the three states. It keeps polling while the payment is pending, then stops with a clear message. Page text no longer says "Nigeria only". Test with the fake provider. |
| M3b-T19 | Pixel and CAPI regression tests: unit tests for pixel helpers, CAPI payload tests with a mocked Meta endpoint, e2e cooldown test, test that browser Purchase `eventID` equals server `event_id` for COD, test that the order display format change does not change event ids. Gate G1: owner reviews Checkout forms and payments here. | 6 | M | M3b-T16, M3b-T18 | F-407 | All tests pass. Owner sign-off for G1 recorded in the PR. One phone test in the Facebook in-app browser is done by the owner. |
| M3b-T20 | Backend integration sweep: forms API rules, public checkout, payment connections, neutral webhook (replay, bad signature, other tenant), fee hook, method matrix; two-tenant tests for every new route and for `PaymentConnection`. | 6 | M | M3b-T07, M3b-T09, M3b-T18 | F-400, F-404, F-406, F-408 | `npm run test:integration --forceExit` passes. Two-tenant tests exist for the new model and each route group. Replaying a webhook changes nothing. |
| M3b-T21 | Playwright e2e: owner creates and edits a form and sees the preview; public COD order at 390 px; digital form paid through the fake provider and the callback page; manager and call rep role checks on forms. | 6 | M | M3b-T19, M3b-T17 | F-420, F-402, F-408 | `npm run test:e2e` for the new specs passes locally against the dev stack. Order success screen shows the `#<id>` number. |
| M3b-T22 | `/simplify` review of the whole M3b diff. Apply fixes. | 4 | S | M3b-T20, M3b-T21 | - | Review notes in PR; follow-up commit; tests still green. |
| M3b-T23 | Full checks: backend `prisma generate`, `npm run build`, `npm run lint`, `npm run test:unit`, `npm run test:integration` (with `--forceExit`); frontend `npm run build:check`, `npm run lint`, `npx vitest run`; `npm run test:e2e`; static checks. Hand-migrate the test DB first. | 4 | S | M3b-T22 | - | All commands exit 0. Output in the PR. |
| M3b-T24 | Browser check (agent-browser or claude-in-chrome) on dev with the fixture: forms list and editor tabs in light and dark at 1440 and 760 px; public form on a 390 px viewport; callback page states; console clean; Facebook in-app browser behaviour noted as not testable locally. | 5 | M | M3b-T23 | - | Screenshots and console log in the PR. Zero uncaught errors. List of pages checked is complete. |
| M3b-T25 | Owner review: Opus reviews the PR. Owner confirms the open points (see below). Push and open the PR to `develop` only after approval. | 3 | S | M3b-T24 | - | Owner approval recorded in the PR. PR targets `develop`. |

## Decide at task time

| Item | Source | Decide in | Suggested default |
|---|---|---|---|
| Names stored for online methods. | F-400 | M3b-T05 | New rows neutral; old names accepted for 90 days. |
| Regions: does `country-state-city` list the regions of the store's country correctly? | F-413 | M3b-T08 | Use the M1-T03 `regions.ts` helper. No second list. |
| Does any manual entry already clear 1030? | Area 10 GUESS, F-934 | M3b-T07 | Query the production ledger; if yes, skip the old-balance Finding. |
| Accounts 5060 and 1030 | F-406, F-934 | M3b-T07 | Both are live in the chart (area 10). M5-T03 adds only 2040, 2050, 3010, 5070, 5080. |
| Amount units of `depositPaid` and `balanceDue` | R15, F-405 | M3b-T06 | M0-T07 and M0-T22 fixed them to Decimal major units. Assume major units; test on the production-dump copy. |
| Date for prepaid physical orders | PRD §10 notes | After M12 | The owner sets the date (GUESS: after M12). Flag stays off. |

## Dependency map

```
Payments:  T02 -> T03 -> T04 -> T05, T06
Fee/pay:   T06 -> T07 ; T06+T05 -> T18
Forms API: T05 -> T08 -> T09
Forms UI:  T08+M3-T29 -> T10 -> T11 -> T12 -> T13 (T05, T04) -> T14 -> T15
Public:    T09+M3-T29 -> T16 -> T17 ; T16+T18 -> T19 (gate G1)
Tests:     T07+T09+T18 -> T20 ; T19+T17 -> T21
Close:     T20,T21 -> T22 -> T23 -> T24 -> T25
```

## Risks for this milestone (PRD §11)

| PRD risk | Risk here | Mitigation |
|---|---|---|
| #27 Scope size | Forms, public page and payments in one PR. | One owner gate (G1). Cut line if time runs out: the Design tab and the live preview (T14, T15). Payment tasks T02 to T07 and the public page stay. |
| Pixel and CAPI regression | Restyle breaks tracking; ad spend is wasted. | T19 tests; no change to pixel helpers; compare event ids. |
| Facebook in-app browser | The public form behaves differently there; cannot be tested locally. | No `target="_blank"` (T16); iframe test; ask the owner for one phone test at G1. |
| Double order from a repeated webhook | A provider sends the same event twice. | `WebhookEvent` replay guard and tests (T06, T20). |
| Fee hook failure swallowed | Sales post but fees do not, so profit looks too high. | T07 opens a Finding on failure. |
| Secrets leak | Provider keys in logs or responses. | Encrypted at rest, masked on read, test for no secret in responses or logs (T04). |

## Effort

Tasks: 24. Task hours are builder hours including tests. O = 80% of likely, P = 160% of likely (planning assumption). Expected = (O + 4 x M + P) / 6. Buffer = 25% on the expected value.

| Estimate | Hours |
|---|---|
| Optimistic (O) | 114 |
| Likely (M) | 142 |
| Pessimistic (P) | 227 |
| Expected (O + 4M + P) / 6 | 151 |
| Expected + 25% buffer | 189 |

**Critical path** (longest dependency chain by effort, 76 h): T02 > T03 > T04 > T05 > T08 > T09 > T16 > T19 > T21 > T22 > T23 > T24 > T25. One builder works the tasks one after another, so calendar time follows the total (likely 142 h, with buffer about 189 h), not the critical path. The critical path is the shortest possible time if several builders work in parallel. Migrations must still be applied one at a time.

## Coverage

Owner rule: an F-ID is owned by the milestone where it lands last. That milestone lists it in its "Owned here" table. Every earlier milestone that does part of the work lists it in its "Partial work" table. Each F-ID is owned by exactly one milestone. Parts that land in a later milestone are named in the milestone text column.

**Owned here (24 F-IDs).** Every one has at least one task.

| F-ID | Requirement milestone text | Task(s) |
|---|---|---|
| F-400 | M3b (was M5) | M3b-T02, M3b-T03, M3b-T04, M3b-T05, M3b-T20 |
| F-401 | M3b (was M5) | M3b-T03, M3b-T04, M3b-T13 |
| F-402 | M3b (was M3 UI, M5 provider) | M3b-T05, M3b-T13, M3b-T18, M3b-T21 |
| F-403 | M3b (was M5) | M3b-T18 |
| F-404 | M0 (remove the legacy route), M3b (provider-neutral route; was M5) | M3b-T02, M3b-T06, M3b-T20 |
| F-405 | M3b (rules; was M5); the money-unit fix runs with M0 (D4) | M3b-T06 |
| F-406 | M3b (was M5) | M3b-T02, M3b-T07, M3b-T20 |
| F-407 | M3b (was M3; tests added with the reskin) | M3b-T19 |
| F-408 | M3b (was M3) | M3b-T02, M3b-T08, M3b-T10, M3b-T20, M3b-T21 |
| F-410 | M3b (was M3) | M3b-T10 |
| F-411 | M3b (was M3) | M3b-T08, M3b-T11 |
| F-412 | M3b (was M3) | M3b-T08, M3b-T11 |
| F-413 | M3b (was M3) | M3b-T08, M3b-T11 |
| F-414 | M3b (was M3) | M3b-T09, M3b-T12 |
| F-415 | M3b (was M3) | M3b-T09, M3b-T12 |
| F-416 | M3b (was M3) | M3b-T08, M3b-T13 |
| F-417 | M3b (was M3) | M3b-T08, M3b-T14 |
| F-418 | M3b (was M3) | M3b-T08, M3b-T14 |
| F-419 | M3b (was M3) | M3b-T08, M3b-T15 |
| F-420 | M3b (was M3) | M3b-T09, M3b-T16, M3b-T21 |
| F-421 | M3b (was M3) | M3b-T17 |
| F-422 | M3b (was M3) | M3b-T08, M3b-T11, M3b-T17 |
| F-423 | M3b (was M5) | M3b-T05 |
| F-934 | M3b (was M5) | M3b-T07 |
