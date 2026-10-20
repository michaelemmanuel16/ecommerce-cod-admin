# Sniper - API and network notes

Target: https://sniper.ng (demo session via /sniperdemo). Research date 2026-10-17. Read-only: no forms were saved, nothing was sent.

Evidence IDs (REA, this session):
- `ev_a15d42461e8dd0ae638c9c0d7bfe38f4ad52bbf695e8868a7ac1b17db76a32b7` - REA `capture_browser_scenario` #1: headless Chrome, /sniperdemo then /?p=orders. 338 requests, request bodies captured, 13 console lines.
- `ev_addadcd9f408cef94d9654664584a08116972f5354c89461a6aa31c468379a61` - REA `capture_browser_scenario` #2: demo entry then forms, customers, agents-remittance, products, inventory-with-agents, reports-sales, orders. Request AND response bodies (bodies over 64 KiB are not retained by REA, so very large RPC responses such as orders_page_rows are `unavailable`).
- `ev_439ef6c82cc0371b9904c11b29c3052795e4fb4f593baa52631f12d3c5623f4d` (parent `ev_1bf785651f9d2a647a7166fa5c30d359755c9b27313e837e563fd69204a09be0`) - REA `analyze_javascript_application` summary over the 225 downloaded bundle chunks. Coverage partial (result-budget limits).
- `ev_4d565304337cfa897b76535fbe27206c76fe25e91037113fb9849fed9a64a3af` - REA `trace_application_feature` route seed: no match (REA does not model React Router config, so routes came from text extraction, see findings.md Method).

Machine-readable shapes: `api-shapes.json` (request shape, response shape, one sample row per endpoint; tokens redacted).

## 1. Architecture of the API (SEEN)

There is no custom REST API for the dashboard. The browser talks directly to a hosted **Supabase** project (`qykxfmyoojmprmxcvjzz.supabase.co`):

| Layer | What the client calls | Evidence |
|---|---|---|
| PostgREST tables | `GET/POST/PATCH/DELETE /rest/v1/<table>?select=...&owner_id=eq.<uuid>` | ev_addadcd9... (43 distinct calls) |
| Postgres RPC (SQL functions) | `POST /rest/v1/rpc/<fn>` with JSON args named `_xxx` / `p_xxx` | same |
| Auth | `GET /auth/v1/user`, `supabase.auth.setSession`, `signOut` | same + DemoEntry chunk |
| Edge Functions (Deno, assumed) | `POST /functions/v1/<name>` | DemoEntry chunk, bundle grep |
| Realtime / storage | not captured in this run | unknown |

Multi-tenancy: every row carries `owner_id` (the store owner's auth user UUID). Tenant isolation is claimed to be Postgres row-level security (user guide "Row-level security on every table"; GUESS that it is correctly configured, not tested). Staff users resolve to their owner via RPC `effective_owner` / `current_app_user`.

The anon API key is shipped in the public marketing script (`/home/assets/cms.js`, used to read `landing_content` for the public home page). Its value is not reproduced here. Using it to read other tables was NOT attempted.

Observed oddities (SEEN in capture, not exploited):
- The client itself issues `DELETE /rest/v1/forms?owner_id=eq.<uuid>&deleted_at=not.is.null&deleted_at=lt.<now-30d>` on page load: soft-deleted forms older than 30 days are purged from the browser. (ev_addadcd9..., 204)
- `POST /rest/v1/rpc/tenant_name_map` (args `_ids`, `_owner_ids`, both null) returned a row `{id, name}` with a person's name. GUESS: it is a lookup of store names/owner names for admin or impersonation UI, and the row may belong to a tenant other than the demo store; this was not probed further and no claim about exposure is made.
- `round_robin_sweep` (order auto-assignment) is invoked from the client on page load, so assignment is client-triggered as well as DB-driven. (SEEN: POST /rpc/round_robin_sweep, body `{_owner_id:null}`, result `0`).
- Audit log writes come from the client: `POST /rest/v1/audit_log {action:"Log in", entity:"session", actor, details:{actorEmail,page,device}, owner_id}`. (SEEN, 201.)
- API keys for the customer-facing order API are created client-side: the browser generates `sk_live_<random>`, SHA-256 hashes it with `crypto.subtle`, and inserts `{owner_id,label,key_prefix,key_hash,form_id}` into `api_keys` (SEEN in WebhooksPage chunk).

## 2. Demo entry flow (SEEN)

1. `GET /sniperdemo` serves the SPA. Chunk `DemoEntry` calls `supabase.functions.invoke("demo-store", {body:{action:"enter", referrer}})`.
2. Response `{access_token, refresh_token, last_reset_at}` -> `supabase.auth.setSession(...)`. No password is involved; the demo is a public one-click session.
3. The demo owner is `Demo Owner`, store `Demo Store`, plan `big-boss` yearly expiring 2099. RPC `is_demo_owner` -> true shows a footer bar: "explore and edit freely. Deleting is turned off, and the sample data resets every 4 hours" with a "Reset now" button (`demo-store {action:"reset"}`).

## 3. Session / bootstrap calls on every load (SEEN, ev_addadcd9...)

| Call | Args | Response (shape) |
|---|---|---|
| `GET /auth/v1/user` | - | Supabase user |
| `rpc/bootstrap_session` | `{}` | `{prefs:{theme,fontScale,chatSoundMuted,whatsappButtonHidden,installBanner*}, user_id, app_user:{name,email,agent_id,is_owner,owner_id,role_name,app_user_id,auth_user_id,sees_all_orders}, pinned_items:[]}` |
| `rpc/current_app_user` | `{}` | `{app_user_id,auth_user_id,name,email,owner_id,agent_id,role_name,is_owner,sees_all_orders}` |
| `rpc/effective_owner` | `{_uid}` | owner uuid |
| `rpc/has_role` | `{_user_id,_role}` | bool |
| `rpc/my_session_revoked` | `{_issued_at}` | bool (force-logout support) |
| `rpc/current_impersonation` | `{}` | null or impersonation record (admin support mode) |
| `rpc/onboarding_status` | `{}` | `{owner_id,resolved,completed,has_forms,hq_complete,has_products}` |
| `rpc/migration_bonus_status` | `{}` | `{claimed,eligible,expires_at,has_subscription}` |
| `rpc/chat_unread_total` | `{}` | int |
| `GET profiles?select=display_name,store_name,email` | | row |
| `GET app_settings?select=data` | | one JSON doc (see 4.1) |
| `GET subscriptions` | | `{plan,billing_cycle,status,started_at,expires_at}` |
| `GET platform_settings?key=eq.default_roles_template` | | role template (null for demo) |
| `GET service_status` | | `{service,status,message}` (e.g. email: running) |
| `GET in_app_notifications` | | `{id,kind,title,detail,url,read_at,created_at}` |
| `GET sniper_sms_credits?select=balance` | | row |
| `GET countries` | | `{code,name,currency,symbol,dial_code}` (all countries) |
| `GET branches?select=*` | | see 4.7 |

## 4. Entities and fields

Legend: SEEN-LIVE = field list from a captured response; SEEN-CODE = column list from `.select()/.insert()` strings in the bundle (not a full schema; columns not touched by the UI are unknown).

### 4.1 `app_settings` (JSON document per owner) SEEN-LIVE
`{ email, orderTabs[], storeName, onboarding{completed,productDoneAt}, phoneNumber, storeAddress, storeCountry, whatsappNumber, enableRoundRobin, sendInvoiceEmail, sendInvoiceWhatsapp, scheduledOrdersEmail, loginNotificationEmail, scheduledOrdersWhatsapp }`
`orderTabs` is the ordered list of tab names, including custom tabs ("Not Picking Calls", "Switched Off" in the demo).

### 4.2 `orders` SEEN-LIVE (`GET /rest/v1/orders`, ev_addadcd9...)
Table columns: `row_id` (`<owner_uuid>:<order_id>`), `order_id` (10-digit string), `branch_id`, `data` (JSONB), `created_at`, `updated_at`.
`data` fields seen live: `id, qty, date, hold, tags[], email, phone, rowId, state, amount, formId, status, addedBy, address, product, branchId, customer, formName, whatsapp, freeGifts[], orderType, productId, assignedAt, assignedTo, countryCode, processedBy, otherDetails{}, pricePointId, statusHistory[{at,to,from,byName}], currencySymbol, firstAssignedAt, firstAssignedTo, statusEnteredAt, assignmentSource, firstAssignmentSource`.
Extra fields from the normaliser (SEEN-CODE, orders-data chunk): `paymentStatus` (Paid | Unpaid | Partial | Refunded), `deliveryAgent`, `previousStatus`, `parentOrderId` (bumps/upsells point at main order), `orderType` (main | bump | upsell), `holdBy`, `updatedBy`, `deliveredAt`, `scheduledFor`, `followUpAt`, `ipAddress`, `deliveryFee`, `discount`, `hiddenDetails{}`, `variationSelections{}`, `comboProducts[]`, `commentEntries[{id,text,at,byId,byName}]`, `callRecordings[{id,path,name,sizeBytes,mimeType,status,note,at,byId,byName}]`, `editHistory[{at,byId,byName,summary}]`, `statusHistory[{at,byId,byName,from,to}]`, `comment`.
Order IDs are random 10-digit numbers (SEEN: 7577752268 etc.).

Order list RPCs (SEEN names + request shape, bodies decoded from ev_a15d4246...):
- `orders_page_rows` args `{_status,_search,_date_field,_from,_to,_products,_states,_agents,_forms,_order_types,_tags,_country,_payment,_customer,_user_id,_user_roles,_mk_forms,_mk_products,_mk_keys,_limit:50,_offset,_branch_id}`
- `orders_page_count` (same filters, no limit/offset)
- `orders_status_counts`, `orders_status_counts_filtered`, `orders_badge_status_counts`, `orders_badge_page_rows`
- `orders_row_badges` args `{_row_ids:[...]}` returns the Risk / Duplicate / Repeat badges
- `orders_page_metric_details` args `{_country,_branch_id,_ranges:[{key:"This Week",lo,hi},...]}` powers the This week / Last week / This month / Last month KPI cards
- `orders_keyset_page` args `{_cursor_created_at,_cursor_row_id,_limit,_branch_id}`
- `orders_apply_patch`, `orders_apply_status_patch`, `orders_bulk_assign`, `orders_customer_history`, `orders_last_customer_order_at`, `orders_delivery_agent_names`, `orders_list_page`, `orders_page_stats`, `reset_store_orders` (names only, SEEN-CODE)
- Incremental sync: `GET /rest/v1/orders?select=row_id,order_id,branch_id,data,updated_at,created_at&owner_id=eq.<uuid>&updated_at=gt.<ts>` (SEEN, ev_addadcd9...).

### 4.3 `products` SEEN-LIVE (table with `data` JSONB)
`{ id, sku, name, type:"physical", archived, hasOffer, costPrice, createdAt, categoryId, variations:[{id,type,options:[{id,value}]}], countryCode, pricePoints:[{id,price,units,offers[],freeGifts[],offerName,unitSymbol,comboProducts[]}], stockHistory[], countryPrices[], priceVariations[], lowStockAlertQty, lowStockAlertEmails, lowStockAlertQtyAgents }`
`product_categories.data = {id,name}`.

### 4.4 `forms` SEEN-LIVE (`data` JSONB, `deleted_at`, `created_at`)
`{ id, hits, name, bumps[], fields:[{id,type,label,required,mandatory,showLabel,placeholder}], styling:{bgColor,buttonBg,fontSize,textColor,buttonText,fontFamily,buttonRadius}, upsells[], archived, branchId, headline, packages[], createdAt, ... }`
Field types seen: name, phone, whatsapp, address, state, package. Add-field menu (SEEN): Email, Country, Short Text, Long Text, Dropdown, Radio Group, Checkbox Group, Hidden Field, Static Text Block, Delivery Availability, Button.
Form hit counter: `form_hit_counts{form_id,hits}`, RPC `form_register_hit`.
Public submit: RPC `submit_public_order` (SEEN-CODE). Public form route `/f/:id`.

### 4.5 `agents` (delivery partners = logistics companies, not individual riders) SEEN-LIVE/CODE
Columns: `id, name, phone, country_code, status (active|suspended|inactive), states_covered[], branch_id, pick_stock_from_office`. In demo: 5 agents named like "Swift Dispatch (Lagos Mainland)". Shared directory: RPCs `agents_directory_list`, `agents_directory_filters`, `agents_directory_use` (10,708 public agents, phones masked unless plan allows).

### 4.6 `agent_remittances` + `agent_remittance_orders` + `bank_statement_entries` SEEN-CODE
`agent_remittances{id, agent_id, amount, delivery_fee, bank_account_id, bank_account_label, proof_url, note, created_at}`; join table `agent_remittance_orders{remittance_id, order_row_id}`; `bank_statement_entries{status, matched_remittance_id,...}` ("Confirm Bank Match"). RPC `refresh_agent_float_lock`.

### 4.7 `branches` SEEN-LIVE
`{id, owner_id, name, country_code, state, city, address, phone, whatsapp_number, email, currency, manager_user_id, status, is_default, restrict_orders_to_state, created_at, updated_at}`. Also `app_user_branches`.

### 4.8 Stock tables SEEN-CODE
- `incoming_stock{id, owner_id, added_by, branch_id, from_branch_id, pending, movement_date, batch_no, supplier_id, product_id, product_name, quantity, unit_cost, unit_weight_g, weight_unit, variation_qty, variation_costs}`
- `outgoing_stock{id, owner_id, added_by, branch_id, movement_date, country_code, from_agent_id, from_state, to_agent_id, to_state, to_branch_id, transfer_incoming_id, product_id, product_name, quantity, status (e.g. RECEIVED), label, entered_weight_g, weight_unit, variation_qty}`
- `returned_stock{agent_id, product_id, quantity, reason, status, branch_id, source, variation_label, movement_date}`
- `stock_audits{product_id, branch_id, variance, status, performed_at, acknowledged_by(_name), acknowledged_at, resolved_by(_name), resolved_at, resolution_notes}`
- RPCs `record_office_stock_correction`, `record_agent_stock_correction`, `variation_stock_rows_for`.

### 4.9 Procurement SEEN-CODE
`suppliers{id,name,...}`, `purchase_orders{po_number, supplier_id, branch_id, status, order_date, expected_date, currency, line_items[], subtotal, freight_cost, customs_duties, other_fees, total, notes, fulfilled_at, added_by}` (RPC `next_po_number`), `supplier_payments{supplier_id, amount, currency, method, reference, paid_at, notes, status}`.

### 4.10 Finance SEEN-LIVE/CODE
- `bank_accounts{id, owner_id, bank_name, account_name, account_number, currency, balance, notes}` (SEEN-LIVE: 6 auto-created "Pseudo ... Bank" placeholders)
- `structural_accounts{id, owner_id, slot (income|profit|tax|payroll|opex|cogs|emergency), position, bank_account_id, percentage}` and `structural_account_settings{owner_id, distribution_day:"friday", distribution_time:"17:00"}` (SEEN-LIVE)
- `expenses{id, expense_date, expense_type_id, country_code, amount, currency, description, product_id, platform_id, source}`, `expense_types{id,name}`
- `disbursement_reports{status, period_end,...}`, `wallets{balance,currency,auto_renew}`, `wallet_transactions{amount,type,created_at}`, `subscriptions`, `coupons`, `subscription_coupons`.

### 4.11 People / payroll SEEN-CODE
`app_users` columns (commission engine): `id, name, role, status, country, email, phone, whatsapp_number, fixed_salary, bonus, bonus_tied_to_target, main_target, bump_target, upsell_target, main_commission, bump_commission, upsell_commission, activate_after_target, supervisor_earning_type/rate, social_earning_type/rate, social_count_basis, social_monthly_target, social_tie_to_target, marketer_earning_type/rate, support_earning_type/rate, store_delivered_earning_type/rate, bank_name, account_number, access_all_branches`.
`user_assignments{user_id, products[], agents[], follow_up, users[], states[], forms[]}` (what each user may see). `app_user_branches`. Payroll: `payroll_runs{period_month,status,currency,branch_ids,group_label,totals{gross,net,deductions,allowances,headcount},cycle_start_day,cycle_range,processed_at}`, `payslips{staff_id,period_month,net_payout,payroll_run_id,deductions,emailed_at}`, `deductions{name,kind,default_amount,calc_base,is_default}`, `allowances`, `staff_deductions/allowances/adjustments`, `staff_loans{balance,status}`, `loan_repayments`, `staff_payouts`, `payroll_compliance_items`. Performance: `rep_daily_performance{avg_response_ms,...}`, `ai_call_audits{result}`, `user_ui_prefs`.

### 4.12 Fraud / risk SEEN-CODE
`customer_blacklist{id, phone, name, reason, created_at, created_by}`, `ip_blacklist` (SEEN in capture), `order_fraud_flags{id, order_row_id, status,...}`, form-level settings in app settings.

### 4.13 Messaging SEEN-CODE
`message_templates{data}`, `whatsapp{id, phone_number, display_name, licensetype, service_start, service_end, status}`, `whatsapp_provider_instances`, `whatsapp_chatbot_rules{name, bot_type, whatsapp_id, keywords, match_type, similarity_threshold, replies, response, message, delay_seconds, media_url, enabled, priority}`, `whatsapp_ai_chatbot_configs`, `sms_provider_instances`, `payment_gateway_instances`, `ecommerce_platform_instances`, `drip_messages`, `drip_sends`, `email_campaigns`, `email_campaign_recipients/clicks`, `email_tracking(_clicks)`, `email_send_log`, `suppressed_emails`, `system_email_templates`, `system_whatsapp_templates`, `mobile_notifications`, `in_app_notifications`, `chat_messages` (+ RPCs `chat_*`).

### 4.14 Integrations / API SEEN-CODE
`api_keys{label, key_prefix, key_hash, form_id, last_used_at, revoked_at}`, `outgoing_webhooks{id, name, url, events[], secret, active}`, `webhook_deliveries{webhook_id, event, status, response_status, response_body, attempts, created_at}`, `form_inbound_tokens{form_id, token}`, `form_conversion_settings`, `conversion_event_log`, `google_contacts_connections`, `google_sheet_import_state`, `tiktok_lead_form_links`, `ad_platforms`, `storefronts{slug,...}`, `storefront_bundles{base_product_id, bundle_product_ids, discount_type, discount_value, active}`.

### 4.15 Support / platform SEEN-CODE
`support_tickets{status, assigned_to_user_id, escalated, escalated_at, resolved_at, csat_rating, csat_comment}` + canned responses; `refund_requests{refund_no, order_row_id, order_label, customer_*, claim_amount, reason_category, reason_notes, proof_path, proof_kind, status, decided_by(_name), decided_at}`; `refund_postings`; `disputes{dispute_no, order_row_id, agent_name, category, summary, disputed_amount, chat_transcript, scale_stream, status, commission_locked, evidence_paths}`; `feature_requests` (+votes, comments); `coaching_sessions`; `system_issues`; `audit_log{action, entity, entity_id, actor, details, owner_id, created_at}`; `legacy_migration_jobs/mappings`; `referral_commissions`; `referral_link_clicks`; `demo_visits`; `platform_secrets`; `platform_expenses`; `landing_content`; `crypto_addresses`; `addon_services`.

## 5. Edge functions invoked by the client (SEEN-CODE, bundle grep)
`demo-store`, `send-transactional-email`, `sniper-email-send`, `send-sms`, `send-order-auto-messages`, `send-agent-whatsapp-assignment`, `whatsapp-control`, `whatsapp-provision`, `whatsapp-qr`, `wallet-purchase`, `wallet-initiate-funding`, `wallet-verify-funding`, `wallet-stripe-checkout`, `wallet-dva` (Paystack dedicated virtual account), `stripe-create-checkout`, `confirm-order-payment`, `storefront-checkout`, `storefront-cart-sync`, `push-form-to-google-sheet`, `google-sheet-order-import`, `google-contacts-sync`, `google-contacts-oauth`, `tiktok-leads-sync`, `tiktok-oauth`, `sync-ad-spend`, `send-conversion-event`, `woocommerce-order-sync`, `shopify-order-webhook`, `inbound-form-webhook`, `webhook-dispatch`, `create-app-user`, `delete-app-user`, `self-delete-account`, `register-device-token`, `notify-staff`, `notify-feature-shipped`, `drip-dispatch`, `admin-send-campaign`, `admin-update-secret`, `admin-impersonate`, `admin-delete-store`, `legacy-mysql-migrate`.

## 6. Customer-facing / integration endpoints (documented in-app, SEEN-CODE `WebhooksPage`, `FormsIntegrationPage`)
- Per-form inbound webhook: `POST https://<supabase>/functions/v1/inbound-form-webhook` (token per form). Auto-maps fields by alias: name (full_name, fullname, customer_name), phone (phone_number, mobile, tel), whatsapp (whatsapp_number, wa), email, address (delivery_address, street), state (region, province), country, package (product, variant, option), amount (price, total), notes (message, comment, comments).
- Order API with `sk_live_...` key: create order (required: phone + name/product/amount; returns `{ok:true, order_id, status}`; duplicate refused with `{ok:false,duplicate:true,reason:"duplicate_order_blocked"}`) and "mark delivered" (`{order_id, delivered_at, delivery_agent, note}`).
- Outgoing signed webhooks, events: `order.created`, `order.cart_abandoned`, `order.delivered`, `order.status_changed`; payload `{event, sent_at, data:{order_id,status,previous_status,customer_name,phone,product,quantity,amount,state,country_code,agent,created_at}}`; delivery log with attempts and "Resend".
- Shopify: `.../functions/v1/shopify-order-webhook?i=<instance>`.
- Meta CAPI / TikTok / pixels: `send-conversion-event`; Lead on form submit, Purchase on Delivered (Auto mode); browser and server share one Event ID for dedup (user guide).

## 7. Public marketing CMS (SEEN)
`GET /rest/v1/landing_content?id=eq.home&select=content` returns the whole landing page copy as flat keys (`hero.title`, `pricing.plans.0.price`, ...). Saved as `raw/landing-cms-home.json`. This is where the live pricing differs from the static HTML fallback.

## 8. Not captured
Response bodies > 64 KiB (orders_page_rows, customer_tiers pages), realtime websocket traffic, storage bucket URLs, any authenticated call as a non-owner role (no staff or delivery-agent login exists in the public demo), and every write path (by design).
