# Recon fact-check (main session, 2026-10-17)

The Sonnet fact-check agent hit the session limit, so the main session checked the key claims directly.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Sniper live prices ₦12k/₦15k/mo, ₦115k/₦145k/yr, ₦2.5M lifetime | CONFIRMED | sniper/raw/landing-cms-home.json (`pricing.plans.*`) |
| 2 | Sniper is USD $0/$79/$199 (public-data gap fill) | WRONG | Stale static HTML; live page uses the CMS JSON above. Correction appended to public/findings.md |
| 3 | Sniper fraud controls exist, off by default | CONFIRMED | sniper/screens/fraud-controls-shields.jpg (toggles off) |
| 4 | Sniper agent float overdue after 48 h | CONFIRMED (screen text) | sniper/screens/finance-cash-inflow-field-float.jpg; findings.md §3.9 |
| 5 | Sniper Delivery Providers "Coming soon", AI Sales Rep stub | CONFIRMED | screens integrations-delivery-providers-coming-soon.jpg, commerce-ai-sales-rep-stub.jpg |
| 6 | SalesGee in-app license: Scale ₦12.5k/mo · ₦55k/6 mo · ₦95k/yr; Platinum ₦20k · ₦90k · ₦150k; Enterprise ₦1.5M/yr | CONFIRMED | salesgee/evidence/demo-page-license.html (`window.SGCRM.license.plans`), fetched by main |
| 7 | SalesGee "Elite ₦180k per 6 months" | UNSUPPORTED | Not in saved evidence |
| 8 | SalesGee "no free plan" | PARTLY WRONG | Homepage FAQ says "Free Forever plan… up to 1,000 orders per month, up to 5 active products" (salesgee/evidence/ui-text/site-home.txt:223). The in-app license list has no free tier. |
| 9 | SalesGee 13 statuses incl. Number Busy | CONFIRMED | app.1.0.410.pretty.js:278, :4925 |
| 10 | CodAdmin: no subscription enforcement; maxOrders/maxUsers only displayed | CONFIRMED | No middleware references; only billingController.ts:67 reads maxOrders |
| 11 | CodAdmin: Account.code and JournalEntry.entryNumber globally @unique | CONFIRMED | schema.prisma model Account / JournalEntry |
| 12 | CodAdmin: 12 models without tenantId | CONFIRMED | 0 tenant refs in each model block |
| 13 | CodAdmin: PATCH stock is a raw overwrite | CONFIRMED | productController.ts ~186 `data: { stockQuantity }` |
| 14 | CodAdmin MCP has 13 tools | WRONG — 14 | tools/*: orders 2 + ordersWrite 1 + analytics 3 + agents 2 + reps 2 + deliveries 1 + customers 1 + products 1 + financial 1 |
| 15 | Three 20260218 migrations are one-line placeholders | CONFIRMED | wc -l = 1 each |
| 16 | Dashboard deliveryRate mixes cohorts | CONFIRMED | analyticsService.ts:86-88 (deliveryDate) vs :241 (totalOrders by createdAt) |
| 17 | financialService.recordExpense exists | CONFIRMED | financialService.ts:347 |
| 18 | MAN-56 state machine only on a local unpushed branch; multi-store unmerged | CONFIRMED | git: 2 commits ahead of develop, no remote head; per-login 20 ahead |
| 19 | Linear: 36 open CodAdmin issues (FB 11, Embed 9, Launch 8, Multi-store 6, Finance 2); MAN-64 Backlog; MAN-19/20 Todo | CONFIRMED | scratch linear/issues1.json recount |

Not independently checked: every SalesUnbox price (source: app.js in salesunbox/raw/), E-Myth page citations, Sniper KPI formulas beyond the summary (marked SEEN-CODE by the agent with component names).
