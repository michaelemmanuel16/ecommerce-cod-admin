# SalesUnbox competitor findings

Researched 2026-10-17 from public pages only. No signup or form submitted.
Labels: SEEN (source URL given) or GUESS.

## Summary

SalesUnbox (Sales Unbox International Limited, Nigeria) sells four modules: Unbox Inventory, Unbox CRM, Unbox Accounting and Unbox Commerce (online store + POS + order tools). It targets Nigerian SMEs and retailers. Its public copy has no cash-on-delivery workflow, no call-centre or sales-agent module, no remittance, no fraud check, and no order-status pipeline. Those are CodAdmin's core. Reviews on the site are self-published testimonials. I found no independent reviews.

## Features and how they work

Orders (Commerce)
- Every order carries customer, delivery and payment details and is "tracked from checkout through to delivery in one list". SEEN: app.js FAQ, https://www.salesunbox.africa/ (bundle /assets/index-Cv6eR6bU.js). No named status list was found.
- Phone and DM orders can be created by the seller and "still affect your stock". SEEN: same FAQ.
- Delivery: "Fez Delivery integration" dispatches from the order record. Delivery fees can vary by area. SEEN: same FAQ.
- Returns are recorded against the original order and restock. SEEN: Inventory FAQ.

Call-centre / sales agents
- No dedicated call-centre or agent-assignment module found. CRM has "per-agent activity" reports and a ticket queue with owners. SEEN: CRM FAQ ("Complaints become tickets with an owner and a status"; "Response times, resolution rates, and per-agent activity are reported").

Delivery / logistics
- Only one partner named: Fez Delivery. go54 is named for domains. SEEN: FAQ. No RTO, failed-delivery or remittance tooling found.

Inventory
- Live stock per location; transfers with a log; expiry and low-stock alerts; damaged stock tracked separately; variants; SKUs and barcode scanning; markup rules (cost + %); bulk purchase with draft; vendor tracking; warehouse zones/aisles/bins (Inventory FAQ). SEEN.
- Audit trail with staff and timestamp. SEEN.

Products / catalogue
- Import from Excel template, from Instagram or Facebook catalogue, or one by one. Unlimited products on Commerce; caps by plan on Inventory. SEEN (Commerce FAQ; plan array in bundle).

Customers / CRM
- One record per customer with purchase history; shared WhatsApp/email inbox; pipeline with owners and stages; tickets; chatbots; email and SMS campaigns with open and delivery rates. SEEN (CRM FAQ).

Storefront / order forms
- Website builder with theme, colours, fonts, Meta Pixel, custom domain, coupons. Share links on Instagram and WhatsApp. SEEN (Commerce FAQ).
- No "order form" or landing-page product found beyond the storefront. GUESS that the checkout is a storefront cart.

WhatsApp / SMS
- WhatsApp integration and management is on Growth (Commerce). SMS is on Lite. SEEN (Commerce plan FAQ). No automated COD confirmation flow described.

Payments
- Card and bank transfer via Paystack, Flutterwave, Moniepoint, OPay, PalmPay, Kuda, Nomba, plus cash. Settles to the bank account in settings. SaaS fee is separate from processing fees. SEEN (Commerce FAQ).

Expenses / finance
- Double-entry accounting: chart of accounts, invoices, bills, expenses, bank reconciliation, P&L, balance sheet, cash flow, trial balance, general ledger, journal. Recurring invoices, credit notes, multi-currency invoices, pending expense approval. SEEN (Accounting FAQ; homepage text).

Remittance, fraud checks: none found. Legal text mentions fraud prevention only as a data-use purpose (privacy policy). SEEN, low weight.

Reports
- Stock and sales by product, location or staff; sales analytics; product performance; customer insights; exports. SEEN (Inventory FAQ).
- Accounting: income and expenses, profit, cash balance, receivables; P&L, balance sheet, trial balance. SEEN.

## KPI list

Only plain-language names. No formulas were shown.
- Low-stock and out-of-stock flags (threshold-based). SEEN.
- Expiry flag ahead of expiry date. SEEN.
- Product movement (what sells). SEEN.
- Sales by location in naira or %. SEEN.
- Open and delivery rate (campaigns). SEEN.
- Response time, resolution rate, per-agent activity (CRM). SEEN.
- Paid / due / overdue invoice status; outstanding receivables. SEEN.
- Formulas: none shown. UNVERIFIED.

## Team roles and integrations

- Roles control what each staff member sees (cashier cannot see cost or margin). Staff logins. Revoking access is immediate. SEEN.
- Integrations listed: Moniepoint, OPay, PalmPay, Kuda, Paystack, Flutterwave, Nomba, Instagram, WhatsApp, WooCommerce, Fez Delivery, go54. Public API keys on Inventory Professional and above. SEEN.

## AI features

- Homepage copy has an AI-related blog post only. No AI product feature found in app copy. GUESS: no AI feature.

## Pricing

Commerce (SEEN, Commerce FAQ in bundle):
- Lite: N5,000/month. Growth: N12,000/month. Yearly = 11 months billed. Custom for multi-location.
- Lite: store, products, inventory, orders, bookkeeping, coupons, custom domain, SMS.
- Growth adds: WhatsApp integration and management, WhatsApp and email communication, automated delivery, multi-currency, geo-location.
- Trial: 7 days, no card.

Inventory (SEEN, plan array in bundle; monthly, quarterly, yearly):
- Starter N30,000 / N90,000 / N330,000. 2 users, 1 location, 1,000 products, 1,000 orders/mo.
- Growth N60,000 / N180,000 / N660,000. 3 users, 3 locations, 5,000 products, 3,000 orders/mo. "MOST POPULAR".
- Professional N150,000 / N450,000 / N1,650,000. 5 users, 5 locations, 10,000+ products, 7,500 orders/mo. Public API.
- Enterprise: custom.
- Trial: 30 days, no card.

Accounting and CRM: 30-day trial each. Prices not extracted (the pricing page is client-rendered). GUESS: same plan grid.

Referral: N50 credit per invited user (text says "#50"). SEEN (FAQ). Currency symbol in source is a typo; treat as UNVERIFIED.

## UI notes

- No screenshots pulled. Product pages are client-rendered, and the static HTML only has the title. Product "shot" image keys exist in the bundle but I did not fetch the images. GAP.
- No YouTube demo or transcript found in this pass. GAP.

## Reviews and complaints

Self-published testimonials on the homepage (SEEN, bundle):
- Mr Afam, Chelis Bookazine: "With SalesUnbox I see every branch from one place. What convinced me though is that the team actually listened."
- Mr Daniel, Drug & Medicament: "SalesUnbox flags goods before they expire, so we move them early..."
- Peace Bello, MegaOnline Store: "my favourite part, the super quick response from the team in giving support."
- Kehinde Ojedele, Businessaproko: "business finance and bookkeeping features especially valuable."
- Miriam Davis, Bimbzskinhaven: "even when I'm sleeping, I still make sales."
- Oyedele Stephen: "one of the best platforms to make it easy for a business owner."

Complaints: none found. Searches for Nairaland, Reddit and Twitter mentions returned no SalesUnbox results. Independent review sites: none found. GAP.

## Marketing and positioning

- Positioning: "all-in-one business software suite for African businesses" and "Business Software for African Retailers". SEEN (homepage title, meta, JSON-LD).
- Target: SMEs, startups, large enterprise (solutions pages: /solutions/startups, /smes, /large-enterprise). SEEN from sitemap.
- Channels: Facebook, X, Instagram, LinkedIn. Blog with about 50 SEO posts on retail, bookkeeping, grants (sitemap). Ad pixels: Meta and TikTok on the site. SEEN.
- Support: hello@salesunbox.africa and WhatsApp +2349033799733 (public, from FAQ).

## Strengths (for CodAdmin)

- Multi-location inventory with transfers and audit trail.
- Real double-entry accounting, which CodAdmin lacks.
- Bundles CRM, inventory, POS and store in one login.
- Integrations with Nigerian payment providers and Fez.

## Gaps (what SalesUnbox does not show)

- No COD workflow: no pending-to-confirmed-to-delivered pipeline, no failed-delivery reattempt, no RTO handling, no remittance from the courier.
- No call-centre or agent assignment. CodAdmin's core.
- No fraud or address-risk scoring.
- No Ghana coverage (areaServed is NG). Ghana is CodAdmin's core market.
- Most SalesUnbox copy is generic SME tooling.

## Unknowns

- Plan prices for Accounting and CRM.
- Whether the storefront supports pay-on-delivery. Not stated.
- Real user count, traction, funding.
- Whether the app.salesunbox.africa dashboard shows an order-status list (login required; not tried).

## Sources

- https://salesunbox.africa/ (static HTML: title, meta, JSON-LD)
- https://www.salesunbox.africa/sitemap.xml
- https://www.salesunbox.africa/assets/index-Cv6eR6bU.js (app bundle: FAQ, plan array, testimonials)
- Raw saved: /private/tmp/claude-501/-Users-mac-work/19c20e15-e69d-4f4e-8677-c4859e2c7a49/scratchpad/salesunbox/ (app.js, faq.txt, strings.txt, home.html, sitemap.xml)

## Gap fill (2026-10-17, follow-up)

### 1. Plan prices (SEEN, app.js bundle, `Bs`, `Vs` and plan arrays)

Prices are NGN. Monthly / quarterly / yearly.

- Inventory, Accounting, CRM share one price map (`Bs`): Starter 30,000 / 90,000 / 330,000; Growth 60,000 / 180,000 / 660,000; Professional 150,000 / 450,000 / 1,650,000; Enterprise custom.
  - Accounting plans (`Hs.accounting`, `Py`) use this map (SEEN). Accounting Starter: 2 users, single fiscal year. Growth: 5 users, multi-year accounting. Professional: up to 5 users, automated FX gain/loss. Enterprise: unlimited users, custom tax engine.
  - CRM plans (`Hs.crm`) also show Starter / Growth / Professional / Enterprise (SEEN). CRM Starter: 2 users, up to 1,000 contacts. Growth: 5 users, up to 10,000 contacts. Professional: up to 10 users, unlimited contacts, workflow automation. Mapping CRM to the same price map is GUESS.
- Commerce (`Vs`, `kv`): Lite 5,000 / 15,000 / 55,000; Growth 12,000 / 36,000 / 132,000; Custom (unpriced). SEEN.
  - Lite: 1 storefront, up to 50 products (per plan array), WhatsApp and social selling, basic orders.
  - Growth: 3 users, up to 500 products, custom domain, discount codes.
  - Custom: unlimited users and storefronts, custom checkout flows, advanced logistics integration.
- Conflict: Inventory Starter shows "Up to 500 SKUs" in one array and "Manage up to 1,000 products" in the pricing array. Commerce product limits also conflict (FAQ says unlimited; Lite array says 50). UNVERIFIED which is live.

Code (SEEN, app.js):
```
Bs={starter:{monthly:3e4,quarterly:9e4,yearly:33e4},growth:{monthly:6e4,quarterly:18e4,yearly:66e4},professional:{monthly:15e4,quarterly:45e4,yearly:165e4},enterprise:null}
Vs={lite:{monthly:5e3,quarterly:15e3,yearly:55e3},growth:{monthly:12e3,quarterly:36e3,yearly:132e3},enterprise:null}
```

### 2. App routes, statuses, KPIs (SEEN in bundle, with limits)

Routes in the marketing bundle (SEEN, app.js route table):
`/`, `/about-us`, `/blog/:slug`, `/demo`, `/demo/thank-you`, `/learn/blogs`, `/learn/community`, `/learn/contact-us`, `/learn/faqs`, `/pricing`, `/privacy-policy`, `/terms`, `/terms-and-conditions`, `/trial`, `/smes`, `/solutions/startups|smes|large-enterprise`, and `/products/{inventory,commerce,crm,accounting}/{overview,features,pricing,faq}`.

App screens are not in this bundle. The app lives on separate hosts (`app.salesunbox.africa`, `app.inventory.salesunbox.com`, `app.crm.salesunbox.com`, `app.accounting.salesunbox.com`). Not fetched (login required). Screen names below come from the demo video narration instead.

Screen names from the Inventory demo (SEEN, video transcript, timestamps are the 30-second block start):
- Dashboard [2:00]: total products, total sales, orders, customers, recent sales, alerts, quick actions, recent orders, blog posts.
- Inventory / Product [3:00]: categories, product list, manual add, Excel bulk import, bad (damaged) inventory, transfers across locations.
- Locations [8:00], Vendors [8:30], Customers and loyalty points [9:00], Staff and Roles [9:30–10:30] (e.g. a "stock keeper" role with inventory-only access).
- Reports [11:00] with Excel export; Analytics [11:30]; Product performance [11:30]; Customer insights [11:30]; Audit trail [12:00]; API keys [12:00]; Integrations "still upcoming" [13:00].
- Settings [13:30–15:00]: currencies, subscriptions and renewal, loyalty points and expiry, payment methods and tax, email configuration, stock alerts, support.

Commerce screens (SEEN, Commerce setup/demo video [ZICnaoCa0-g] and the Commerce demo [nzl2bZF6LZU] narration):
- Products [3:00] with types physical, digital, service; categories; variants.
- Coupons [4:15]; Orders [4:24] ("select an order ... change the status" — the status list was not named); Wallet [4:45] (funds SMS and domain purchases); Invoices [5:37] (with an online payment link option); Customers [6:57]; Campaigns [7:06] (SMS just released; WhatsApp campaign not yet; email); Settings [8:01] (subscription, bank account, store theme, delivery fee, socials).

Accounting screens (SEEN, Accounting demo fGpi5BGwgXw, 1-minute blocks):
- Accounting: chart of accounts, journal entry, recurring entry, general ledger, transaction history [3:00].
- Sales: customers, invoices, credit notes, payments received, recurring invoices [3:00]. Customers can be company or individual, with payment terms like Net 45, branches, reporting tags, up to 5 supporting files [9:00–12:00].
- Purchases: vendors, bills payable, vendor credit, payments made, recurring bills [3:00].
- Expenses: list, recurring, categories [3:00].
- Bank and cash; Settings (organisation, templates, notifications, users, roles, departments, tax, integrations) [4:00].
- Approval flow: none, simple, or multi-level, for invoices, bills and expenses [18:00–21:00].
- Free plan limit: 2 users [23:00].

Status and enum values (SEEN, bundle search):
- No order-status or invoice-status enum found in the marketing bundle. The only status strings are React and axios internals (`pending`, `fulfilled`, `canceled`).
- Invoice states named in copy: paid, due, overdue, sent, draft (FAQ, video). Order states named: none.
- CRM ticket: "an owner and a status" (FAQ). CRM pipeline: "owners and stages" (FAQ). No stage names.
- Recurring frequencies: daily, weekly, every two weeks, monthly, every two months, quarterly, yearly [15:00 Accounting demo].
- Approval types: none, simple, multi-level (SEEN, video).

KPI names (SEEN, copy and video, no formulas shown):
- Dashboard: total products, total sales, orders, customers, recent sales, alerts.
- Accounting: income and expenses, profit, cash balance, outstanding receivables, profit and loss, balance sheet, cash flow, trial balance.
- Inventory: low-stock and out-of-stock flags, expiry flag, product movement, product performance, sales by location (naira or %), customer insights.
- CRM: response time, resolution rate, per-agent activity, open and delivery rate (campaigns).
- Commerce: profit and loss against a store target ("Profit & targets").

### 3. Social accounts and demo videos (scrape-creators, SEEN)

- Instagram `@sales_unbox` (SEEN, raw/instagram-sales_unbox-profile.json): "SalesUnbox | Inventory Software", 1,010 followers, 425 posts, bio link `inventory.salesunbox.com/demo/`. Caption (SEEN): "Here's a step-by-step guide to set up your SalesUnbox account on the mobile app. Download now on iOS or Play Store." This confirms native iOS and Android apps.
- LinkedIn `/company/salesunbox` (SEEN, scrape-creators): 246 followers, 5 employees, self-described "Embedded Software Products". Slogan: "The Retail Operating Platform for Africa's Growing Businesses." Recent posts (Oct 11–15, 2026) include a Punch newspaper interview with CEO Mayowa Oladunjoye (post dated 2026-10-12). Also claims "book a free demo" CTAs.
- TikTok `@salesunbox` (SEEN): 227 followers, 96 videos, 829 likes, category "Shopping & Retail", bio "Helping businesses track sales, manage inventory...".
- YouTube `@SalesUnbox` (SEEN, channel UClF0EGYKT3RhUxAEAEpjbhw): 28 subscribers. Videos with view counts at search time:
  - "SalesUnbox Demo" nzl2bZF6LZU, 10:10, 133 views (commerce/platform walkthrough).
  - "How to setup your SalesUnbox account" ZICnaoCa0-g, 4:27, 13 views.
  - "Unbox Inventory Product Demo" NihQoveSUtI, 15:59, 42 views.
  - "Unbox Accounting Product Demo" fGpi5BGwgXw, 24:51, 5 views.
  - "Why your business needs SalesUnbox" wiqj0wbbOOk, 2:46, 41 views.
  - "SalesUnbox Teaser campaign video" tF0KykxzvaI, 1:02, 9 views.
  - "Simple Tips for Selling Online" RKsnfWwAMt0, 5:28, 32 views.
  - "One secret any business person should know" zhhl4AWsXdM, 3:24, 10 views.
  - About 20 Shorts, most under 300 views.
- Facebook (`web.facebook.com/people/Salesunbox/61558014894808`) and X (`@sales_unbox`) are listed in JSON-LD. Not fetched.

Transcripts (SEEN, 1 credit each):
- Inventory demo NihQoveSUtI (raw/yt_inventory_demo_transcript.txt, 30-second blocks). Key lines:
  - [0:30] "We have two products that live now... Commerce... Inventory."
  - [1:30] "we have onboarded over 5,000 businesses since we started two years ago."
  - [4:30] Add-product form: barcode, quantity, unit type, category, store location, low-stock alert threshold, expiry date, warehouse or vendor. Example product "Good Mama" detergent.
  - [6:00] POS: "several sessions" for parallel customers, tax setting, loyalty points, mark paid, refund "will recalculate all the stock back".
  - [13:00] "Integrations is still upcoming."
  - [15:00] "this particular sub is not the enterprise one... some other menus [are] hidden."
- Accounting demo fGpi5BGwgXw (raw/yt_accounting_demo_transcript.txt, 1-minute blocks). Key lines are in the screen list above.
- Setup video ZICnaoCa0-g [0:00–4:17] (transcript returned inline; not saved to raw). Key lines:
  - [0:10] Sign-up: name, email, phone, password, optional referral code.
  - [1:08] "we need to complete a KYC verification" with a utility bill or a "CSA" certificate (ASR transcript; probably CAC) and bank details.
  - [2:33] WhatsApp number may differ from the phone number.
  - [3:08] Physical product type; variants "blue, purple".
  - [4:03] "Let's visit our site" (store preview).
- Commerce demo nzl2bZF6LZU [0:00–10:10] (returned inline; not saved). Key lines:
  - [0:03] "operational tool for small businesses"; apps on Play Store and App Store, plus web.
  - [1:01] "free website where they can upload product... receive online payments."
  - [7:13] "we have just released the SMS campaign" (WhatsApp campaign not yet).
  - [8:50] delivery fee set manually; "adding a feature ... to connect with an existing delivery partner" soon.

### Raw files
Folder: `/Users/mac/work/codadmin/docs/research/competitors/salesunbox/raw/`
- home.html, app.js (the 1.1 MB bundle), faq.txt (196 Q&A pairs), strings.txt, sitemap.xml.
- yt_inventory_demo_transcript.txt, yt_accounting_demo_transcript.txt (condensed).
- youtube-NihQoveSUtI-inventory-demo-transcript.json, youtube-fGpi5BGwgXw-accounting-demo-transcript.json (full API output).
- instagram-sales_unbox-profile.json (full API output).

### Gaps (after follow-up)
- The app itself (login-gated) was not sampled. Routes and enums in the app are unverified.
- The Commerce demo and setup transcripts were returned inline only, so they are not in raw/.
- Screenshots were not extracted. The demo videos were read via transcripts only, so no frames were checked.
- Facebook and X posts were not pulled.
- TikTok videos were not listed (profile only).
