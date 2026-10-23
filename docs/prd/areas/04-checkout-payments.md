# PRD area 04: Checkout forms and payments

Date: 2026-10-18. Builder B1. Status: draft for Opus review.

## 1. Scope

This file covers:
- Gap matrix 1.5 Checkout forms (CF-01 to CF-19). F-IDs F-400 to F-449.
- Payments: the provider interface, Paystack as the first provider (works as today, decision O2), the callback page, webhooks, settlement and the fees hook.
- Broken items (matrix section 3): #24, #38, #42.
- Mockup fixes (matrix section 4): #7, #8, #24.

Screens: Checkout forms list and editor (`checkout-forms.html`), preview modal, public checkout page `/form/:slug`, payment callback `/checkout/payment/callback`, embed widget.

Roles:
- Owner (`super_admin`), `admin`: create, edit, delete forms.
- `manager`: view forms and stats.
- Marketer (a person holding the Marketing role): edits Tracking and Design through the tool allow-list of the role (see Staff area, C, F-1150 range). The base permission is the same as `admin` for forms.
- Customers (no login): use the public page.

Decisions used:
- G1: keep Paystack. The business will take online payments (digital now, physical prepaid later). Build payments behind a provider interface so another provider can replace or join Paystack. (The Ghana sentence of G1 is replaced by O2: Ghana sells by COD; Paystack works as today.)
- D8: a paid digital order counts as delivered revenue. A free bundled digital item does not.
- D4: money columns become Decimal in M0.
- G10: AI cards never change data in release one.
- Matrix section 5 Q1: replaced by G1. Paystack stays on for digital forms; physical prepaid comes later. The old answer "COD only" no longer applies.
- R9: orders from online payment are created after payment succeeds. `payment_pending` and `payment_failed` stay in the enum with no creation path in release one.
- O2 (replaces R14): there is no Paystack Ghana check and no live test charge. Paystack stays behind the provider interface and works as today.
- O3: the form country, currency and regions follow the store's country.

Terms:
- "Online payment" means any payment taken by a provider (card, bank). "COD" means cash on delivery.
- "Provider" means a payment company such as Paystack.
- "Minor units" means the smallest unit of a currency (for example pesewas for GH₵, kobo for ₦). 100 minor units equal 1 major unit.
- "Settle" means: the provider confirms the payment and the app creates the order.

---

## 2. Requirements: Payments (F-400 to F-406)

### F-400: Payment provider interface
- Priority: P1. Milestone: M5.
- Description: Today `paystackService` is called straight from the checkout controller. A second provider (or physical prepaid) would need a rewrite. Put one interface between the app and every provider. Paystack becomes the first adapter. The interface is small. It holds what the app needs: start a payment, check a payment, check a webhook, read the fee.
- Current app: `backend/src/services/paystackService.ts` (`initializeTransaction`, `verifyTransaction`, `validateWebhookSignature`); `paystackSettlementService.ts`; `publicOrderController.ts`; per-tenant keys in `SystemConfig.paystackProvider`. Method names `paystack_deposit`, `paystack_full`, `paystack` are stored in `Order.paymentMethod`.
- Mockup: `connections.html` Paystack card (mode, public key, webhook URL). Add a provider choice there (Connections is area C, F-1200 range).
- Interface (TypeScript shape; names may change in code):
  - `id`: `"paystack"` or a later id.
  - `capabilities(config)`: currencies, methods (`card`, `mobile_money`, `bank_transfer`, `ussd`), countries.
  - `initialize({reference, amountMinor, currency, customer, callbackUrl, metadata})` returns `{authorizationUrl, providerReference}`.
  - `verify(reference)` returns `{status: success | pending | failed | abandoned, amountMinor, currency, feeMinor, channel, paidAt, raw}`.
  - `verifyWebhook(rawBody, headers)` returns true or false.
  - `parseWebhook(rawBody)` returns `{eventId, kind: payment_succeeded | payment_failed | other, reference}`.
- Acceptance criteria:
  - [ ] A `PaymentProvider` interface and a registry exist. `publicOrderController`, the callback verify route and the settlement service use only the interface.
  - [ ] Paystack is the only adapter in release one. A test adapter ("fake provider") exists for tests and proves a second provider can be added with no change to the controller or settlement code.
  - [ ] Provider settings move from the `SystemConfig.paystackProvider` JSON into a `PaymentConnection` record per tenant and provider (design doc 5.3 says provider JSON moves to connection records). Secrets stay encrypted (`enc:v1:`) and are masked on read. The old JSON is read as a fallback until a migration copies it.
  - [ ] A form stores which provider it uses (`CheckoutForm.paymentProvider`). Default: the tenant's default provider for the form currency.
  - [ ] Stored names become provider-neutral for new rows: `Order.paymentMethod` = `online_full` or `online_deposit` and `Order.paymentProvider` = `paystack`. Old values (`paystack`, `paystack_full`, `paystack_deposit`) are still read. The public API accepts both old and new names for 90 days.
  - [ ] CodAdmin's own subscription billing (platform Paystack account) is not part of this interface. It stays as it is.
- Data: new `PaymentConnection` {tenantId, provider, mode (`test`|`live`), publicKey, secretKey (encrypted), isEnabled, supportedCurrencies[], lastCheckedAt}; `CheckoutForm.paymentProvider`; `Order.paymentProvider`; `Transaction.provider`.
- API: `GET/PUT /api/payment-connections` (owner, admin). Public config returns the provider's public key only.
- Permissions: `settings:update` (owner, admin) to change a connection.
- Edge cases and errors:
  - A form that names a provider with no enabled connection cannot be saved with online payment on. The editor says "Connect a payment provider in Connections."
  - Two providers can take the same currency. The form picks one. There is no automatic failover in release one.
- Tests: unit tests of the interface contract with the fake provider; integration test that the controller never imports `paystackService` directly; migration test for the settings copy.

### F-401: Paystack adapter
- Priority: P1. Milestone: M3b.
- Description: The first provider is Paystack. It works as today (decision O2). There is no Ghana check and no live test charge. The code already passes the form currency to Paystack and uses minor units. The mockup and the editor text say "Nigeria only" (`SettingsTab.tsx` line 42); this requirement removes the wrong text.
- Current app: `paystackService.initializeTransaction` sends `currency` and `amount` in minor units. `SettingsTab.tsx` shows "Payment Methods (Nigeria only)".
- Mockup: `checkout-forms.html` Payment tab; `connections.html` Paystack card with the warning "Real customers cannot pay yet" (test mode).
- Acceptance criteria:
  - [ ] Amounts convert to minor units with a single helper (`toMinor(amount, currency)`), rounded to the nearest minor unit. 249.00 in a two-decimal currency is 24900.
  - [ ] The adapter maps Paystack statuses: `success` → success; `abandoned` → abandoned; `failed`, `reversed` → failed; `pending`, `ongoing`, `processing`, `queued` → pending.
  - [ ] The hosted payment page lets the buyer choose from the channels the Paystack account offers. The adapter does not force a channel list.
  - [ ] "Test connection" in Connections calls the provider and stores `supportedCurrencies` and `lastCheckedAt` on the `PaymentConnection`.
  - [ ] If the form currency is not in `supportedCurrencies`, the form editor Payment tab shows "This payment account cannot take <currency>. Connect another account or provider." and blocks turning online payment on.
  - [ ] The text "(Nigeria only)" is removed from the editor.
  - [ ] Receipt email: the buyer's email is required for digital forms. For physical forms the adapter builds a stable placeholder email `<digits>@codadminpro.com` when the buyer leaves it blank (as today). The placeholder domain is skipped by email sends (as today).
- Data: `PaymentConnection.supportedCurrencies`.
- API: `POST /api/payment-connections/:id/test`.
- Permissions: owner, admin.
- Edge cases and errors:
  - A slow channel (for example a bank transfer) is asynchronous. The buyer may pay minutes later. The callback page handles this (F-403).
- Tests: unit tests for `toMinor` (249.00, 59.00, 0.01), status mapping for 8 statuses; contract test against the Paystack test API in CI (optional, flagged).

### F-402: Payment methods on a form, and the physical-prepaid flag
- Priority: P1. Milestone: M3 (UI), M5 (provider).
- Description: A form offers COD, online deposit, online full payment. Release one shows COD only for physical products (matrix CF-09). Deposit and full payment stay in the code behind a flag, ready for physical prepaid (G1). Digital forms always pay online in full.
- Current app: `CheckoutForm.codEnabled`, `paystackDepositEnabled`, `paystackFullEnabled`, `depositPercent`. `SettingsTab.tsx` shows three options, maximum two on. The server checks the chosen method against the form toggles. Digital products force `paystack_full`.
- Mockup: `checkout-forms.html` Payment tab (maximum two on): Cash on delivery; Pay a deposit (Paystack) with "% paid online (30)"; Pay in full (Paystack, "Needs your Paystack keys in Connections").
- Acceptance criteria:
  - [ ] New tenant setting `features.prepaidPhysical` (boolean, default false) in `SystemConfig`. Only the owner or an admin can change it, in Settings → Operations (area C, F-1200 range). A developer can also set it.
  - [ ] Flag off, physical form: the Payment tab shows only "Cash on delivery" (on, locked). Deposit and full payment are hidden. The public page shows the "Place order" button for COD only.
  - [ ] Flag on, physical form: the Payment tab shows all three with the maximum-two rule and the deposit percent (1 to 99). A line says which provider takes the payment and shows the F-401 currency warning if any.
  - [ ] Digital form: the tab shows "Online payment in full" (on, locked) and no COD or deposit. This holds with the flag on or off.
  - [ ] The server rejects a payment method the form does not allow (as today).
  - [ ] The Paystack text in Connections: "Real customers cannot pay yet" shows only when the connection is in test mode (area C). It does not show in live mode.
  - [ ] "Ask for prepayment" does not exist anywhere (matrix section 4 E4).
- Data: `SystemConfig.features.prepaidPhysical`; no change to form columns.
- API: `PUT /api/checkout-forms/:id` validates methods against the flag and the form type.
- Permissions: owner, admin.
- Edge cases and errors: turning the flag off while forms still have online methods on: the forms keep the stored toggles, the public page hides them, and the server rejects them. The editor shows a note "Online payment is paused for physical products."
- Tests: unit test of the method matrix (form type x flag); integration test that a tampered request with a disabled method is rejected.

### F-403: Payment callback page
- Priority: P1. Milestone: M5.
- Description: After paying, the provider sends the buyer back to `/checkout/payment/callback?reference=...`. The page confirms the payment and shows the result. It must handle slow channels, where the result can take minutes. It is provider-neutral. It is needed for digital orders paid online and for physical prepaid later.
- Current app: `frontend/src/pages/PaymentCallback.tsx`. States: "Confirming your payment", "Order received", "Payment Issue". Calls `GET /api/paystack/verify/:reference` once. It reads `reference` or `trxref`. It ignores the form's `redirectUrl`. It fires no pixel.
- Mockup: none (matrix CF-17 MISSING-IN-MOCKUP). Build in v2 style: a centred card on the form's colours (primary colour and logo area) with an icon, a heading, one sentence and one button.
- Acceptance criteria:
  - [ ] Route stays `/checkout/payment/callback`. It reads `reference` or `trxref`.
  - [ ] `GET /api/payments/verify/:reference` (the old `/api/paystack/verify/:reference` stays as an alias) returns `{status: success | pending | failed | not_found, orderNumber?, orderType, formSlug, redirectUrl?}`. It returns nothing else (no customer data). It is rate limited (30 per 15 minutes per IP).
  - [ ] State "Confirming": spinner, "Confirming your payment. Please wait."
  - [ ] State "Pending" (the payment is not confirmed yet): "We are waiting for your payment to be confirmed." The page asks again every 5 seconds for up to 5 minutes. After 5 minutes: "We have not received your payment yet. If you were charged, your order will appear within a few minutes. Your reference is <reference>."
  - [ ] State "Success": "Order received. Your order number is #24118." For a digital order add "We sent the download link to <email>." If the form has a `redirectUrl`, the page redirects to it with the same query parameters as COD (`orderId`, `total`, `currency`, `reference`, `package`) after 2 seconds.
  - [ ] State "Failed": "The payment did not go through." and a button "Try again" that opens `/form/<formSlug>`. "If you were charged, send us your reference <reference>."
  - [ ] State "Not found": "We could not find this payment. Check the link or contact us." (bad or expired reference).
  - [ ] The page reads store support contacts (support WhatsApp from Business details) and shows them under the failed and not-found states.
  - [ ] The page is idempotent. A reload or a second tab does not create a second order (the settlement service guarantees this, F-405).
  - [ ] No browser Purchase pixel on this page (as today). Server events handle it (F-407).
- Data: none.
- API: `GET /api/payments/verify/:reference` (public).
- Permissions: public.
- Edge cases and errors:
  - The webhook can arrive before the buyer's browser returns. The verify call then finds the order already created and returns success.
  - A reference from another tenant returns `not_found` (never data from another tenant).
  - The buyer closes the page before the redirect. The webhook still creates the order (F-404).
- Tests: component tests for the six states; integration test of verify with the fake provider returning pending then success; e2e: pay in test mode and land on the success state.

### F-404: Payment webhooks
- Priority: P0. Milestone: M0 (remove the legacy route), M5 (provider-neutral route).
- Description: Providers call the app when a payment succeeds. The webhook is the safety net when the buyer does not come back to the callback page. It must be signed, tenant-scoped and safe to repeat.
- Current app: `POST /api/paystack/webhook/:tenantSlug` (HMAC SHA-512 with the tenant secret key, replay guard in `WebhookEvent`, handles `charge.success`). `POST /api/paystack/webhook` is a legacy route that returns HTTP 410. Its sunset date (2026-09-01) has passed (`paystackController.ts` line 118).
- Mockup: `connections.html` Paystack card shows the webhook URL with a copy button.
- Acceptance criteria:
  - [ ] Remove the legacy route `POST /api/paystack/webhook` and `handleLegacyWebhook` (matrix section 3 #38). Before removal, check the server logs for the last 14 days. If any hit exists, keep the 410 for another 30 days and note it in the release.
  - [ ] New route `POST /api/payments/webhook/:provider/:tenantSlug`. The old `POST /api/paystack/webhook/:tenantSlug` stays as an alias, because tenants have it saved in their Paystack dashboard. Both call the same handler.
  - [ ] The handler reads the raw body, checks the signature through the provider interface, and answers HTTP 401 on a bad signature. All other outcomes answer HTTP 200 so the provider does not retry forever.
  - [ ] Replay guard: unique `(tenantId, provider, eventType, reference)` in `WebhookEvent` (as today). A repeated event does nothing.
  - [ ] Event `payment_succeeded` calls the settlement service (F-405). Other events are logged and ignored.
  - [ ] A sweep job runs every 10 minutes. For each `PendingCheckout` older than 10 minutes and not resolved, it asks the provider (`verify`). If the answer is success it settles. If the answer is failed or abandoned it marks the row `failed` or `expired`. This covers a lost webhook and a buyer who never returned. Rows older than 24 hours are deleted (as today, `pending-checkout-cleanup`).
  - [ ] If the provider says the money was taken but settlement cannot create the order (amount too low, currency mismatch, missing product), the system creates an Inbox alert for the owner: "Payment received but no order was created. Reference <reference>." (F-557). The row stays for manual review. The owner can run the existing admin verify route `GET /api/payments/admin/verify/:reference`.
  - [ ] Webhook calls are logged (tenant, provider, event, result) for 30 days.
- Data: `PendingCheckout.status` (`initiated`, `pending`, `failed`, `expired`, `needs_review`) and `PendingCheckout.lastCheckedAt`; add `PendingCheckout` and `WebhookEvent` to the tenant-scoped list (F-363 in file 03).
- API: routes above.
- Permissions: public, signature protected.
- Edge cases and errors:
  - The webhook for tenant A can never settle a checkout of tenant B (tenant check, as today).
  - The sweep must not settle a checkout twice. The atomic claim in F-405 prevents it.
  - If Redis is down the sweep job does not run. The callback page still works.
- Tests: signature tests (valid, invalid, wrong length); replay test; sweep job test with a fake provider; two-tenant isolation test.

### F-405: Settlement and online order creation
- Priority: P0. Milestone: M5 (rules); the money-unit fix runs with M0 (D4).
- Description: When a payment is confirmed, one function creates the order. This is the deferred-creation model, and we keep it. No order exists until the money is confirmed. Abandoned or failed payments leave no order. The rules below are mostly what the code does now. New rules are marked.
- Current app: `paystackSettlementService.settlePaystackPayment`. Order is created with status `confirmed`. Deposit orders get `paymentStatus = deposited`; full payments `paid`. Digital orders get a download token, an email and status `digital_delivered`. A GL entry is posted for digital sales.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] One function `settlePayment(reference, {webhookTenantId?})`. The first caller deletes the `PendingCheckout` row (atomic claim) and creates the order. A second caller gets the existing order. Callback, webhook and sweep job all use it.
  - [ ] Checks before creating: the tenant matches; the provider says success; **the currency equals the pending checkout currency (new)**; the amount paid is at least the expected charge.
  - [ ] Physical online order: status `confirmed`, `paymentStatus = paid` (full) or `deposited` (deposit). `codAmount` is the balance due (0 for full payment).
  - [ ] Digital online order (D8): created `confirmed`, then moved by the machine (system actor) to `digital_delivered` after the download link is sent. `deliveryDate` is set to the payment time. The order counts as delivered revenue on that date.
  - [ ] A digital item with a unit price of 0 on a physical order is a free bundled item (D8). It adds 0 to revenue, creates no separate order and never sets `digital_delivered` on the physical order.
  - [ ] If the download link cannot be sent, the order stays `confirmed` with the note "Automatic digital delivery failed. Customer was charged. Manual resend required." The order list shows the flag "Digital delivery failed" (file 03, F-312). The owner uses "Resend link" in the drawer. The resend moves the order to `digital_delivered`.
  - [ ] Order money units (new): `Order.depositPaid` and `Order.balanceDue` are stored in minor units today (`depositPaid: paidMinor`) while `totalAmount` and `codAmount` are in major units. The D4 migration converts both to major-unit Decimal. The migration divides existing values by 100. Check the data first in M0, before the Decimal migration (decision R15; see edge cases).
  - [ ] Customer totals are not incremented here. The customer stats service recomputes them (file 03, F-357).
  - [ ] Side effects after creation (all best-effort, none can undo the order): workflow `order_created` and `payment_received` triggers (F-507), socket event, CAPI Purchase (F-407), form submission record, order history row "Payment confirmed via <provider> (ref: ...)".
  - [ ] Prices are re-calculated on the server from the form packages and upsells. The client total is never trusted (as today).
  - [ ] Release one creates no order in `payment_pending` or `payment_failed`. These two states are defined in file 03 (F-301) and are used when physical prepaid or staff pay links ship.
- Data: `Order.paymentProvider`, `Order.paymentReference` (kept, unique per tenant); `Order.depositPaid`, `Order.balanceDue` become `Decimal(19,4)` in major units.
- API: none new.
- Permissions: system.
- Edge cases and errors:
  - Decision R15: verify in M0 whether old online orders store `depositPaid` and `balanceDue` in minor units (GUESS until checked). Check with a query on production (`SELECT payment_method, deposit_paid, total_amount FROM orders WHERE deposit_paid > 0`) before you divide by 100. If some rows are in major units the migration must tell them apart (for example `deposit_paid > total_amount`).
  - Overpayment: accepted. The order total is not changed. The extra is noted in the history.
  - Underpayment: no order. The checkout row goes to `needs_review` and the owner gets the alert in F-404.
  - Two payments for one cart (buyer pays twice): two references, two orders. The owner sees both. No automatic refund in release one.
  - Product deactivated or out of stock between initialize and settle: the order is still created (the customer paid). Stock is checked at dispatch (file 03, F-305).
- Tests: unit tests per check; concurrency test (webhook and callback at the same time create one order); digital delivery failure test; unit test that a price-0 digital line adds 0 revenue; migration test for the unit conversion.

### F-406: Fees booking hook
- Priority: P1. Milestone: M5.
- Description: Each settled online payment has a provider fee. The fee must be booked as an expense, on the day of the payment, with the sale. Today the fee is posted for digital sales only and a failure is swallowed in a log line. The new design is a hook that other parts of the app subscribe to. Finance posts the entries. This requirement defines the hook and the data it carries.
- Current app: `GLAutomationService.createDigitalSaleEntry` (DR 1030 Paystack receivable, DR 5060 Paystack fees; CR 4020 Digital revenue, CR 1030). `Transaction.metadata.fees`. Errors are caught and logged.
- Mockup: none. Finance screens are in area C (F-900 range).
- Acceptance criteria:
  - [ ] After settlement the service emits `payment.settled` with `{tenantId, orderId, provider, reference, currency, amount, fee, channel, paidAt, orderType, method}`. Amounts are Decimal in major units.
  - [ ] Subscribers: (1) the transaction recorder, (2) the ledger poster, (3) CAPI Purchase, (4) workflow trigger `payment_received`, (5) Inbox alerts.
  - [ ] `Transaction` stores `provider`, `channel`, `currency`, `feeAmount` (Decimal), `providerReference`, `paidAt`. The fee comes from the provider `verify` response (`feeMinor`). If the provider gives no fee, `feeAmount` is 0 and the row is marked `feeUnknown = true`.
  - [ ] Digital sale: the ledger poster posts the existing entry (accounts 1030, 4020, 5060 keep their codes; matrix section 4 E1) with `entryDate` = payment date. The account names read "Online payments receivable" and "Payment provider fees".
  - [ ] If posting fails, the job retries 3 times with backoff and then creates an Inbox alert "Ledger entry failed for payment <reference>". The order and the payment are not undone. No silent log-only failure.
  - [ ] Physical online payments (prepaid, later) use the same hook. Their ledger treatment (cash received before delivery, revenue on delivery date) is defined by the Finance area when the flag in F-402 is turned on. Until then the poster does nothing for physical online payments and logs a warning.
  - [ ] The provider payout (money arriving in the bank, later than the sale) clears account 1030. The payout screen belongs to Finance (C, F-900 range).
  - [ ] Finance summary includes account 4020 and 5060 (matrix section 3 #47, closed in the KPI work, area A and C).
- Data: `Transaction` columns above.
- API: none new.
- Permissions: system.
- Edge cases and errors: fee in a different currency than the sale (rare): store the fee in the charge currency and let Finance convert with the day's rate (S3).
- Tests: unit tests for the hook payload; integration test that a digital sale posts balanced entries; retry test with a failing poster.

---

## 3. Requirements: Pixel and CAPI (F-407)

### F-407: Pixel and CAPI behaviour that exists today (keep as is)
- Priority: P0 (regression guard). Milestone: M3 (tests added with the reskin).
- Description: Meta tracking works today and the owner depends on it. The Facebook in-app browser blocks `fbq` often, so the page sends a pixel beacon next to `fbq`, and the server sends CAPI events with the same event id. This behaviour must not change in the reskin. This requirement lists every behaviour so tests can guard it.
- Current app: `frontend/src/utils/pixelTracking.ts`; `PublicCheckout.tsx`; `components/public/OrderSuccess.tsx`; `backend/src/services/metaCapiService.ts`; `publicOrderController` (route `/forms/:slug/track/initiate-checkout`).
- Mockup: `checkout-forms.html` Tracking tab (see F-416).
- Behaviours to keep:
  1. Pixel config comes from the form: `facebookPixelId` (digits only), `googleAnalyticsId`, `tiktokPixelId`, `googleTagManagerId`. A non-numeric Facebook id is ignored.
  2. On page load (when the form has a pixel config), the page loads each pixel and sends PageView. For Facebook: the standard snippet, `fbq('track','PageView')` with an `eventID`, and an image beacon to `facebook.com/tr` with the same `eid`.
  3. InitiateCheckout fires once per page load, right after load (not on first click). Facebook: `fbq` plus beacon with a shared `eventID`. GA4: `begin_checkout`. TikTok: `InitiateCheckout`. GTM: `dataLayer` event `begin_checkout`.
  4. The browser then calls `POST /api/public/forms/:slug/track/initiate-checkout` with `{eventId, eventSourceUrl, fbp, fbc}`. The server sends CAPI InitiateCheckout with the same `event_id`. It is best effort and never blocks checkout.
  5. Duplicate guard: a set of sent beacons per pixel and event stops double sends from remounts.
  6. Purchase in the browser (COD only): on the success screen, `fbq('track','Purchase', {value, currency})` plus beacon, `eventID = String(orderId)`. GA4 `purchase` with `transaction_id`. TikTok `CompletePayment`. GTM `purchase`. Once per order id.
  7. Purchase on the server: CAPI `Purchase` with `event_id = paymentReference || String(order.id)`. COD: sent when the order is created (status `pending_confirmation`). Online payment: sent at settlement. The flag `Order.capiEventFired` makes it run once. A failed send leaves the flag false so a later call can retry.
  8. User data in CAPI is SHA-256 hashed after normalizing (email, phone, first name, last name, city, country). `fbp`, `fbc`, client IP and user agent are sent raw. `fbp` and `fbc` come from the browser cookies (`_fbp`, `_fbc` or the `fbclid` parameter) and are stored on the order.
  9. Test events: the per-form `metaCapiTestEventCode` is sent when set. The CAPI access token is write-only and masked.
  10. Double-submit cooldown: after an order the page stores `checkout_cooldown_<slug>` in `localStorage` for 10 minutes. A reload inside that time shows the success screen with the same order number and does not post again. Storage errors are caught.
  11. Embedded forms post the iframe height to the parent as `{type: 'checkout-resize', height}`.
  12. Paid orders: no browser Purchase (the callback page has none). The server Purchase uses the payment reference as the event id.
- Acceptance criteria:
  - [ ] Every behaviour above has an automated test (unit for the helpers, integration for CAPI payloads with a mocked Meta endpoint, e2e for the cooldown).
  - [ ] A test proves the browser Purchase `eventID` equals the server `event_id` for COD (both `String(orderId)`).
  - [ ] Changing the order number display format (file 03, F-300) does not change event ids.
  - [ ] The Marketing funnel step "Checkouts started" (area C, F-1000 range) counts the InitiateCheckout event. Its meaning ("form opened") is written in the KPI dictionary notes.
- Data: none. API: none.
- Permissions: public.
- Edge cases and errors:
  - COD Purchase counts orders that are not yet confirmed. This is by design today. CPA is "cost per order placed" (design 4.3). Do not change it without a new owner decision.
  - Pixel events fire for blocked-COD orders (file 03, F-357) like any other COD order.
- Tests: as listed.

---

## 4. Requirements: Checkout forms (F-408 to F-449)

### F-408: Form list
- Priority: P1. Milestone: M3.
- Description: The list shows each form with its link, orders, conversion, active switch and actions. It keeps clone, preview, edit and delete.
- Current app: `frontend/src/pages/CheckoutForms.tsx`. Columns: name, description, fields, packages, upsells, status. Actions Edit, Clone, Preview, Delete. `GET /api/checkout-forms`.
- Mockup: `checkout-forms.html` list: Form (name, product), Link (`/form/<slug>` and a copy button), Orders this month, Conversion, Active (switch), Actions (Clone, Preview, Edit, Delete). Header button New form.
- Acceptance criteria:
  - [ ] Columns as in the mockup. Order and conversion figures come from F-409.
  - [ ] Active switch calls `PUT /api/checkout-forms/:id` with `isActive`. An inactive form returns "Form not found" on the public page (F-421).
  - [ ] Clone copies fields, packages, upsells, design, payment settings and tracking. The copy gets the name "<name> (copy)", a new unique slug, and starts inactive.
  - [ ] Preview opens the modal of F-419.
  - [ ] Delete uses the shared confirm dialog (file 03, F-328): "Delete Magic Groove copybook set? 1,198 orders came from this form." If the form has submissions, it is archived instead of removed: it disappears from the list, its slug stays reserved and its public link shows "Form not found". If it has none, it is removed.
  - [ ] An archived form can be restored by the owner from a "Show archived" toggle.
  - [ ] No role guard bug: only `super_admin`, `admin` and `manager` see the page (the current route has no guard; the API does).
- Data: `CheckoutForm.archivedAt DateTime?` (today a form with submissions is "deactivated", which looks the same as a paused form).
- API: `GET /api/checkout-forms?archived=`; `POST /api/checkout-forms/:id/clone` (new, replaces create-based clone); `POST /api/checkout-forms/:id/restore`.
- Permissions: view: owner, admin, manager. Create, edit, delete, clone: owner, admin.
- Edge cases and errors: slug collisions on clone get a numeric suffix. Deleting the only active form for a product shows a warning "No active form sells this product."
- Tests: integration tests for clone and archive; component test for the list.

### F-409: Form stats, visit counter and device split
- Priority: P1. Milestone: M8.
- Description: The mockup shows orders, visits and conversion per form (Visit to order 6.8% on 21,250 visits) and a device split (mobile 5.9%, desktop 9.4%). The app does not count visits today. Add a light counter. The existing `/stats` endpoint has no screen.
- Current app: `GET /api/checkout-forms/:id/stats` (service function, no UI). No visit count.
- Mockup: list KPI tiles: Forms 4 (3 live); Orders from forms in October 1,445; Visit to order 6.8% (21,250 visits); Most picked package "2 sets" 47% of orders. Agent cards: "The 3 set package is picked by only 9%" and "Mobile converts at 5.9%, desktop at 9.4%".
- Acceptance criteria:
  - [ ] The public page calls `POST /api/public/forms/:slug/track/visit` once per browser session (a flag in `sessionStorage`, with a safe fallback). The server adds 1 to `FormVisitDay (formId, date, device)`. Device comes from the user agent: `mobile`, `tablet` or `desktop`. Known bots are not counted.
  - [ ] Visit to order = orders created from the form ÷ visits, per form and overall, for the period. Orders count `source = checkout_form` orders not deleted (cancelled included, same as "orders placed").
  - [ ] Tiles: Forms (live of total); Orders from forms (period); Visit to order (period, visits shown); Most picked package (share of orders, from `FormSubmission.selectedPackage`).
  - [ ] Device conversion needs the device on the order. Store `FormSubmission.device`.
  - [ ] The page shows no figure when visits are 0 ("No visits yet").
  - [ ] Suggestion cards (read-only, G10): package share low; mobile versus desktop gap. "Test GH₵599" opens the editor on the Packages tab with the price field filled and the form marked "Unsaved changes". "Move it up" opens the editor on the Fields tab. Nothing saves until the user clicks Save.
  - [ ] Period selector: This month (default), Last 7 days, Last month.
- Data: new `FormVisitDay {tenantId, formId, date, device, visits}` with unique `(formId, date, device)`; `FormSubmission.device`.
- API: `POST /api/public/forms/:slug/track/visit`; `GET /api/checkout-forms/stats?from=&to=`; `GET /api/checkout-forms/:id/stats`.
- Permissions: view: owner, admin, manager.
- Edge cases and errors:
  - Visits do not exist before this ships. Show "Visits counted from <date>."
  - The visit call is fire and forget. It must not slow the form or block ad-blocker users.
  - Embedded forms count too (same page).
  - Visit counts are lower than Meta "landing page views" (43,000) because Meta counts the page before the form. Do not compare them.
- Tests: unit test of the device parser (10 user agents); integration test that a visit increments one row; unit test of the conversion formula.

### F-410: Copy link and embed code
- Priority: P2. Milestone: M3.
- Description: Header buttons copy the public link and the embed code.
- Current app: `CopyActions.tsx` in the Packages tab (checkout link per package, embed snippet).
- Mockup: header buttons "Copy link" and "Copy embed code (iframe snippet)".
- Acceptance criteria:
  - [ ] "Copy link" copies `https://<host>/form/<slug>`. If the form has a locked package, a menu lets the user copy `?package=<id>` links per package (current feature, keep).
  - [ ] "Copy embed code" copies the iframe or widget snippet. The snippet loads only on origins in the form's allowed list.
  - [ ] The mockup host `pay.codadmin.com` is a sample. The real host comes from config.
  - [ ] A toast confirms: "Link copied."
- Data: none. API: none.
- Permissions: owner, admin, manager.
- Edge cases and errors: clipboard denied → show the text in a selectable box.
- Tests: component test.

### F-411: Basics tab
- Priority: P1. Milestone: M3.
- Description: Name, product, link, description, thank-you page, allowed domains, country. The link (slug) stays read-only. The country follows the store.
- Current app: `BasicsTab.tsx` and `SettingsTab.tsx`: name*, slug (read-only, auto from name), product*, description, default country, thank-you URL (`redirectUrl`), allowed origins (one per line).
- Mockup: Basics: Form name; Product; Link (`pay.codadmin.com/form/` + slug, editable); Description; Default country; Thank you page; Embed on your site.
- Acceptance criteria:
  - [ ] Slug is read-only after creation. The mockup shows it editable. Keep it read-only (the current rule) because links are in live ads.
  - [ ] Default country is read-only and shows "<country> (from your store)". The value copies from the store setting (matrix section 4 #8). A form never has a different country from the store in release one. Existing forms keep their stored country.
  - [ ] Currency shows next to the country (the store currency). It is read-only.
  - [ ] Thank-you URL must start with `https://`. Empty means the built-in screen.
  - [ ] Allowed domains: one per line; each must be a valid host. Empty means the form cannot be embedded outside the app.
  - [ ] Product select lists active products. A digital product sets the form type (F-422).
- Data: none new.
- API: `PUT /api/checkout-forms/:id`.
- Permissions: owner, admin.
- Edge cases and errors: changing the product on a form that has orders is allowed. It changes new orders only. A warning says so.
- Tests: validation unit tests for URL and domains.

### F-412: Fields builder
- Priority: P1. Milestone: M3.
- Description: The owner chooses the fields the buyer fills in. Keep every current feature. Add the mapping of "City or town" to the order's town.
- Current app: `FieldsTab.tsx`, `FieldEditModal.tsx`. Nine field types; standard keys; width; required; drag to reorder; the guard "This form can't take orders yet" when required standard keys are missing.
- Mockup: Fields list (label, type and "sends to", width tag, edit icon); edit popover (Label; Sends to; Required; Width Full or Half; Remove; Done); add-field types.
- Acceptance criteria:
  - [ ] Field types: Text input, Email, Phone number, Number, Text area, Dropdown, Checkbox, Multi select, State (region list).
  - [ ] "Sends to" (standard keys): Customer name, Phone, Alternate phone, Email, Region, City or town (new), Street address, Order notes (new), Custom field only. `region` writes `Order.deliveryState` and `Customer.state`. `city` writes `Order.deliveryArea` and `Customer.area`. Today settlement writes the state into both. After this change a form with no City field writes the region into the town too, so old forms still work.
  - [ ] The mockup sample field "WhatsApp number" sends to Alternate phone. That is allowed (a label only).
  - [ ] Required standard keys for a physical form: name, phone, street address, region. For a digital form: name, phone, email. A form missing them cannot be activated ("This form can't take orders yet. Add: Street address.").
  - [ ] Drag to reorder (not shown in the mockup) is kept, with up and down buttons for keyboard use.
  - [ ] Width 50% puts two fields on one row (phone width).
  - [ ] Phone validation: 8 to 15 digits (current rule); stored in one format (file 03, F-362).
  - [ ] Field edits update the live preview at once (F-419).
- Data: none new. `FormField.standardKey` gains `city`, `notes`.
- API: `PUT /api/checkout-forms/:id` validates standard keys.
- Permissions: owner, admin.
- Edge cases and errors: removing a field that the pixel (CAPI) uses for matching (email, phone, name, town) shows a note "This field helps Meta match buyers."
- Tests: unit test of the required-keys guard; integration test that `city` fills `deliveryArea`.

### F-413: Regions list
- Priority: P1. Milestone: M3.
- Description: The region select uses the regions of the store's country (decision O3). Owner decision 2026-10-23: the buyer's form labels this field "State". New forms default to "State", and the editor ("Sends to" option, required-field guard) uses the same word. Every screen that asks for a region (checkout, New order, Import, Messages filter, Workflows, Customers) uses the same list. The mockups use 6 or 7 regions, and Reports shows cities as regions (matrix section 4 #24).
- Current app: `CheckoutForm.regions` JSON (`regions.available`), filled from `country-state-city` when the country changes (`CheckoutFormBuilder.tsx` line 144). `utils/countries.ts` `getRegionsForCountry`.
- Mockup: New order drawer lists 7 regions; Messages bulk send lists 5 regions; Reports lists cities.
- Acceptance criteria:
  - [ ] One shared helper (`regions.ts`, backend and frontend share it) returns the regions for a country from `country-state-city` data. There is no fixed list of one country's regions in code.
  - [ ] A new form starts with all regions of the store's country available. The editor lets the owner remove regions the business does not serve. At least one must stay.
  - [ ] GUESS: the `country-state-city` library may list a country's regions under older names. Check the list for the store's country when the owner picks it. The owner can rename or remove a region in the form editor.
  - [ ] Labels: "Region" for the country's regions, "Town or area" for the free town field. A table that shows cities is titled "City", never "Region".
  - [ ] The list is the allowed value set for imports (file 03, F-319), the workflow "Region is X" condition and the Workflow "Assign to" action (F-511).
- Data: `CheckoutForm.regions` stays JSON. New shared helper.
- API: `GET /api/reference/regions` (uses the store's country; optional `?country=`) (public, cached).
- Permissions: public read.
- Edge cases and errors: an old order may carry a region like "Accra" or "Greater Accra Region". A one-time migration maps known variants to the country's region names and lists the rest in a report. It does not guess.
- Tests: unit test that the helper returns the regions for two countries (for example Ghana and Nigeria) with unique names; migration test of 10 variants.

### F-414: Packages
- Priority: P1. Milestone: M3.
- Description: Packages are the offer tiers (1 set, 2 sets, 3 sets). Keep the current model: percent or fixed discount, original price, popular, highlight. Show the mockup table with a badge column.
- Current app: `PackagesTab.tsx`, `PackageEditor.tsx`; `FormPackage` (price, quantity, discountType none/percent/fixed, discountValue, originalPrice, isPopular, isDefault, highlight text).
- Mockup: table Sets, Name, Discount (GH₵), Final price (sets × GH₵249 − discount), Badge, Default (radio), remove; Add package. Sample: 1 set GH₵249; 2 sets (discount 49, "Best deal", default) GH₵449; 3 sets (discount 118) GH₵629.
- Acceptance criteria:
  - [ ] Final price = quantity × product price − discount. The table shows it live. For 2 sets: 2 × 249 − 49 = 449. For 3 sets: 3 × 249 − 118 = 629 (matches NUMBERS.md).
  - [ ] Percent discounts are kept in the editor (not in the mockup table). The table shows the computed GH₵ discount for them.
  - [ ] The Badge column is the "popular" flag and its text ("Best deal", "Most popular").
  - [ ] Exactly one default package. The radio changes it.
  - [ ] Reps use these tiers on the call (upsell panel, area B2 F-750 range). Changing a package price here changes what the rep can offer.
  - [ ] The server checks the package belongs to the form and re-computes the price.
- Data: none new. API: existing.
- Permissions: owner, admin.
- Edge cases and errors: a package with quantity 0 or a negative final price is blocked.
- Tests: unit test of the price formula for none, percent, fixed.

### F-415: Upsells
- Priority: P2. Milestone: M3.
- Description: Add-ons the buyer can tick (refill pens GH₵40, pencil grip trainer GH₵35). Keep manual and product-based upsells, image and discount.
- Current app: `UpsellsTab.tsx`, `UpsellEditor.tsx`; `FormUpsell`.
- Mockup: switch on; Product; Price; Headline ("Add 5 refill pens"); second upsell off; "Add upsell" (dead). Hint "35% of copybook buyers also buy pens".
- Acceptance criteria:
  - [ ] "Add upsell" works. Fields: source (a product or manual), headline, description, image, quantity, price, discount, popular flag, on or off.
  - [ ] An upsell tied to a product must be active and in stock for the buyer to see it. Out of stock upsells are hidden from the public page.
  - [ ] The hint "35% of copybook buyers also buy pens" is computed from orders (orders that have the upsell ÷ orders). It shows only when there are at least 30 orders.
  - [ ] Upsell lines become `OrderItem` rows with `itemType = upsell`.
  - [ ] Upsell stock follows the same rule as packages: no stock moves at creation (file 03, F-305). Today the public order service does not decrement upsell products at all.
- Data: none new.
- API: existing.
- Permissions: owner, admin.
- Edge cases and errors: an upsell on a digital form is allowed only if the upsell product is digital.
- Tests: component test; integration test that an upsell line is saved.

### F-416: Tracking tab
- Priority: P1. Milestone: M3.
- Description: Pixel and conversion API settings live on the form only. Connections shows a read-only summary (matrix section 4 #7). Today the mockup has two different Facebook pixel ids in two places.
- Current app: `SettingsTab.tsx` Tracking and Pixels: Facebook Pixel ID, Google Analytics 4 ID, TikTok Pixel ID, Google Tag Manager ID, Meta Conversion API access token (write-only, masked), Meta CAPI test event code. Help text links to `/settings/integrations`, which is not a route (matrix section 3 #24).
- Mockup: Tracking tab (six fields; token shows "Connected"). `connections.html` "Checkout website" card repeats the pixel id (318204419037722) and a "Send server events" switch.
- Acceptance criteria:
  - [ ] Pixel ids, CAPI token and test event code are edited only in this tab, per form.
  - [ ] The Connections "Checkout website" card (area C) shows a read-only summary per form: pixel id, "Server events on" when a CAPI token exists. It has no input and no second pixel field. The "Send server events" switch is removed: server events are on when a token exists.
  - [ ] The help text links to Connections (`/connections`), not to `/settings/integrations` (matrix section 3 #24).
  - [ ] Validation: Facebook pixel id digits only (as the loader requires); GA4 id starts `G-`; GTM id starts `GTM-`.
  - [ ] The token field never returns its value. It shows "Connected" and a Replace button.
  - [ ] "Send a test event" button: sends a CAPI test event with the form's test code and shows the Meta response.
- Data: none new.
- API: `PUT /api/checkout-forms/:id`; `POST /api/checkout-forms/:id/test-event`.
- Permissions: owner, admin, marketer.
- Edge cases and errors: a form cloned from another copies the pixel id but not the CAPI token (token needs re-entry, to avoid sharing secrets by mistake). The clone shows a note.
- Tests: validation unit tests; test that the token is never in a GET response.

### F-417: Design tab (colours, button, input style, layout)
- Priority: P2. Milestone: M3.
- Description: The look of the public form. Keep all current controls and show them in the v2 editor.
- Current app: `DesignTab.tsx`: colours (primary, CTA/button, surface/accent, text) with 12 swatches and custom hex; button shape (square, rounded, pill), size (S, M, L), label override (max 60); input style (flat, outlined, filled); hide product name and description; show order summary; offer position (top or bottom).
- Mockup: Design tab: Primary and button colour (5 swatches); Button shape; Button size; Button style (Flat, Outlined, Filled); Button label ("Place order"); Show order summary; Offer position.
- Acceptance criteria:
  - [ ] All current controls remain. Colours keep the validated palette (colours are checked server side).
  - [ ] The mockup "Button style (Flat, Outlined, Filled)" maps to the current input style control. Label it "Field style" to avoid confusion with the button.
  - [ ] Every change shows in the live preview at once.
  - [ ] Dark mode of the admin app does not change the public form colours.
- Data: none new.
- API: existing.
- Permissions: owner, admin, marketer.
- Edge cases and errors: low contrast between button colour and button text shows a warning (contrast under 4.5:1).
- Tests: component test; unit test of the contrast check.

### F-418: Design options missing from the mockup
- Priority: P3. Milestone: M3.
- Description: The gap matrix lists label colour, price colour, hide product name and description, page background and banner as current options missing from the mockup. Code check: `types/checkout-form.ts` defines `labelColor`, `priceColor`, `background` and `productBanner`, and `DesignTab.tsx` has a control only for hide product display. The public page does not read `background` or `productBanner`. So these options may be typed but not live (see report). Decision for the PRD: build the controls and make the public page honour them, because the owner asked to keep all current options.
- Current app: `CheckoutFormDesignInput.labelColor`, `priceColor`; `CheckoutFormDesignPage.background`, `productBanner`, `hideProductDisplay`.
- Mockup: not in mockup. Add to the Design tab in v2 style: two colour pickers (Label colour, Price colour), one colour picker (Page background), one image upload (Product banner, max 1 MB, shown above the form), and the switch "Hide product name and description".
- Acceptance criteria:
  - [ ] Controls exist and save into `design`.
  - [ ] `PublicCheckout` and the embed widget apply label colour, price colour, page background and banner.
  - [ ] Banner upload uses the existing image upload (`/api/upload`, R2). Allowed types: jpeg, png, webp. Max 1 MB after resize.
  - [ ] Empty values use the defaults.
- Data: `design.input.labelColor`, `design.input.priceColor`, `design.page.background`, `design.page.productBanner` (already in the type).
- API: existing.
- Permissions: owner, admin, marketer.
- Edge cases and errors: banner URL must be on our storage host. The page does not load other hosts.
- Tests: component test that each option changes the rendered style.

### F-419: Live preview (mobile and desktop) and preview modal
- Priority: P2. Milestone: M3.
- Description: The editor shows the form as the buyer sees it. A preview modal opens from the list.
- Current app: `CheckoutFormPreviewPane.tsx`; iframe of `/checkout-forms/:id/preview`; draft sent by `postMessage`. Route `CheckoutFormPreview` is guarded by login only (any role). `GET /api/checkout-forms/:id/preview-config` allows owner, admin, manager.
- Mockup: right pane with Mobile and Desktop toggle; list preview modal in a mobile frame.
- Acceptance criteria:
  - [ ] Right pane updates on every edit (draft by `postMessage`, validated origin).
  - [ ] Toggle Mobile (390 px) and Desktop (1024 px).
  - [ ] The preview uses the store currency, not a fixed default.
  - [ ] The preview never creates orders or fires pixels. Place order shows "Preview only."
  - [ ] The route is limited to owner, admin and manager (today any logged-in role can open it).
  - [ ] The list Preview button opens the same view in a modal.
- Data: none. API: existing.
- Permissions: owner, admin, manager.
- Edge cases and errors: a draft message from another origin is ignored.
- Tests: component test; e2e that the preview updates after a field edit.

### F-420: Public checkout page
- Priority: P0. Milestone: M3.
- Description: The buyer-facing page at `/form/:slug`. It must stay fast and clear on a phone. It keeps every current feature.
- Current app: `PublicCheckout.tsx`, `components/public/*`; `GET /api/public/forms/:slug`; `POST /api/public/forms/:slug/orders`.
- Mockup: preview modal in a mobile frame (title, packages, fields, add-on, summary, payment buttons, Place order).
- Acceptance criteria:
  - [ ] Sections: product header (hideable), package selector ("Most popular" badge, discount, original price, highlight text), add-ons, "Your information" (dynamic fields), order summary (hideable), one button per enabled payment method, refund note for online payment, terms note. Offer position top or bottom.
  - [ ] `?package=<id>` locks the form to one package (current feature).
  - [ ] Money uses the form currency and the correct symbol.
  - [ ] COD "Place order" posts the order. Duplicate guard: the same phone, package and total within 30 minutes returns the existing order (server rule, as today).
  - [ ] A customer who is COD blocked (file 03, F-357) sees the normal success page. The order is created with `requiresManualCall = true`. The page shows nothing about the block.
  - [ ] Region select uses the form's regions (F-413). The town field is free text.
  - [ ] The server rejects an order for a product that is not active or has no stock available (message "This product is sold out").
  - [ ] Online payment: the button posts the order data, then redirects to the provider page. Deferred creation (F-405).
  - [ ] The page works in the Facebook in-app browser. No `target="_blank"` links (they lose the tab in the Facebook in-app browser). Terms and refund text open in the same page section.
  - [ ] The page loads the form in under 2 seconds on a 4G phone (GUESS target; confirm with a Lighthouse run).
  - [ ] Pixel and CAPI behaviour: F-407.
- Data: none new. API: existing public routes.
- Permissions: public.
- Edge cases and errors:
  - Form inactive or archived → "Form not found" screen (F-421).
  - Cooldown: reload within 10 minutes of an order shows the success screen.
  - Slow network: the button disables after the first click and shows "Placing your order." A second tap does nothing.
  - Cross-origin embed from a host not in the allowed list → the page shows "This form cannot be shown here."
- Tests: component tests per section; integration tests for the dedupe rule, sold-out rule and blocked-customer order; e2e on a 390 px viewport.

### F-421: Order success and "Form not found" screens
- Priority: P2. Milestone: M3.
- Description: Two small screens styled with the form design.
- Current app: `OrderSuccess.tsx` ("Order Placed Successfully!", "What's Next?", support line); a "Form Not Found" screen with "Go Home".
- Mockup: none (matrix CF-15).
- Acceptance criteria:
  - [ ] Success: heading "Order placed", the order number (`#24118`), a short "What happens next" list (we call you to confirm; we deliver; you pay on delivery), the support WhatsApp link, and the form's primary colour.
  - [ ] If the order is COD and the store has auto-confirm on, add "We sent you a message on WhatsApp. Reply to confirm." (file 05, F-466).
  - [ ] Not found: "This form is not available." and the support contact. No "Go Home" button that points to the admin app.
  - [ ] Both screens work inside an iframe.
- Data: none. API: none.
- Permissions: public.
- Edge cases and errors: if the store has no support WhatsApp set, the line is hidden.
- Tests: component tests.

### F-422: Form type: physical or digital
- Priority: P1. Milestone: M3.
- Description: A form is physical or digital. The type changes fields, payment and what happens after payment. The mockup editor has no control for it, but the guide form needs it.
- Current app: `CheckoutForm.formType` (default `physical`). The server treats a form as digital when the product is digital.
- Mockup: not in mockup. Add to the Basics tab: "Form type" with two options, "Physical product (delivered)" and "Digital product (download link)". Show it as read-only after the form has orders.
- Acceptance criteria:
  - [ ] The type is set when the form is created and follows the product type. A mismatch (digital type with a physical product) is blocked.
  - [ ] Digital: no address or region fields, email required, online payment in full only, no COD, no deposit, no delivery agent or rep assignment, order ends `digital_delivered` (F-405).
  - [ ] Physical: COD (and online methods when the flag is on).
  - [ ] The list shows a small tag "Digital" on digital forms.
  - [ ] Digital link settings (expiry hours default 72, max downloads default 5) stay on the product (area B2, F-600 range).
- Data: none new.
- API: `PUT /api/checkout-forms/:id` validates type against the product.
- Permissions: owner, admin.
- Edge cases and errors: changing the product from digital to physical on a form with orders is blocked.
- Tests: unit test of the type rules.

### F-423: Shipping charge on checkout
- Priority: P3. Milestone: M5.
- Description: Matrix section 3 #42 says `Tenant.defaultDeliveryFee` is never read and public checkout fixes shipping at 0, and proposes to replace it with `FeeRule`. These are two different things. The shipping charge the buyer pays is not the fee the delivery partner keeps (the delivery fee, set by the partner's fee rule, from NUMBERS.md: GH₵25, 30, 35 per delivery, and 0 to 5 on failed orders). The Magic Groove price (GH₵249) includes delivery. So the buyer's shipping charge stays 0.
- Current app: `publicOrderController.ts` line 339 `shippingCost = 0`. `Tenant.defaultDeliveryFee` has no reader.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] `Order.shippingCost` stays 0 for checkout orders. No shipping field is added to the form.
  - [ ] `Tenant.defaultDeliveryFee` is removed from the schema (no reader). The delivery fee is read from `FeeRule` (Deliveries area, B2, F-700 range) and booked per order by Finance.
  - [ ] The order JSON still has `shippingCost` (0) so manual orders can carry a charge if the owner types one.
- Data: drop `Tenant.defaultDeliveryFee` after a check that it is empty or unused.
- API: none.
- Permissions: not applicable.
- Edge cases and errors: if the owner later wants a paid shipping line for some regions, that is a new requirement.
- Tests: grep test that no code reads `defaultDeliveryFee`; schema migration test.

---

## 5. Cross-area dependencies

| Needed | Area / range | Used by |
|---|---|---|
| Order state machine, `digital_delivered`, `confirmed` → `digital_delivered` for digital orders | Orders, this team, file 03, F-301 | F-405 |
| Customer stats and COD block (`requiresManualCall`) | Customers, file 03, F-357 | F-420 |
| Phone format helper | file 03, F-362 | F-412 |
| Stock available check and dispatch rule | Stock, B2, F-650 range; file 03, F-305 | F-405, F-420 |
| Tenant scope list for `PendingCheckout`, `WebhookEvent`, `FormSubmission` | file 03, F-363 | F-404 |
| Ledger posting, provider payout, finance summary with 4020 and 5060 | Finance, C, F-900 range | F-406 |
| Connections screen: payment connection card, test mode warning, Checkout website summary | Connections, C, F-1200 range | F-400, F-401, F-402, F-416 |
| Settings → Operations: `features.prepaidPhysical` flag | Settings, C, F-1200 range | F-402 |
| Marketing funnel "Checkouts started" and "Visit to order" | Marketing, C, F-1000 range | F-407, F-409 |
| Workflow triggers `order_created`, `payment_received` | Workflows, file 05, F-506, F-507 | F-405, F-406 |
| Inbox alerts for payment problems | Inbox, file 05, F-557 | F-404, F-406 |
| Auto-confirm message line on success screen | Messages, file 05, F-466 | F-421 |
| Product catalogue, digital product fields, product type | Products, B2, F-600 range | F-411, F-422 |
| Store country and currency, support WhatsApp (Business details) | Settings, C, F-1200 range | F-411, F-421 |
| Role presets and tool allow-list (Marketing role may edit tracking and design) | Staff, C, F-1150 range | F-416, F-417 |
| Fee rules per partner | Deliveries, B2, F-700 range | F-423 |

## 6. Coverage table

### 6.1 Section 1.5 Checkout forms (19 rows)

| Row | Feature | Covered by |
|---|---|---|
| CF-01 | Form list | F-408 |
| CF-02 | Orders, visits, conversion per form | F-409 |
| CF-03 | Copy link and embed code | F-410 |
| CF-04 | Basics | F-411 |
| CF-05 | Fields builder | F-412 |
| CF-06 | Regions list per form | F-413 |
| CF-07 | Packages | F-414 |
| CF-08 | Upsells | F-415 |
| CF-09 | Payment methods | F-402 |
| CF-10 | Tracking and pixels | F-416 |
| CF-11 | Design | F-417 |
| CF-12 | Design options not in mockup | F-418 |
| CF-13 | Live preview | F-419 |
| CF-14 | Public checkout page | F-420 |
| CF-15 | Order success and "Form not found" | F-421 |
| CF-16 | Pixel, CAPI dedupe, cooldown, iframe height | F-407 |
| CF-17 | Payment callback page | F-403 |
| CF-18 | Form agent cards | F-409 |
| CF-19 | Form type | F-422 |

### 6.2 Section 3 broken items covered here (3 rows)

| Row | Item | Covered by |
|---|---|---|
| 3-#24 | Checkout editor help text links to `/settings/integrations` | F-416 |
| 3-#38 | Legacy Paystack webhook past sunset | F-404 |
| 3-#42 | `Tenant.defaultDeliveryFee` never read; shipping fixed at 0 | F-423 |

### 6.3 Section 4 mockup fixes covered here (3 rows)

| Row | Issue | Covered by |
|---|---|---|
| 4-#7 | Tracking set in two places | F-416 |
| 4-#8 | Time zone, country, currency repeated (form default country) | F-411 |
| 4-#24 | Region lists use 6 or 7 regions | F-413 (used by file 03 F-317, F-319 and file 05 F-457, F-511) |

Payments work that has no matrix row but the owner decisions require (G1, D8): F-400, F-401, F-404, F-405, F-406. Matrix row CN-04 (Paystack in Connections) belongs to area C; this file provides the provider side.

### 6.4 Count check

| Section | Rows in matrix for this file | Rows in this table |
|---|---|---|
| 1.5 Checkout forms | 19 | 19 |
| Section 3 broken | 3 | 3 |
| Section 4 fixes | 3 | 3 |
| Total | 25 | 25 |

F-IDs written in this file: F-400 to F-423 (24).
