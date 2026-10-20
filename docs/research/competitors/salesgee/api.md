# SalesGee API and data notes

Read this first: the public demo (demo.salesgee.com) makes NO real API calls. It replaces `window.fetch` with an in-browser mock (`SGCRM_DEMO_MODE = true`, `app.1.0.410.pretty.js` lines ~2434-2890). So there are no live JSON responses to capture. Everything below is read from the shipped bundle: the mock handler shows exactly what response shape the client code expects. Treat request/response shapes as SEEN (in code). Treat "the real server returns the same" as GUESS (very likely, because the same client code consumes both).

Evidence:
- ev_de1dca81f3adea67b4cfbc20b42f6d80f0cd403939cdfcb47d4059a69b5cb43c — REA capture_browser_scenario of the demo load (network events, no bodies). Only static GETs: the HTML, `app.1.0.410.min.js`, `app.css`, icons, Google Fonts, unpkg React 18.3.1 and ReactDOM. No XHR/fetch to any API. (SEEN)
- ev_b043a91d37a2da267d32be99c9a085fa9725e4869875ebbe1621097bc6d8672c — REA analyze_web_bundle on the demo. 4 scripts, `routes: []`, `endpoints: []`. The "endpoint candidates" are `URLSearchParams.get(...)` false positives. Reason: the app has no URL router. (SEEN)
- ev_67e706cd5e2917d290bad0026ae36658be0f941f5ad9c4e33c8bd07d03e5842c — REA export_web_scripts. ev_d88643ba46a96a208c6628b3408ce93668138eb4f9d615004b98c70a9af488b0 (parent ev_656c543818b2cbe9d7e608a2782ec78e5223d0df54cb857c757cb5031be3c0b0) — REA analyze_javascript_application: 296,800 AST nodes, 0 literal `fetch` request relations (the call is wrapped in helpers; found by grep instead).

## Transport (SEEN)

- One endpoint: `POST /wp-admin/admin-ajax.php` (WordPress admin-ajax). `window.SGCRM.ajax_url`.
- Body is `FormData` with `action=sgcrm_<name>` plus params. Also sends a WP `nonce` (`window.SGCRM.nonce`, refreshed by `sgcrm_refresh_nonce`) and `admin_token` (`window.SGCRM_ADMIN_TOKEN`, from `sgcrm_admin_login`).
- Multi-business: `window.SGCRM_ACTIVE_BUSINESS` (default `"default"`) is sent as the active business id.
- Envelope: `{ "success": true, "data": {...} }` or `{ "success": false, "data": { "message": "..." } }` (WordPress `wp_send_json_success/error` shape).
- Real-time: no WebSocket. Polling: `sgcrm_app_poll` returns `{presence:{<userId>:ts}, orders:[], updated:[], latest_updated}`; `sgcrm_heartbeat` marks staff online (the staff list shows an "Offline/Online" badge). (SEEN in code; GUESS on interval)
- PWA: `?sgcrm_pwa_manifest=1`, `?sgcrm_pwa_sw=1`. Public order embed: `/?sgcrm_embed=<formId>`. WooCommerce webhook fallback: `/?sgcrm_woo_in=<businessId>`.

## Key design fact: whole-collection blob storage (SEEN)

The client holds whole collections in React state and autosaves them with `sgcrm_save {key, data:<JSON array>}`, debounced 800 ms (`we()` hook, ~line 85200). Load is `sgcrm_load {key}` returning `{data: "<json string>"}`. Collections (keys): `orders, products, agents, staff, stockP, waybills, income, expenses, storeName, forms, faultLog, customRoles, roleTargets, campaigns, payouts, adminCreds, storeSettings, customerProfiles, followUps, productivity{todos,tasks,goals}`. Orders also have row-level actions (`sgcrm_save_order`, `sgcrm_trash_order`, ...) and server paging (`sgcrm_fetch_orders`, page/limit up to 200). Other collections use `sgcrm_save_row` / `sgcrm_delete_row {key,row|id}`. This is a document-blob design on top of WordPress, not a normalized relational schema. (GUESS: stored in wp_options or a custom table as JSON; the server is PHP.)

## Actions (all SEEN as string literals in the bundle; params from client call sites)

| Group | Actions |
|---|---|
| Auth | `sgcrm_admin_login`, `sgcrm_staff_login`, `sgcrm_refresh_nonce`, `sgcrm_session` (storage key), `sgcrm_remember_login` |
| Generic store | `sgcrm_load{key}`, `sgcrm_save{key,data}`, `sgcrm_save_row{key,row}`, `sgcrm_delete_row{key,id}`, `sgcrm_operational_records{key}` -> `{rows,total,page,limit}`, `sgcrm_explicit_save`, `sgcrm_explicit_delete`, `sgcrm_allow_empty_overwrite` (guard against wiping data) |
| Orders | `sgcrm_fetch_orders{page,limit,status,product,...}` -> `{rows,total,page,limit,total_pages}`; `sgcrm_get_order{id}` -> `{order}`; `sgcrm_save_order{order}`; `sgcrm_trash_order{id}`; `sgcrm_restore_order{id}`; `sgcrm_delete_order{id}`; `sgcrm_list_trashed_orders`; `sgcrm_import_orders_csv`; `sgcrm_next_assignee` -> `{assignee}` (round-robin) |
| Stats | `sgcrm_orders_stats`, `sgcrm_daily_summary`, `sgcrm_agent_performance`, `sgcrm_campaign_stats`, `sgcrm_customer_summaries`, `sgcrm_finance_records{type,category,...}`, `sgcrm_earnings_summary`, `sgcrm_manifest_summary`, `sgcrm_manifest_outstanding` |
| Business (multi-store) | `sgcrm_list_businesses`, `sgcrm_create_business`, `sgcrm_update_business`, `sgcrm_delete_business`, `sgcrm_reset_business`, `sgcrm_active_business` |
| Restore points | `sgcrm_snapshot_save{label}`, `_list`, `_restore{snap_id}`, `_delete` (max 5) |
| Staff | `sgcrm_merge_staff_alias`, `sgcrm_staff_layout`, `sgcrm_forms_layout` |
| Wallet (Paystack) | `sgcrm_wallet_status`, `_fund_initiate`, `_fund_verify`, `_fund_account` (dedicated funding account), `_banks`, `_resolve_account{account_number,bank_code}`, `_bank_account`, `_pin`, `_pin_reset`, `_withdraw` (PIN, admin approval), `_pay_staff`, `_purchase_credits` |
| Billing | `sgcrm_billing_status`, `_initiate`, `_verify` (SalesGee license, Paystack) |
| Email marketing | `sgcrm_email_marketing_status`, `_email_campaign_save/_send/_test/_duplicate/_delete`, `_email_credits_initiate/_verify`, `sgcrm_send_test_email` |
| SMS | `sgcrm_sms_stats`, `_sms_sender_request/_status`, `_sms_bulk_preview/_save/_send{mode=now|schedule}`, `_sms_credits_initiate/_verify` |
| WooCommerce | `sgcrm_woo_test_config`, `_woo_self_test`, `_woo_pull_orders`, `_woo_pull_products`, `_woo_install_webhooks`, `_woo_log` |
| Admin connector | `sgcrm_admin_connector_test/_flush/_log/_backfill/_clear_failed/_retry_failed` (pushes data to SalesGee's own admin console; Scale+ plans) |
| Storefront | `sgcrm_save_storefront_products{products}`, `_save_storefront_settings{patch}`, `_storefront_upload_image{file}` |
| Misc | `sgcrm_send_support_ticket`, `sgcrm_heartbeat`, `sgcrm_app_poll` |

## Response shapes (SEEN in mock)

`sgcrm_orders_stats` / `sgcrm_daily_summary` (one stats object, filterable by date range, product):
```
{ total, count, delivered, delivered_in_range, revenue, revenue_delivered, revenue_delivered_in_range,
  by_status:{<status>:n},
  by_product:[{name,count,units,delivered,units_delivered,revenue,revenue_delivered}],
  by_state:[{name,count}],
  by_assigned:[{name,count,delivered,pending,in_transit,cancelled,revenue_delivered}],
  by_delivery_agent:[{name,attempts,delivered,revenue}],
  daily_trend:[{date,date_iso,count,delivered,revenue,revenue_delivered}],
  unique_customers, repeat_customers, top_customers:[{phone,name,orders,spent}],
  todayStats, yesterdayStats, last7Stats, allStats, recentOrders }   // dashboard uses the last six
```
`sgcrm_wallet_status`:
```
{ wallet:{balance,total_in,total_out,currency:"NGN",has_pin,status,bank_account:{bank_name,account_number,account_name,verified}},
  transactions:[{id,type:"credit|debit",amount,description,date,status}],
  summary:{balance,total_in,total_out} }
```
Wallet transaction filter chips in the UI: All / Deposit / Withdrawal / Incentive / Bonus / Adjustment.

`sgcrm_billing_status` (demo): `{plan,status,is_demo,message,limits}`. The real license object is embedded in the page as `window.SGCRM.license`: `{active,current_plan,current_plan_name,currency:"NGN",state:{ok,locked},plans:[{key,name,price,period,prices:{monthly,biannually,yearly},description,popular,limits:{max_staff,max_orders_per_month,max_products,max_sales_forms,max_agents,max_businesses},features:{...}}]}`.

`sgcrm_sms_stats`: `{messagesSent,workflows,activeWorkflows,credits,minimumCredits,minimumAmount,bulkCampaigns[]}`.
`sgcrm_sms_bulk_preview`: `{count,sample[10],credits,message}`. Duplicate phone numbers are removed.
`sgcrm_email_marketing_status`: `{state:{credits,rate,minimumAmount,contacts[],lists[],campaigns[],purchases[]},message}`.

## Data model (SEEN: demo seed `br()` plus client code)

Order: `id(int, 200000+n), businessId, orderNumber, customer, phone, email, state, address, product, productId, formId/form_id, source("Sales Form"|"Woo"|manual|"Elementor Form"), qty, items[{id,product,qty,price,amount,isGift}], amount, date, dateIso/order_date, time, status, assignedTo, marketer, deliveryAgent, createdAt, updated_at, deliveredDate(+Iso), delivSource (stock source on delivery), remitted, remittedDate, deliveryFee/deliveryCharge, netRemit/netRemitted, incomeRefId, expenseRefId, comments[], upsells[], repeated, trashed_at, assignedToEmail`. Flags: UPSELL, WOO, COMBO badges in the order row.

Product: `id,name,sku,type("simple"|"combo"),unit,costPrice,price,officeStock,status,description,offers[{name,price,qty,giftProduct,gifts[{product,qty}],items[] (combo)}],lowStock threshold` (low-stock alert fires at `officeStock <= 10` on the dashboard; the product form also mentions an alert quantity in the docs).
Agent: `id,name,phone,state,status,email`; per-agent stock is derived, not stored.
Staff: `id,name,email,phone,role,status,password,salary,permissions[],photo`.
Waybill: `id,from,to,product(s) lines,qty,fee,status(In Transit|Delivered|Cancelled),date`.
Stock purchase (`stockP`): `id,product,qty,unitCost,amount,supplier,date,status,addedBy`.
Income/Expense: `id,description,amount,category,date,ref`. Income categories: Sales, Other Income. Expense categories: Procurement, Salary, Logistics, Marketing, Utilities, Other.
Faulty log: `product, source (Office or an agent), qty, date, reason`.
Form: `id,name,title,status,active,product,productData,price,fields[{name,type,required}],submissions,marketer,offerPosition(top|bottom),showSuccess,successMsg,redirectUrl,hideProduct,paymentEnabled(Paystack),design{btnText,btnColor,btnRadius(square|rounded|pill),btnSize,formBg,inputStyle(outlined|filled|underline),labelColor,priceColor,pageLayout,headerShow,headerBg,headerText,banner}`. Field types: text, email, phone, number, textarea, dropdown, checkbox, multiselect.
Campaign: `id,name,marketer,formId,status(Active|Paused|Ended),budget,spent,startDate,endDate,orders,revenue`.
Business: `id,name,logo,currency,createdAt`. storeSettings: `logo,currency,roundRobin,rrIndex,rrRole,preventDuplicateOrders,soundEnabled,customStatuses[],notificationEmail,emailNotifs{adminOrderAlert,staffOrderAlert},emailMarketing{...},smsAutomation{provider,status,credits,rate,senderName,senderStatus,bulkCampaigns[],workflows[]},storefront{...},storefrontProducts[], per-product assignment rules, WooCommerce config + status mapping`.
Customer service: `customerProfiles` (map by phone), `followUps[]` (tabs Overdue/Today/Tomorrow/This Week/Completed). Productivity: `todos, tasks, goals` (Priority, Status, Progress %).
Role/target: `customRoles[{id,name,description,permissions[]}]`, `roleTargets{<role>:{criteria,reward}}`, `payouts[]`.

## Marketing site backend (getsalesgee.com) (SEEN in bundle)

Built on the Base44 platform (`https://base44.app`, `/api/apps/public`, `/apps/<id>/entities/<Entity>`, `/apps/<id>/functions/<name>`, `/auth/...`). Entities: OnboardingSubmission, BlogPost, Affiliate, TiktokPixel, MetaPixel, Contact, PricingPlan, AutomatedEmail, ScheduledCampaign, FinanceRecord, Article, Referral, AbandonedCheckout, Feature, FAQ. Functions: affiliatePayout, affiliateWithdraw, flutterwaveConfig, initiatePaystackPayment, paystackBanks, recordReferral, sendBookingEmail, sendBulkEmail, sendContactEmail, sendOnboardingEmails, verifyFlutterwavePayment, verifyPaystackPayment. Evidence: ev_201976c6dce9e5f038ca873cf7417f6e5c6d23a1bc7447d66a08532bc9355e19 (routes), grep of the 1.6 MB `index-B7VS7WFP.js` (endpoints, entities).
