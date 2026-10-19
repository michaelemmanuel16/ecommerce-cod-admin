# Linear issue draft for CodAdmin Rebuild
> 2026-10-19: issues moved from team MAN to team CodAdmin (COD) to stop the Linear sync copying them into the admarrow GitHub repo. Old MAN keys still open in Linear.

Draft only. Nothing here is created in Linear yet. One issue per feature slice, 6 to 10 per milestone. Each issue covers a set of plan tasks from `docs/plan/<milestone>.md`; hours are the sum of the task hours (likely, no buffer).

## M0

### M0-I01 (COD-2, was MAN-225) Baseline tests and production schema parity
- Tasks (10): T01, T02, T03, T04, T05, T06, T07, T31, T32, T33
- Likely hours: 45
- Branch, baseline test run, fix or skip failing tests, the double-decrement test, production schema dump, parity migrations, R15 money-unit check, CI parity job, deploy guard and staging rehearsal of the 11 pending migrations.

### M0-I02 (COD-3, was MAN-226) Close open routes and the public register
- Tasks (4): T08, T17, T18, T19
- Likely hours: 16
- Remove public register, add role and ownership checks on delivery routes, require tenant on the public config call, remove the legacy Paystack handler.

### M0-I03 (COD-4, was MAN-227) Tenant columns, uniques and fail-closed scope
- Tasks (8): T09, T10, T11, T12, T13, T14, T15, T16
- Likely hours: 51
- Add required tenant_id everywhere, per-tenant uniques, fail-closed Prisma extension, seed defaults per tenant, tenant context for jobs, public routes, webhooks and socket rooms.

### M0-I04 (COD-5, was MAN-228) Money helper and Decimal migration
- Tasks (3): T20, T21, T26
- Likely hours: 17
- One Money helper on Prisma.Decimal, migrate the 29 money columns to Decimal(19,4), and the script that proves no value changed.

### M0-I05 (COD-6, was MAN-229) Move money arithmetic off number
- Tasks (4): T22, T23, T24, T25
- Likely hours: 28
- Orders, finance, analytics, MCP output and the frontend parse money through the helper only.

### M0-I06 (COD-7, was MAN-230) Two-tenant test harness and suites
- Tasks (4): T27, T28, T29, T30
- Likely hours: 21
- Helper that makes two tenants, then isolation suites for models, HTTP, sockets, MCP, CAPI and public tracking.

### M0-I07 (COD-8, was MAN-231) Docs, coverage gate and M0 close-out
- Tasks (6): T34, T35, T36, T37, T38, T39
- Likely hours: 22
- Fix CLAUDE.md, set the coverage gate, simplify review, full checks, browser check and owner review.

M0 total: 7 issues, 39 tasks, 200 h

## M1

### M1-I01 (COD-9, was MAN-232) Order timestamps, shared data and phone normalisation
- Tasks (7): T01, T02, T03, T04, T05, T06, T07
- Likely hours: 35
- Migrations for the new order fields and models, region helper, normalizePhone in every write path, timestamp backfill, digital order revenue date.

### M1-I02 (COD-10, was MAN-233) Order state machine and every status writer
- Tasks (7): T08, T09, T10, T11, T12, T13, T14
- Likely hours: 43
- transitionOrder core, override and integration jumps, one place for side effects, route all writers through it, status API, remove dead customer code.

### M1-I03 (COD-11, was MAN-234) KPI base, revenue and rates
- Tasks (3): T15, T16, T17
- Likely hours: 18
- KpiResult type, delivered revenue, confirmation and delivery rates with cohort basis.

### M1-I04 (COD-12, was MAN-235) Rep, leadership, product and partner KPIs, plus fixture
- Tasks (7): T18, T19, T20, T21, T22, T23, T24
- Likely hours: 42
- Rep performance, pace marker and projection, product units, partner rates, time to first call, and the deterministic fixture reproducing NUMBERS.md.

### M1-I05 (COD-13, was MAN-236) Repoint endpoints and MCP tools to the KPI layer
- Tasks (3): T25, T26, T27
- Likely hours: 18
- Analytics endpoints and MCP tool internals read from the KPI service; delete duplicate and dead analytics.

### M1-I06 (COD-14, was MAN-237) FX rates and order-versus-ledger check
- Tasks (5): T28, T29, T30, T31, T32
- Likely hours: 30
- FxRate service and job, FX API and currency rules, Currencies tab, nightly order-vs-ledger job, cash report check.

### M1-I07 (COD-15, was MAN-238) KPI contract tests, wording guard and M1 close-out
- Tasks (6): T33, T34, T35, T36, T37, T38
- Likely hours: 25
- Wording guard, contract and fixture tests, simplify review, full checks, browser check, owner review.

M1 total: 7 issues, 38 tasks, 211 h

## M2

### M2-I01 (COD-16, was MAN-239) Roles, system user and audit-ready schema
- Tasks (3): T01, T02, T03
- Likely hours: 17
- UserKind and related migration, six roles seeded per tenant, one system user per tenant.

### M2-I02 (COD-17, was MAN-240) Tool registry, audit service and rate limiter
- Tasks (3): T04, T05, T06
- Likely hours: 21
- ToolDef registry core, auditService.record with redaction, Redis rate limits for MCP.

### M2-I03 (COD-18, was MAN-241) Move all tools onto the registry and rewire MCP
- Tasks (6): T07, T08, T09, T10, T11, T12
- Likely hours: 37
- Three batches of read tools, orders_update_status as a write tool, new MCP server wiring, 14-tool contract tests.

### M2-I04 (COD-19, was MAN-242) MCP keys API and AI Assistant card
- Tasks (3): T13, T14, T15
- Likely hours: 17
- Keys API with userId, Settings card for keys, generated schema resource.

### M2-I05 (COD-20, was MAN-243) Workflows through services and machine triggers
- Tasks (2): T16, T17
- Likely hours: 15
- Workflow actions call services; triggers fire from transitionOrder.

### M2-I06 (COD-21, was MAN-244) Security tests and M2 close-out
- Tasks (5): T18, T19, T20, T21, T22
- Likely hours: 21
- Two-tenant and isolation tests, simplify review, full checks, live check, owner review of legacy keys.

M2 total: 6 issues, 22 tasks, 128 h

## M3

### M3-I01 (COD-22, was MAN-245) Customer stats, nav, search and Dashboard/Reports APIs
- Tasks (9): T02, T03, T07, T08, T09, T10, T20, T21, T27
- Likely hours: 55
- Customer stats migration and recompute, nav counts, global search, unread count, Dashboard owner endpoint and chart, Reports overview, sales and delivery APIs.

### M3-I02 (COD-23, was MAN-246) Orders API: list, bulk, create, import, export, detail
- Tasks (6): T11, T12, T13, T14, T15, T16
- Likely hours: 44
- Server-side sort and filters, bulk status, create and edit, import validation, streaming export, order detail.

### M3-I03 (COD-24, was MAN-247) Customers, account, sessions and settings APIs
- Tasks (6): T17, T22, T23, T24, T25, T26
- Likely hours: 38
- Customers list and summary, profile API, UserSession rotation, data export, business details and onboarding API, SaaS flag and plans.

### M3-I04 (COD-25, was MAN-248) Design tokens, base components and app shell
- Tasks (11): T28, T29, T30, T31, T32, T33, T34, T35, T36, T37, T38
- Likely hours: 62
- Tokens, base components, ConfirmDialog, money formatter, shell and sidebar, role menu and guards, dark mode, command palette, bell, error page, delete unrouted files.

### M3-I05 (COD-26, was MAN-249) Dashboard UI and role homes
- Tasks (3): T39, T40, T41
- Likely hours: 20
- Page frame, driver tiles, chart, role homes for manager and others.

### M3-I06 (COD-27, was MAN-250) Orders list and order drawer UI
- Tasks (7): T42, T43, T44, T45, T46, T47, T48
- Likely hours: 52
- Columns, search and sort, actions, new order modal, drawer with timeline, import modal.

### M3-I07 (COD-28, was MAN-251) Customers and Reports UI
- Tasks (5): T49, T50, T60, T61, T62
- Likely hours: 38
- Customers list and detail, Reports shell, Overview, Sales and Team tabs.

### M3-I08 (COD-29, was MAN-252) Settings and onboarding UI
- Tasks (6): T63, T64, T65, T66, T67, T68
- Likely hours: 34
- Settings shell, Security tab, Business and Order statuses tabs, mount Currencies and AI cards, onboarding wizard, platform plan filter.

### M3-I09 (COD-30, was MAN-253) M3 tests, simplify, checks and owner gates
- Tasks (7): T69, T70, T71, T72, T73, T74, T75
- Likely hours: 41
- Frontend sweep, Playwright owner flow, backend integration sweep, simplify review, full checks, browser check, owner review.

M3 total: 9 issues, 60 tasks, 384 h

## M3b

### M3b-I01 (COD-31, was MAN-254) Payment schema, provider interface, connections and form rules
- Tasks (4): T02, T03, T04, T05
- Likely hours: 26
- PaymentConnection models, PaymentProvider interface, connection routes, prepaid and deposit rules per form.

### M3b-I02 (COD-32, was MAN-255) Neutral webhook, online orders and provider fees
- Tasks (2): T06, T07
- Likely hours: 13
- Signature-checked webhook, online order creation, provider fee posting and Paystack payout posting.

### M3b-I03 (COD-33, was MAN-256) Checkout forms API and public checkout rules
- Tasks (2): T08, T09
- Likely hours: 14
- List, clone, archive, stats; sold-out check, region and country rules on the public side.

### M3b-I04 (COD-34, was MAN-257) Forms list and editor shell with Basics tab
- Tasks (2): T10, T11
- Likely hours: 14
- Forms list UI and the editor shell with the Basics tab.

### M3b-I05 (COD-35, was MAN-258) Editor tabs and live preview
- Tasks (4): T12, T13, T14, T15
- Likely hours: 24
- Packages, Payment and Design tabs, live preview pane.

### M3b-I06 (COD-36, was MAN-259) Public checkout restyle, success and payment callback
- Tasks (3): T16, T17, T18
- Likely hours: 17
- New checkout page, order success screen, provider-neutral payment callback page.

### M3b-I07 (COD-37, was MAN-260) M3b tests and close-out
- Tasks (7): T19, T20, T21, T22, T23, T24, T25
- Likely hours: 34
- Pixel and CAPI regression tests, integration sweep, e2e, simplify, checks, browser check, owner review.

M3b total: 7 issues, 24 tasks, 142 h

## M4

### M4-I01 (COD-38, was MAN-261) Stock and partner schema, stock migration, fixture
- Tasks (5): T01, T02, T03, T04, T05
- Likely hours: 31
- Stock and partner migrations, stock migration script with dry run and equal-sum check, fixture reproducing the sample values.

### M4-I02 (COD-39, was MAN-262) Stock service, order wiring and transfers
- Tasks (5): T06, T07, T08, T09, T10
- Likely hours: 36
- stockService as the single writer, stock leaves once at delivery, characterization test flipped, transfers service and routes.

### M4-I03 (COD-40, was MAN-263) Shipments, receiving and landed cost
- Tasks (3): T11, T12, T13
- Likely hours: 20
- shipmentService, receive with counted quantity and short claim, landed cost on orders.

### M4-I04 (COD-41, was MAN-264) Stock counts, inventory read APIs and nightly check
- Tasks (4): T14, T15, T16, T17
- Likely hours: 26
- Count service, inventory overview and levels, Products API, nightly stock-vs-levels job.

### M4-I05 (COD-42, was MAN-265) Delivery partner and proof APIs
- Tasks (3): T18, T19, T20
- Likely hours: 20
- Partners read and write APIs, proof and attempts.

### M4-I06 (COD-43, was MAN-266) Products page, drawer, shipments tab and receive modal
- Tasks (4): T21, T22, T23, T24
- Likely hours: 29
- Products UI, product drawer, Incoming shipments tab, receive modal and claim panel.

### M4-I07 (COD-44, was MAN-267) Inventory page, stock modals, counts and keeper home
- Tasks (5): T25, T26, T27, T28, T29
- Likely hours: 32
- Inventory cards, Allocate/Transfer/Return/Adjust modals, count UI, receipt and dispute UI, stock keeper home.

### M4-I08 (COD-45, was MAN-268) Deliveries page and partner drawer
- Tasks (4): T30, T31, T32, T33
- Likely hours: 26
- Deliveries table, reasons card, partner drawer, add partner modal.

### M4-I09 (COD-46, was MAN-269) M4 tests, simplify, checks and owner review
- Tasks (8): T34, T35, T36, T37, T38, T39, T40, T41
- Likely hours: 42
- Worked-example integration tests, migration and two-tenant tests, partner tests, e2e, simplify, checks, browser check, owner review.

M4 total: 9 issues, 41 tasks, 262 h

## M5

### M5-I01 (COD-47, was MAN-270) Settlement schema, chart of accounts and Payout reshape
- Tasks (3): T02, T03, T04
- Likely hours: 14
- Settlement models, new accounts, Payout migration.

### M5-I02 (COD-48, was MAN-271) Fee rules, fee posting and the cash chain fix
- Tasks (3): T05, T06, T07
- Likely hours: 20
- One fee rule per partner, 5070 expense on outcome, single cash account 1015.

### M5-I03 (COD-49, was MAN-272) Findings, partner payouts and settlement matching
- Tasks (5): T08, T10, T11, T12, T17
- Likely hours: 30
- Findings service, the one record-partner-payout action, auto-reconcile, manual FIFO payout, CSV connector.

### M5-I04 (COD-50, was MAN-273) Collections, aging and Unpaid by agent
- Tasks (3): T13, T14, T15
- Likely hours: 16
- Verify and reconcile in one step, aging buckets per tenant, Orders tab.

### M5-I05 (COD-51, was MAN-274) Commission posting and unified payout service
- Tasks (2): T18, T19
- Likely hours: 13
- Commission entries post to 5050, one payout service for reps and partners.

### M5-I06 (COD-52, was MAN-275) Finance services, cash flow, expenses and backfill
- Tasks (7): T24, T25, T26, T27, T28, T29, T30
- Likely hours: 49
- Overview tiles, P&L and statements, profit by product, cash flow fix, expenses, journal and exports, backfill of 1,321 drafts.

### M5-I07 (COD-53, was MAN-276) Finance overview, findings, collections and fee-rule UI
- Tasks (5): T32, T34, T35, T36, T37
- Likely hours: 30
- Fee rule screen, Overview UI, Findings page, agent collections UI, manual payout modal.

### M5-I08 (COD-54, was MAN-277) Payout form, expenses, statements, cash flow and ledger UI
- Tasks (7): T38, T39, T40, T41, T42, T44, T45
- Likely hours: 41
- One payout form, Rep commissions tab, Expenses, Statements, Cash flow, chart of accounts, Reports products tab, cleanup.

### M5-I09 (COD-55, was MAN-278) M5 tests, simplify, checks and owner review
- Tasks (6): T46, T47, T48, T49, T50, T51
- Likely hours: 26
- Fixture tests, two-tenant and idempotency tests, simplify, checks, browser check, owner review.

M5 total: 9 issues, 41 tasks, 239 h

## M6

### M6-I01 (COD-56, was MAN-279) Roles, permissions, staff and invites backend
- Tasks (6): T01, T02, T03, T04, T05, T06
- Likely hours: 42
- Reward and role models, six system roles, role API, allowed tools and permission matrix, staff service, invite flow.

### M6-I02 (COD-57, was MAN-280) Targets and North Star services
- Tasks (2): T07, T08
- Likely hours: 16
- Target hierarchy, North Star tree creation.

### M6-I03 (COD-58, was MAN-281) Rewards, month close, leaderboard and assignment
- Tasks (5): T09, T10, T11, T12, T13
- Likely hours: 32
- Reward tiers and attainment, month-close job, leaderboard and badges, dashboard Top this month, assignment cursor.

### M6-I04 (COD-59, was MAN-282) Targets, Leaderboard, North Star wizard and Rewards UI
- Tasks (4): T15, T16, T17, T18
- Likely hours: 28
- Targets page, Leaderboard, setup wizard, Rewards settings tab.

### M6-I05 (COD-60, was MAN-284) Staff and roles UI
- Tasks (4): T19, T20, T21, T22
- Likely hours: 26
- Role cards and detail, team table, allowed tools matrix, pay card.

### M6-I06 (COD-61, was MAN-285) Fixture, security and invite tests
- Tasks (2): T23, T24
- Likely hours: 13
- Targets and rewards fixture tests, two-tenant and invite e2e.

### M6-I07 (COD-62, was MAN-286) M6 simplify, checks and owner review
- Tasks (4): T25, T26, T27, T28
- Likely hours: 13
- Simplify, full checks, browser check, owner review.

M6 total: 7 issues, 27 tasks, 170 h

## M7

### M7-I01 (COD-63, was MAN-287) Rep schema, commission entries, call outcomes and upsell
- Tasks (4): T01, T02, T03, T04
- Likely hours: 30
- UpsellLine and ConfirmToken models, base and upsell commission, five call outcomes, upsell service.

### M7-I02 (COD-64, was MAN-288) Operating hours, refusal rule and auto-confirm
- Tasks (5): T05, T06, T07, T08, T09
- Likely hours: 36
- First-call clock, refusal rule, rep customer and order creation, auto-confirm send, inbound WhatsApp core.

### M7-I03 (COD-65, was MAN-289) Rep API and rep home
- Tasks (4): T10, T11, T12, T13
- Likely hours: 25
- Today, queue, my orders, numbers, earnings and reward APIs, call stats, rep home replaces dashboard config.

### M7-I04 (COD-66, was MAN-290) Rep shell, Today and Queue pages
- Tasks (3): T14, T15, T16
- Likely hours: 20
- Rep navigation, Today page and reward card, Queue page with wait timers.

### M7-I05 (COD-67, was MAN-291) Call card, upsell panel and customer edit
- Tasks (3): T17, T18, T20
- Likely hours: 20
- Call card with outcome buttons, upsell panel with reward box, customer add and edit.

### M7-I06 (COD-68, was MAN-292) My orders, My numbers, Earnings and Operations settings
- Tasks (2): T19, T21
- Likely hours: 12
- Rep pages and Operations tab.

### M7-I07 (COD-69, was MAN-293) M7 tests, e2e and close-out
- Tasks (6): T22, T23, T24, T25, T26, T27
- Likely hours: 27
- Commission, clock and auto-confirm tests, e2e, simplify, checks, browser check, owner review.

M7 total: 7 issues, 27 tasks, 170 h

## M8

### M8-I01 (COD-70, was MAN-294) Meta access check and manual fallback
- Tasks (2): T01, T02
- Likely hours: 12
- Early scope check and Business Verification, CSV spend import if access is blocked.

### M8-I02 (COD-71, was MAN-295) Meta connection, insights pull and jobs
- Tasks (4): T03, T04, T05, T06
- Likely hours: 28
- Meta models, OAuth connection, insights client, hourly and daily pull jobs.

### M8-I03 (COD-72, was MAN-296) Spend to ledger and order campaign tags
- Tasks (2): T07, T08
- Likely hours: 15
- DR 5080 per day at the day rate, UTM capture on public checkout.

### M8-I04 (COD-73, was MAN-297) Mapping and Marketing KPI services
- Tasks (5): T09, T10, T11, T12, T13
- Likely hours: 28
- Name-rule mapping, tiles with max CPA, funnel and campaigns, ad and daily services, marketer permission.

### M8-I05 (COD-74, was MAN-298) Marketing page, funnel and ad drilldown UI
- Tasks (2): T14, T15
- Likely hours: 15
- Marketing page, funnel, ad drilldown, daily chart.

### M8-I06 (COD-75, was MAN-299) Mapping screen, connection card and Reports tab
- Tasks (3): T16, T17, T18
- Likely hours: 16
- Mapping UI, Settings card, Reports Marketing tab, form stats.

### M8-I07 (COD-76, was MAN-300) M8 tests, parity week and close-out
- Tasks (6): T19, T20, T21, T22, T23, T24
- Likely hours: 26
- Fixture parity and job tests, week check against Ads Manager, simplify, checks, browser check, owner review.

M8 total: 7 issues, 24 tasks, 140 h

## M9

### M9-I01 (COD-77, was MAN-301) Messaging schema, provider interface and inbound
- Tasks (6): T01, T02, T03, T04, T05, T06
- Likely hours: 39
- Messaging, inbox and workflow migrations, provider interface, status events, full inbound WhatsApp.

### M9-I02 (COD-78, was MAN-302) Conversations, message log, templates and opt-outs
- Tasks (4): T07, T08, T09, T10
- Likely hours: 27
- Conversations API, overview figures, templates service, opt-outs and unsubscribe.

### M9-I03 (COD-79, was MAN-303) Bulk send, campaigns, scheduled sends
- Tasks (5): T11, T12, T13, T14, T15
- Likely hours: 29
- Audience filters and bulk send, campaigns, scheduled list, tracking APIs, auto-confirm template.

### M9-I04 (COD-80, was MAN-304) Inbox, reminders and threads services
- Tasks (5): T16, T17, T18, T19, T20
- Likely hours: 32
- notify service, feed API, reminders job, comments and mentions, rep and agent inbox.

### M9-I05 (COD-81, was MAN-305) Workflow engine and run history
- Tasks (5): T21, T22, T23, T24, T25
- Likely hours: 37
- Delayed wait, schedule triggers, Assign to action, run history and retry, list API and gallery.

### M9-I06 (COD-82, was MAN-306) Connections page: backends and UI
- Tasks (6): T26, T27, T28, T29, T44, T45
- Likely hours: 36
- Status per card, settings backends, inbound order webhooks, CSV upload card, Connections UI, Webhooks and Activity log.

### M9-I07 (COD-83, was MAN-307) Messages UI
- Tasks (7): T30, T31, T32, T33, T34, T35, T36
- Likely hours: 45
- Conversations, overview and log, bulk send, campaigns, templates, opt-outs, drawer message block.

### M9-I08 (COD-84, was MAN-308) Inbox, notifications and workflow UI
- Tasks (7): T37, T38, T39, T40, T41, T42, T43
- Likely hours: 40
- Inbox UI, bell and sidebar pill, notification settings, rep inbox, workflows list, builder and run history.

### M9-I09 (COD-85, was MAN-309) M9 tests
- Tasks (3): T46, T47, T48
- Likely hours: 20
- Messaging, inbox and workflow engine tests.

### M9-I10 (COD-86, was MAN-310) M9 simplify, checks and owner review
- Tasks (4): T49, T50, T51, T52
- Likely hours: 15
- Simplify, full checks, browser check, owner review.

M9 total: 10 issues, 52 tasks, 320 h

## M10

### M10-I01 (COD-87, was MAN-311) Agent API: foundation, deliveries and state machine
- Tasks (3): T01, T02, T03
- Likely hours: 22
- Auth guard, deliveries list and detail, start, complete and fail through the machine.

### M10-I02 (COD-88, was MAN-312) Agent API: stock, cash, fees, inbox and retiring /m
- Tasks (5): T04, T05, T06, T07, T08
- Likely hours: 26
- Stock and transfer confirm, cash and deposit, fees and rewards, inbox wiring, retire /m routes.

### M10-I03 (COD-89, was MAN-313) Agent app shell and Home
- Tasks (2): T09, T10
- Likely hours: 12
- Five tabs, pause banner, Home page.

### M10-I04 (COD-90, was MAN-314) Deliveries list, detail and action sheets
- Tasks (2): T11, T12
- Likely hours: 16
- List, detail with Call, WhatsApp, Maps; Start, Complete, Report failed sheets.

### M10-I05 (COD-91, was MAN-315) Stock, Cash, Fees, Inbox and More pages
- Tasks (3): T13, T14, T15
- Likely hours: 20
- Stock page and receive sheet, cash page and deposit sheet, fees, inbox and More.

### M10-I06 (COD-92, was MAN-316) Agent app tests and phone e2e
- Tasks (2): T16, T17
- Likely hours: 14
- Permission and state tests, 390 px e2e.

### M10-I07 (COD-93, was MAN-317) M10 simplify, checks and owner review
- Tasks (4): T18, T19, T20, T21
- Likely hours: 13
- Simplify, checks, phone-size browser check, owner review.

M10 total: 7 issues, 21 tasks, 123 h

## M11

### M11-I01 (COD-94, was MAN-318) Model provider check and AI schema
- Tasks (2): T01, T02
- Likely hours: 8
- Provider, price and limits decision; chat and suggestion models.

### M11-I02 (COD-95, was MAN-319) KPI read tools and problem finders
- Tasks (4): T03, T04, T05, T06
- Likely hours: 31
- kpi_get and related tools, finder sets A, B and C.

### M11-I03 (COD-96, was MAN-320) Suggestion service, page insights and order flags
- Tasks (3): T07, T08, T09
- Likely hours: 22
- Ranking and fingerprint, per-page insight endpoints, order flags and explain-this-month.

### M11-I04 (COD-97, was MAN-321) Chat backend, threads and drawer UI
- Tasks (3): T10, T11, T14
- Likely hours: 21
- Model adapter and tool loop, thread API, chat drawer.

### M11-I05 (COD-98, was MAN-322) Suggestion cards, pre-fill and order filters
- Tasks (5): T15, T16, T17, T18, T19
- Likely hours: 32
- Card component, pre-fill handlers, placement, order filters UI.

### M11-I06 (COD-99, was MAN-323) Audit-log screen and guard tests
- Tasks (3): T12, T13, T20
- Likely hours: 17
- Audit-log API and UI, wording and masking guards, injection test.

### M11-I07 (COD-100, was MAN-324) Grounding and safety suite
- Tasks (1): T21
- Likely hours: 8
- Stub-model number check, tenant isolation, hostile-input tests.

### M11-I08 (COD-101, was MAN-325) M11 simplify, checks and owner review
- Tasks (4): T22, T23, T24, T25
- Likely hours: 13
- Simplify, full checks, browser check, owner review.

M11 total: 8 issues, 25 tasks, 152 h

## M12

### M12-I01 (COD-102, was MAN-326) AiAction schema, service and confirmer rules
- Tasks (3): T01, T02, T03
- Likely hours: 18
- AiAction states, propose/confirm/reject/expire, who may confirm.

### M12-I02 (COD-103, was MAN-327) Write tools: reminders, comments, expenses, stock
- Tasks (2): T04, T05
- Likely hours: 13
- Batches 1 and 2 of write tools, each previewed and audited.

### M12-I03 (COD-104, was MAN-328) Write tools: shipments, orders, collections
- Tasks (3): T06, T07, T08
- Likely hours: 19
- Batches 3 to 5 through existing services.

### M12-I04 (COD-105, was MAN-329) Action status tool and workflow draft tool
- Tasks (2): T09, T10
- Likely hours: 12
- ai_action_status, MCP proposal flow, workflow draft from a description.

### M12-I05 (COD-106, was MAN-330) Confirm card UI, direct buttons and write safety suite
- Tasks (3): T11, T12, T13
- Likely hours: 20
- Chat confirm card, C-04 and C-16 direct buttons, injection and stale-preview tests.

### M12-I06 (COD-1, was MAN-331) M12 simplify, checks and owner review
- Tasks (4): T14, T15, T16, T17
- Likely hours: 13
- Simplify, full checks, browser check, owner review.

M12 total: 6 issues, 17 tasks, 95 h

## Check

- Plan tasks in M-files: 458
- Tasks covered by an issue: 458
- Tasks in two issues: 0
- Tasks not covered: 0
- Issues: 106
- Hours covered: 2736

Computed by script from the M-files on 2026-10-19 (`covered == total == 458`, no duplicates).
