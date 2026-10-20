# CodAdmin rebuild: design document

Date: 2026-10-18
Status: reviewed by Opus; waiting for owner approval
Owner: Manny (Manny Dynamics Limited)
Next step after approval: build plan (plan.md step 5)

Owner changes of 2026-10-18 and 2026-10-19 (O1 to O7, in `docs/prd/decisions.md`) override this document where they differ: the Logiswift sync runs outside the app and the app has one generic "record partner payout" action (O1); no Paystack Ghana (O2); the app is country-agnostic and English only (O3); "assign by region" is a Workflow (O4); all money shows in the store currency (O5); the store currency is not locked (O6); no generic partner key, outside agents use the normal API or MCP key (O7). Where a line below conflicts, the line is marked.

How to read this document:
- Sections 1 to 3 say what we build and why.
- Section 4 defines every number once.
- Sections 5 to 8 say how we build it.
- Sections 9 to 11 list risks, the order of work and open questions.
- GUESS means the source did not prove the statement. Check it before you build on it.
- UNVERIFIED means a price or rule came from a source we did not confirm.
- Abbreviations: COD = cash on delivery. 3PL = third-party logistics company. GL = general ledger. MCP = Model Context Protocol (the way outside AI agents call our tools). CPA = cost per order placed. KPI = key performance indicator. CAPI = Meta Conversions API.

---

## 1. Summary

CodAdmin today is a COD order admin. It has orders, stock, delivery agents, call reps, a ledger, checkout forms and a small MCP server.
The owner wants one place to run the whole business. The owner also wants the right numbers in each area, a new design, a team-ready role system and an AI assistant.

We rebuild CodAdmin in this order of purpose:
1. The owner runs their own business on it first (Magic Groove in Ghana, sold by COD, delivered by Logiswift and by delivery agents).
2. Other sellers come later. We keep tenant isolation safe now. We build no seller-facing extras yet.

The rebuild has five parts:
1. **One definition per number.** The audit found four revenue definitions. We keep one. We name three rates and never say "delivery rate" alone.
2. **Money and stock matching.** We reconcile orders against cash against stock. This finds the three losses the owner sees most: staff and agent issues, 3PL short-pays and missing stock.
3. **Roles.** A role is a position contract, a list of allowed tools and a list of KPIs. A person, an AI agent or a company can hold a role.
4. **New design.** We build the approved v2 mockups: an e-commerce admin layout, a light game layer (targets, leaderboards, rewards), a separate call-rep screen and a phone app for delivery agents.
5. **AI assistant.** An in-app chat drawer and page suggestion cards. It reads first. Write actions come later. Chat and MCP use one tool registry.

The business context in one paragraph. The 2026 North Star is GH₵1,800,000 delivered revenue and 35% net margin. In 1 to 17 October 2026 the business placed 1,445 orders, confirmed 71%, delivered 376 and booked GH₵92,000 delivered revenue. Orders run ahead of plan. Delivery success (48% against a 60% target) is why revenue lags.

---

## 2. Goals and non-goals

### Goals
1. Every dashboard number has one formula, one date basis and one owner role (section 4).
2. The owner sees on or off track for the North Star, quarter, month and person every day.
3. Partner payouts (for example Logiswift) reconcile with no hand work. Gross revenue and per-order delivery fees post to the books.
4. Stock has real locations. The owner can find a count gap in one screen.
5. Call reps are tracked by time to first call, confirmation rate and upsell. The success-rate bug is gone.
6. The app has roles that a person, an AI agent or a company can hold, with one audit log.
7. The UI matches the approved v2 mockups.
8. The in-app AI answers number questions and finds problems.

### Non-goals (for this rebuild)
| Item | Why not now |
|---|---|
| Seller SaaS features: signup, billing enforcement, messaging wallet, seller onboarding | Owner decision: run my own business first. Keep tenant isolation safe so we can add them later. |
| A sync screen or sync status for any partner (Logiswift included) | Agents run partner syncs outside the app, on a schedule (O1). The app shows normal data only. |
| Kanban board for orders | Owner removed it in round 2. |
| XP, levels, streaks | Owner removed them. Rewards come only from hitting a target. |
| AI write actions in the first release | Read-only first. Writes come later through the same tool registry. |
| Android tap-to-call | Reps use basic phones. It comes after auto-confirm and the queue timer. |
| Pay-out to AI agents or companies | AI agents and 3PL companies get no payout. |
| Multi-store per login | It sits on unmerged branches. See open question 7. |

---

## 3. Decisions (locked)

Each row is decided. Do not reopen it in review. The reason comes from the owner's brainstorm answer (Q) in `progress.md`.

| # | Decision | Reason (source) |
|---|---|---|
| 1 | The owner runs their own business on CodAdmin first. SaaS signup, billing, messaging wallet and seller onboarding come later. Tenant isolation stays safe. | "Me first, then sell." (Q14) |
| 2 | The app follows E-Myth areas: leadership, marketing, finance and fraud, management and team, lead generation, lead conversion, fulfilment. | Owner intent in plan.md; E-Myth research. |
| 3 | Revenue = delivered order value, dated by delivery date. Three rate names: confirmation rate, delivery success rate (closed orders, target 60%), order-to-cash yield. Max CPA = profit per delivered order before ads × yield. | Four revenue definitions made numbers disagree. (Q15, Q16, KPI review A and B) |
| 4 | A role = position contract + allowed tools + KPIs. A person (app), an AI agent (MCP) or a company (3PL by connector) holds it. AI agents are scored under the role they hold and get no payout. One audit log covers every actor. | "Roles defined as tool sets." (Q13) |
| 5 | Call rep pay = GH₵8 per confirmed order that is delivered, plus a 10% upsell reward paid on delivery. Target reward tiers follow NUMBERS.md. | KPI review C; upsell request (NUMBERS.md). |
| 6 | Reps use basic phones. First: auto-confirm by WhatsApp or SMS, a queue timer and time to first call. Android tap-to-call comes later. Fix the rep success-rate bug. | (Q3, Q4) |
| 7 | (Changed by O1.) Partner syncs run outside the app, on a schedule, run by agents. The app has ONE generic action, "record partner payout" (API and MCP tool), that any agent can call for any partner. It auto-reconciles `AgentCollection` and records the deposit. We book gross revenue and the per-order delivery fee from the Charge column. Fee rules per partner (delivered, failed, returned) live in settings. There is no Logiswift-specific code. | Lump-sum payout minus charges; Logiswift charges nothing on failed or returned orders, others may. (Q5 to Q9) |
| 8 | Stock has real locations (own store, each 3PL, each agent), transfers, periodic counts against the 3PL dashboard, shipment receiving with counted against shipped, and landed cost per unit. | All stock is at Logiswift now. The code has no location model. (Q12) |
| 9 | Fraud = matching orders against cash against stock. Priority: staff and agent issues, 3PL short-pays, missing stock. Fake orders are smaller. | Owner ranked the losses. (Q10, Q11) |
| 10 | AI is an in-app side drawer on every screen plus per-page suggestion cards. First release is read-only: answer numbers and find problems. Actions (add stock, expenses, update orders) come later through the same tool layer, exposed over MCP. | (Q15, plan.md) |
| 11 | CodAdmin pulls Meta ad spend itself through its own Meta connection. A mapping screen links campaigns to products. | Works for future sellers. (Q18) |
| 12 | Full redesign per the approved v2 mockups: high-end SaaS, e-commerce admin layout, light game layer. A separate rep screen (5 pages and inbox). A delivery-agent phone app with inbox. | (Q19, rounds 1 to 3) |
| 13 | Inbox holds notifications, reminders and team-note threads per order, customer, payout and product. Reps and agents get their own inboxes. Customer messages are tracked (sent, delivered, read, failed, replied). | Round 2 approval; rep and agent inbox request. |

---

## 4. KPI dictionary

### 4.1 Rules for every number
1. One name, one formula. A page never invents its own version.
2. Every number states its **date basis**: delivery date, order date (cohort) or payment date.
3. Revenue is **delivered order value by delivery date**. The "orders placed value" and "cash received" numbers have their own names.
4. Rates use these exact names: **confirmation rate**, **delivery success rate**, **order-to-cash yield**. Do not show "delivery rate" or "conversion rate" alone.
5. All money shows in the store currency (O5, O6). An amount in another currency (Meta spend in the ad account's currency, supplier invoices) converts at that day's rate; the original stays on the record, and the rate shows (sample: "₦112 = GH₵1").
6. One service computes each number. The dashboard, reports, MCP tools and AI chat all call it (section 7).

The old "26%" (delivered ÷ all orders, with orders still in flight) is removed as a KPI.

### 4.2 Leadership (owner)
| Name | Formula | Date basis | Target | Owner role |
|---|---|---|---|---|
| North Star revenue | Sum of `totalAmount` of delivered orders | Delivery date | GH₵1,800,000 in 2026 (GH₵180,000 a month) | Owner |
| Net margin | (Delivered revenue − product cost − partner fees − ad spend − other expenses) ÷ delivered revenue | Delivery date | 35% | Owner |
| Quarter and month target | Share of the North Star set per period (Targets screen) | Delivery date | Set in North Star setup | Owner |
| Pace and projection | Revenue so far ÷ days gone × days in month | Delivery date | Projected ≥ month target | Owner |
| Orders needed per day | Month revenue target ÷ AOV ÷ (confirmation target × success target) ÷ days in month | n/a (plan) | 56 a day (180,000 ÷ 249 = 723 delivered; 723 ÷ (0.70 × 0.60) = 1,721 orders; ÷ 31 days in October) | Owner |
| Target attainment | Actual ÷ target, per role and person | Delivery date | 100% | Owner |

Reference values (1 to 17 Oct): delivered revenue GH₵92,000; projected October GH₵164,000 (91%); actual pace 85 orders a day; margin by quarter Q1 11%, Q2 12%, Q3 12%; year to date 12%; October by delivery date about −16% once the commission line is in (formula wins, R1; updated 2026-10-19).

### 4.3 Marketing (marketer role)
| Name | Formula | Date basis | Target | Owner role |
|---|---|---|---|---|
| Ad spend | Sum of Meta spend (ad account currency), shown in the store currency at the stored rate | Spend date | Within max CPA | Marketer |
| CPM | Spend ÷ impressions × 1,000 | Spend date | Watch (₦2,080) | Marketer |
| CTR (link) | Link clicks ÷ impressions | Spend date | Watch (1.5%) | Marketer |
| CPC (link) | Spend ÷ link clicks | Spend date | Watch (₦139) | Marketer |
| Landing page view rate | Landing page views ÷ link clicks | Spend date | Watch (70%) | Marketer |
| Checkout start rate | Checkouts started ÷ landing page views | Spend date | Watch (10%) | Marketer |
| Order rate | Orders ÷ checkouts started | Order date | Watch (34%) | Marketer |
| CPA | Ad spend ÷ orders placed | Order date | Under max CPA (₦5,903 now) | Marketer |
| Hook rate (video) | 3-second views ÷ impressions | Spend date | Watch (20 to 32%) | Marketer |
| Hold rate (video) | ThruPlays ÷ impressions | Spend date | Watch (5 to 10%) | Marketer |
| Frequency | Impressions ÷ reach | Spend date | Watch (1.4 to 2.6) | Marketer |
| Order-to-cash yield | Delivered ÷ orders placed, on order cohorts that have closed | Order date (cohort) | 42% (70% × 60%); now 34% | Marketer and owner |
| Profit per delivered order before ads | Price − landed cost per unit − partner fee | Delivery date | Copybook GH₵185 = ₦20,720 (249 − 30 − 34) | Marketer and finance |
| Max CPA | Profit per delivered order before ads × yield | Order date (cohort) | Moves with yield: ₦7,040 at 34%, ₦8,700 at 42% | Marketer |
| Projected cost per delivered order | Spend ÷ (orders × yield), per campaign, on closed cohorts | Order date (cohort) | Under break-even ₦20,720 | Marketer |
| Actual cost per delivered order | Spend ÷ orders delivered in the period | Delivery date | Label it; not the decision number (₦22,686) | Marketer |

The fixed ₦6,400 CPA ceiling is gone. Max CPA replaces it.

### 4.4 Lead conversion (call-centre manager and call reps)
| Name | Formula | Date basis | Target | Owner role |
|---|---|---|---|---|
| Confirmation rate | Confirmed ÷ orders placed (per rep: confirmed ÷ assigned) | Order date | 70% (now 71%) | Call-centre manager |
| Time to first call | Median of (first call or first contact − order placed) | Order date | Under 15 min (GUESS: the mockup shows 12 min for Adwoa and 2 min for the AI agent; owner sets the target) | Call-centre manager |
| Queue size and oldest wait | Count of `pending_confirmation` orders; age of the oldest | Now | Keep oldest under target wait | Call-centre manager |
| Calls per confirmation | Calls ÷ confirmed orders | Call date | Watch (2.25) | Call-centre manager |
| Delivered from confirmed | Delivered ÷ confirmed, per rep | Order date | Watch (52% Adwoa) | Call-centre manager |
| Upsell rate | Orders with at least one upsell line ÷ confirmed orders | Order date | Watch | Call rep |
| Extra value (upsell) | Sum of value added at confirmation on delivered orders | Delivery date | n/a | Call rep |
| Decline reasons | Share of declined orders by reason (price, prank or mistake, changed mind, bought elsewhere, other) | Order date | Watch | Call-centre manager |
| Rep confirmed target | Confirmed orders that get delivered ÷ role target, counted at month close (P7) | Month | 723 a month across the role (Adwoa 423, Confirm agent 250, Nana 50) | Call-centre manager |

Removed: "confirmed per call %".
Fixed: the rep success rate. It must count delivered orders whatever the commission state. Today it counts only delivered orders with `commissionPaid = false` (`repPerformanceService.ts`, lines 110 to 117), so it falls after a payout.

### 4.5 Fulfilment (fulfilment lead)
| Name | Formula | Date basis | Target | Owner role |
|---|---|---|---|---|
| Delivery success rate | Delivered ÷ (delivered + failed + returned), closed orders only | Order date (cohort) or delivery date; label which | 60% (now 48%) | Fulfilment lead |
| Waiting to dispatch | Count and oldest age of confirmed orders not dispatched | Now | Keep oldest short (100 orders, 3 days now) | Fulfilment lead |
| Confirmed to dispatched | Median days from confirmed to dispatched, per partner | Dispatch date | Watch | Fulfilment lead |
| Dispatched to delivered | Median days from dispatched to delivered, per partner | Delivery date | Watch | Fulfilment lead |
| Failed and returned by reason | Count by reason | Close date | Watch | Fulfilment lead |
| Returned units missing | Units sent back by the 3PL − units we received | Return date | 0 | Fulfilment lead |
| Stock gap per location | System quantity − counted quantity | Count date | 0 | Fulfilment lead |

### 4.6 Finance and fraud (finance clerk)
| Name | Formula | Date basis | Target | Owner role |
|---|---|---|---|---|
| Delivered revenue | Same as North Star revenue | Delivery date | See leadership | Finance |
| Orders placed value | Sum of `totalAmount` of orders placed (not cancelled) | Order date | Info only | Finance |
| Cash received | Sum of recorded deposits and settlements | Payment date | Info only | Finance |
| Cash held by partner | Collected by agent or 3PL − deposited, per partner | Now | Watch | Finance |
| Unpaid delivered orders by age | Delivered orders with no deposit, bucketed by days since delivery | Now | None aged past the partner's days-to-pay | Finance |
| Profit per delivered order | (Revenue − product cost − fees) ÷ delivered orders, by product | Delivery date | Positive after ads (now −GH₵38 overall, after rep commission) | Finance |
| Cohort profit | Projected delivered revenue − cost − fees − ads for an order cohort | Order date (cohort) | Positive (October cohort GH₵9.9k, 8%) | Finance and owner |
| Cost of failed deliveries | Fees on failed orders + returned units lost × landed cost | Close date | Watch (GH₵610 in October) | Finance |
| Cash runway | Cash ÷ daily ad spend | Now | Watch (GH₵41.9k ÷ GH₵4,500 ≈ 9 days) | Owner |
| Payout short | Expected payout − received payout, per partner settlement | Payment date | 0 | Finance |
| Partner fee expense | Sum of per-order fees from the Charge column or fee rules | Delivery date | Watch | Finance |
| Commissions payable | Earned and unpaid rep pay (GL 2100) | Now | Watch (GH₵2,168) | Finance |

Fraud checks (all are matches; each opens a Finding, section 5.3):
| Check | Match | Priority |
|---|---|---|
| Staff or agent cash gap | Delivered by agent − deposited by agent | 1 |
| 3PL short-pay | Delivered by 3PL − fees − payout received | 1 |
| Missing stock | System stock − counted stock, by location; returned units sent − received | 1 |
| Delivered with no cash after the partner's days-to-pay | Delivered, no deposit | 1 |
| Fake or prank orders | Repeat refusers, "prank or ordered by mistake" decline reason, duplicate phones | 2 |

### 4.7 Management and team (owner)
| Name | Formula | Date basis | Target | Owner role |
|---|---|---|---|---|
| Rep commission | GH₵8 × orders confirmed by the rep that are delivered | Delivery date | Pay rule | Owner |
| Upsell reward | 10% × extra value the rep added, paid only when delivered | Delivery date | Pay rule | Owner |
| Delivery agent fee (people only) | Fee rule per partner, kept from the cash the agent collects (Kofi GH₵25 per delivered order) | Delivery date | Fee rule | Owner |
| Partner fee | Fee the 3PL keeps per outcome (a fee rule); not agent pay. Label both clearly. | Delivery date | n/a | Owner |
| Target reward tier | Attainment 100% and 120% of the role target (cash tiers only, D9) | Month | Call rep: GH₵300, GH₵500 + paid day off. Delivery: GH₵250, GH₵400 + paid day off. Companies and AI agents: no payout. | Owner |
| Leaderboard | Rank by % of target, per role. AI agents rank only under the role they hold. | Month | n/a | Owner |

Source note: the call-rep tiers come from NUMBERS.md ("unchanged"). The delivery tiers come from DESIGN-SPEC.md round 2. See open question 9.

---

## 5. Architecture

### 5.1 Current state (from the audit)
| Layer | Today |
|---|---|
| Stack | React 18 + Vite + TypeScript + Zustand + Tailwind (frontend). Node 20 + Express + Prisma 5 + PostgreSQL (backend). Redis with Bull queues. socket.io. |
| Tenancy | Shared database. A Prisma extension adds `tenantId` from AsyncLocalStorage to 24 listed models. It lets queries through when there is no tenant context. |
| Auth and roles | JWT with a tenant claim. Seven fixed roles in the `UserRole` enum. Permissions per role in `SystemConfig.rolePermissions`. |
| Money | Orders, products, expenses, payouts: `Float`. General ledger, agent balances, collections, shipments: `Decimal`. |
| Ledger | Chart of accounts, journal entries, auto-posting on delivery, failed delivery, return, expense, deposit, inventory purchase and payout. |
| Cash chain | `AgentCollection` (draft, verified, approved, deposited, reconciled) and `AgentDeposit`. Logiswift is set up as a delivery agent. |
| Stock | `Product.stockQuantity` (warehouse, raw overwrite) and `AgentStock` with an `InventoryTransfer` ledger. No location model. |
| MCP | 14 tools, one write tool (`orders_update_status`). MCP calls carry no user identity. |
| Messaging | Arkesel SMS, WhatsApp (Meta Cloud API), email (SendGrid, Resend, SMTP). `MessageLog` tracks status. |
| Logiswift | An outside script (run by an agent, not part of this repo) syncs order status only today. It has no payout data. After O1 it may call the generic payout action. |

Git state, checked with git (not from the audit text): `develop` equals `main` (PR #300 and #301 merged). The MAN-56 order state machine exists only on a local, unpushed branch, five months old. The multi-store work sits on unmerged `origin/feature/multi-store-*` branches. The checked-out branch is `fix/checkout-field-mapping-and-archived-customers`.

### 5.2 Target architecture
```
Screens (v2 design)  ---->  API controllers  ---->  Services (one per area)  ---->  Prisma (tenant-scoped)
Chat drawer / suggestions                              ^                                 ^
MCP clients (outside agents)  ---->  Tool registry ----+                      Meta connector; outside agents
```
Rules:
1. **Services own the logic.** Controllers only call services. Business logic that now sits in controllers (`shipmentController.ts`, stock in `productController.ts`) moves to services.
2. **One KPI service per area.** It is the only place that computes a number from section 4. Dashboard, reports, chat and MCP call it.
3. **One tool registry.** A tool has a name, a schema, a service call, a required role permission and a read or write flag (section 7).
4. **Every write goes through a service that posts its own side effects** (ledger, stock, history). Workflow actions `update_order` and `assign_agent` must stop writing with raw `prisma.order.update`.
5. **Every actor has a user row.** A person, an AI agent (a per-tenant service user) and a company (a user row of kind `company`) can all be an actor in the audit log.
6. **Every new model has a required `tenantId` and is in the tenant-scoped list.**
7. **Money in new models is `Decimal(19,4)`.**

### 5.3 Data model changes
Current names come from `backend/prisma/schema.prisma`. "New" means no model exists today.

#### New models
| Model | Change | Why |
|---|---|---|
| `StockLocation` | New. Fields: type (`own_store`, `partner_3pl`, `agent`, `in_transit`), name, linked `User` (the agent or 3PL), active. | The code has no location model. Logiswift is an agent row today. |
| `StockLevel` | New. Location + product + quantity, unique per pair. Replaces `AgentStock` and the warehouse number in `Product.stockQuantity`. `Product.stockQuantity` becomes the sum over locations. | One place for stock per location. Backfill from `AgentStock` and `Product.stockQuantity`. |
| `StockCount`, `StockCountLine` | New. A count at a location: date, source (own count or 3PL dashboard), counted by. Lines: product, system quantity, counted quantity, difference. | Periodic count against the 3PL dashboard (decision 8). |
| `FeeRule` | New. Partner (`User`), outcome (`delivered`, `failed`, `returned`), amount (flat or percent), valid from. | Fee rules per 3PL; Logiswift charges nothing on failed or returned orders (decision 7). |
| `PartnerSettlement`, `PartnerSettlementLine` | New. A lump-sum payment from a partner: date, gross, fees, net, linked `AgentDeposit`, status. Lines: order, linked `AgentCollection`, order amount, charge, outcome, matched or not. | Auto-reconcile collections and record the deposit; book the fee per order (decision 7). |
| `Finding` | New. Type (cash gap, short-pay, stock gap, unpaid after term, repeat refuser), subject (partner, user, location, order), amount, status (open, explained, written off), assignee. | Fraud is matching; the owner needs a list to work through (decision 9). |
| `Role` | New. Tenant-defined role: name, area, position contract (results, accountabilities, standards), allowed tools, KPI list. | Roles are contracts + tools + KPIs (decision 4). |
| `RoleAssignment` | New. Role + holder (`User`) + from and to dates. | A role has one or more holders over time. |
| `Target` | New. Scope (`north_star`, `quarter`, `month`, `role`, `person`), metric, period, value, parent target, unit. | North Star year to quarter to month to person (decision 3 and Q17). |
| `RewardTier` | New. Role, attainment threshold (80, 100, 120), reward text and amount, or "none" for companies and AI agents. | Target rewards (decision 5). |
| `CommissionEntry` | New. Order, user, kind (`base`, `upsell`), amount, status (`pending`, `earned`, `paid`, `void`), earned on delivery, link to `Payout`. | Replaces `User.commissionAmount` and `Order.commissionPaid` as the pay ledger. GH₵8 per confirmed order delivered. |
| `UpsellLine` | New. Order, rep, kind (`more_units`, `higher_package`, `add_on`), value added, added at. | 10% upsell reward and upsell rate. |
| `Reminder` | New. Subject (order, customer, payout, product, free), text, due at, created by, for user, done at. | Reminders in the inbox (decision 13). |
| `Thread`, `Comment` | New. A thread belongs to one subject (order, customer, payout, product). Comments have author, text, @mentions, parent comment. | Team notes per subject (decision 13). |
| `MessageEvent` | New. Message log id, event (`sent`, `delivered`, `read`, `failed`, `replied`), time, raw provider data. | Full message tracking history (decision 13). |
| `MetaConnection` | New. Ad account, token (encrypted), status. | CodAdmin pulls its own spend (decision 11). Reuse `metaOAuthService.ts`. |
| `MetaSpendDay` | New. Campaign, ad (optional), date, spend (₦), impressions, reach, link clicks, landing page views, checkouts started, 3-second views, ThruPlays. | Marketing funnel and hook and hold rates. |
| `MetaCampaignMapping` | New. Campaign or name rule + product. Unmapped campaigns show as "Not mapped". | Campaign to product mapping screen (decision 11). |
| `FxRate` | New. From, to, rate, valid from. Start with ₦112 = GH₵1. | Spend in ₦, revenue in GH₵. |
| `AiAction` | New. Actor, tool name, input, preview, status (`proposed`, `confirmed`, `done`, `rejected`), confirmed by. | Confirm step for write tools (section 7). |
| `ChatThread`, `ChatMessage` | New. A chat per user, messages with tool calls shown. | In-app AI drawer (decision 10). |

#### Changed models
| Model | Change | Why |
|---|---|---|
| `User` | Add `kind` (`person`, `ai_agent`, `company`). No delivery pay rate on `User`: the delivery fee lives in one fee rule per partner (F1–F4). Keep `UserRole` as the base permission set. Stop using `commissionAmount`. | Roles can be held by a person, an AI agent or a company. Audit found AI actions need a service-user id. |
| `Order` | Add `confirmedAt`, `dispatchedAt`, `firstContactAt`, `declineReason`, `deliveryFee` (Decimal), `landedCostTotal` (Decimal). Keep `deliveryDate` as the revenue date. Stop using `commissionPaid`. | Time to first call, confirmed to dispatched, decline reasons, per-order fee and cost (section 4). Backfill timestamps from `OrderHistory`. |
| `Call` | Add `tenantId`, `startedAt`, `source` (`manual`, `auto_confirm`, `tap_to_call`), `declineReason`. Extend `CallOutcome` (add `not_reachable`, `declined`). | `Call` has no `tenantId` today. Source and time are needed for time to first call. |
| `AgentCollection` | Add `tenantId`. Add `settlementLineId`. Add automatic transition to `reconciled` from a settlement. | Today nothing reconciles Logiswift collections, so aging is inflated (1,321 collections all in draft, GH₵200k "critical"). |
| `AgentDeposit` | Add `tenantId`. Add `settlementId`. | Link a lump-sum payout to the orders it paid. |
| `AgentAgingBucket`, `Payout`, `OrderHistory`, `AuditLog`, `WebhookLog`, `SmsTemplate`, `DownloadToken`, `FormSubmission`, `product_cost_entries` | Add `tenantId` and add to the scoped list. Make `SmsTemplate.name` and `Product.sku` unique per tenant. | The audit found 12 models without `tenantId`. Fail-open isolation is a risk before any second tenant. |
| `PendingCheckout`, `WebhookEvent` | Add to the tenant-scoped list (they have the column). | Same. |
| `Account`, `JournalEntry` | Make `Account.code` and `JournalEntry.entryNumber` unique per tenant. Seed a chart per tenant. | The audit found a global unique chart. Safe now with one tenant; unsafe for a second. |
| `InventoryShipment` | Add `receivedAt`, `receivedById`, `quantityCounted`, `shortQuantity`, `destinationLocationId`. Landed cost per unit = (unit cost × shipped + shipping + customs + other) ÷ counted. | Receiving with counted against shipped (decision 8). Example: the 9 Oct shipment, 300 shipped, 288 counted, 12 short. |
| `InventoryTransfer` | Add `fromLocationId`, `toLocationId`, `status` (`in_transit`, `received`, `disputed`), `receivedAt`, `receivedById`. | Agent confirms receipt of incoming stock. |
| `MessageLog` | Add `replied` to `MessageStatus`. Link events. | Reply tracking. |
| `Notification` | Add `subjectType`, `subjectId`, `actorId`, `snoozedUntil`. Support a role inbox. | Inbox for notifications, per-role inboxes. |
| `AuditLog` | Add `actorKind`, `channel` (`app`, `chat`, `mcp`, `connector`, `system`), `roleId`, `before`, `after`, `aiActionId`. | One audit log for all actors (decision 4). |
| `McpApiKey` | Add `userId` (the AI agent's service user) and `roleId`. | MCP calls carry no identity today. |
| `Expense` | Add `source` (`manual`, `meta`, `partner_fee`, `ai`). Money to `Decimal`. | Ad spend and partner fees post as expenses. |
| `SystemConfig` | Add days-to-pay per partner defaults, queue wait target. Move provider JSON to connection records later. | Settings in the mockups. |

Money type. The Float to Decimal change for `Order`, `Product`, `Expense` and `Payout` is a risk on its own (section 9). New models use Decimal. Converting old columns is open question 4.

### 5.4 Revenue and the ledger
Today the dashboard reads GL account 4010 by journal `entryDate`. Sales trends read all `totalAmount` including cancelled. Profit margins read delivered orders windowed by `updatedAt`. Product performance reads line totals for every status.

Target: one revenue number, computed from orders (`status = delivered`, `deliveryDate` in range). The ledger posts revenue with `entryDate = deliveryDate`. A nightly check compares the order total with GL 4010 for each day and raises a Finding if they differ.
GUESS: today's 4010 `entryDate` is the time of posting, not `deliveryDate`. Check `glAutomationService.ts` before the reconcile milestone.

---

## 6. Screen map

The mockups are in `docs/mockups/v2/` (17 HTML files; `index.html` holds five views, `rep.html` holds five pages plus an inbox, so the owner counts about 20 screens). All use `app.css`.
"Existing page" is the current page in `frontend/src/pages`. "New" means no current page.

| Mockup screen | What it shows | Data and services | Existing or new |
|---|---|---|---|
| Dashboard (`index.html`) | North Star with margin, month pace, driver tiles, on or off track, agent suggestion cards | KPI service (leadership), `Target`, order and finance services | Replaces `DynamicDashboard` |
| Orders (`index.html`) | Order table with Agent column, filters, bulk and per-row assign (rep or delivery agent), no Kanban | `orderService`, `assignmentService`, `bulkOrderController` | Replaces `Orders` (drop Kanban view) |
| Targets (`index.html`) | Collapsible roles, North Star to quarter to month to person, on and off track | `Target`, `RewardTier`, KPI service | New |
| Leaderboard (`index.html`) | Role leaderboards (call reps, delivery), Upsell tab, rewards. AI agents shown under their role. | `Target`, `CommissionEntry`, `RoleAssignment` | New |
| North Star setup (`index.html`) | Set annual North Star, shows orders needed per day (58) | `Target`, KPI service | New (also in Settings) |
| Products (`products.html`) | Catalog, stock, incoming shipments, Add shipment, Receive shipment (received at, counted, short), allocate, transfer, return, adjust, digital file | `productController`, new `shipmentService`, `StockLevel`, `InventoryShipment`, `InventoryTransfer` | Replaces `Products`, `ProductForm` |
| Inventory and stock (`inventory.html`) | Stock by location, transfer history, adjust, allocate | `StockLocation`, `StockLevel`, `StockCount`, `agentInventoryService` | Replaces `AgentInventoryManagement` |
| Customers (`customers.html`) | List with segments (first-time, repeat, refused before, not reachable) | `customerService`, `MessageLog`, `Call` | Replaces `Customers`, `CustomerDetails` |
| Checkout forms (`checkout-forms.html`) | Editor tabs: Basics, Fields, Packages, Upsells, Design, Payment, Tracking | `checkoutFormService`, `FormPackage`, `FormUpsell` | Replaces `CheckoutForms`, `CheckoutFormEditor` (reskin; logic stays) |
| Messages (`messages.html`) | Conversations, templates, campaigns, bulk send, opt-outs, status per message | `communicationService`, `MessageLog`, `MessageEvent` | Replaces `Communications` |
| Deliveries (`deliveries.html`) | Delivery partners (agents and 3PLs), success rate, days, fee rules, failed and returned by reason, returns missing | KPI service (fulfilment), `FeeRule`, `deliveryService` | Replaces `DeliveryAgents` |
| Finance (`finance.html`) | Overview, collections to verify, aging, unpaid delivered, payout reconciliation, expenses, accounting (chart, journals, statements), forecast, rep commissions and payouts, cohort profit, cost of failed deliveries, cash runway | `financialService`, `agentReconciliationService`, `PartnerSettlement`, `CommissionEntry`, `Finding` | Replaces `Financial` |
| Marketing (`marketing.html`) | Funnel per campaign, spend against orders, max CPA, ad drilldown with hook and hold, mapping status | `MetaSpendDay`, `MetaCampaignMapping`, KPI service (marketing) | New |
| Reports (`reports.html`) | Tabs: Overview, Sales, Marketing, Delivery, Team, Products. Export. | KPI services, export helper | Replaces `Analytics` |
| Staff and roles (`staff.html`) | People, agents, companies; roles with contracts, tools and KPIs; pay and reward rules; payout history; invite; call-rep view; phone view | `Role`, `RoleAssignment`, `User.kind`, `RewardTier`, `Payout` | Replaces user management and `CustomerReps` |
| Workflows (`workflows.html`) | Workflow list, auto-assign by region | `workflowService` | Replaces `Workflows` (restyle; "By region" is new, see open question 3) |
| Connections (`connections.html`) | Integrations: Arkesel, WhatsApp, email, Paystack, webhooks (order import), MCP keys, Meta Ads; field mapping and logs | `webhookService`, `McpApiKey`, `MetaConnection` | Replaces `Webhooks` and the Settings integrations tab. No sync status for any partner (O1). |
| Settings (`settings.html`) | Profile, security, business, order statuses, currencies and FX, North Star and targets, rewards, billing and plans, notifications | `SystemConfig`, `FxRate`, `Target`, `RewardTier` | Replaces `Settings` |
| Inbox (`inbox.html`) | Notifications, reminders, team threads, @mentions, set reminder | `Notification`, `Reminder`, `Thread`, `Comment` | New |
| Rep screen (`rep.html`) five pages | Today, Queue, My orders, Earnings, My numbers, plus inbox. Call card, outcomes, upsell panel. Sidebar on desktop, bottom tabs on phone. | `callService`, `UpsellLine`, `CommissionEntry`, KPI service (conversion) | New. Replaces `EarningsHistory` |
| Delivery agent app (`agent.html`) | Phone app: home, deliveries, detail, complete or report failed, stock (incoming, confirm received), cash and deposit, history, inbox, language | `deliveryService`, `InventoryTransfer` status, `AgentDeposit`, `Notification` | Replaces `/m` pages. Open question 1 (language). |
| Shell | Sidebar groups (Sell, Stock, Money, Team, Setup, Inbox), top bar, bell to inbox, AI drawer, command palette, dark mode, sample-data pill | Layout components | Replaces `Layout` |

Platform admin pages (`/platform`) are out of scope for the redesign. They stay as they are.

---

## 7. AI and MCP tool layer

### 7.1 One registry
A tool is defined once:
```
name, description, input schema (zod), handler (calls a service),
kind: read | write, required permission, role scope, confirm: none | preview
```
- The in-app chat drawer, the page suggestion cards and the MCP server all read this registry.
- A tool never holds business logic. It calls a service method. The service is the same one the screens use.
- Each tool call runs inside `tenantStorage` for the caller's tenant, as the 14 MCP tools do today.

### 7.2 Identity and audit
The audit found MCP calls have no user identity. Fix it:
1. Each AI agent has a service `User` (`kind = ai_agent`) and holds a role through `RoleAssignment`.
2. A `McpApiKey` points to that user and role.
3. The in-app chat acts as the logged-in person, with that person's permissions.
4. Every call writes an `AuditLog` row: actor, actor kind, channel (`chat` or `mcp`), tool, input, result and (for writes) before and after.
5. A role limits which tools a holder can call. The tool list in the `Role` record is the allow-list.
6. The MCP rate limiter becomes per key and per tenant. Today it is one shared bucket.

### 7.3 Read tools first
| Group | Tools | Notes |
|---|---|---|
| Existing (14) | `orders_search`, `orders_summary`, `analytics_daily`, `analytics_weekly`, `analytics_monthly`, `agents_status`, `agents_performance`, `deliveries_active`, `customers_lookup`, `products_inventory`, `financial_summary`, `reps_status`, `reps_performance`, plus the write tool `orders_update_status` | Rebuild the analytics and financial tools on the KPI services. They have separate logic today (GUESS: they may not match the dashboard). |
| New KPI tools | `kpi_get(name, period)`, `north_star_status`, `targets_status(role or person)`, `marketing_funnel(campaign)`, `max_cpa(campaign)` | Same formulas as section 4. |
| New problem finders | `findings_list`, `cash_gaps_by_partner`, `stock_gaps_by_location`, `slow_queue`, `unmapped_campaigns`, `orders_waiting_to_dispatch` | These power the suggestion cards and "find problems". |

Suggestion cards: each page asks the problem finders for 1 to 3 items and shows them. A card offers one click. In release one the click opens the right screen. It does not write.

### 7.4 Write tools later
| Tool | Service it calls | Gap to close first |
|---|---|---|
| `expense_add` | `financialService.recordExpense` | Needs an actor user (the AI service user). |
| `stock_adjust`, `stock_transfer`, `stock_allocate` | `agentInventoryService` (on `StockLevel` after the location change) | No warehouse movement ledger exists. The raw `PATCH /products/:id/stock` overwrite must go. |
| `shipment_create`, `shipment_receive` | New `shipmentService` | Logic sits in `shipmentController.ts`. |
| `order_update` | `orderService.updateOrder` | Workflow actions bypass it today. |
| `collection_verify`, `deposit_create` | `agentReconciliationService` | Role and approval rules. |
| `reminder_create`, `comment_add` | New services | None. |

Write flow:
1. The tool returns a preview (`AiAction` with status `proposed`).
2. A person confirms in the app (or an allowed role auto-approves a safe tool).
3. The service runs. The audit log records before and after.
4. Money tools (expense, deposit, payout) always need a person to confirm. An AI agent never approves its own money action.

---

## 8. Integrations

### 8.1 Partner payouts (changed by O1)
A 3PL pays a lump sum equal to collected cash minus its charges (sample: Logiswift, which charges nothing on failed or returned orders). Agents run the partner syncs outside the app, on a schedule. The app does not run a sync, does not read a partner portal and has no Logiswift-specific code or endpoint.

The app has ONE generic action, "record partner payout" (an API route and an MCP tool). Any agent can call it for any delivery partner:
1. The caller sends the paid-order list (with the Exp Amount and Charge per order) and the payout (date, total, reference).
2. The service creates a `PartnerSettlement` with lines. It is idempotent on (partner, reference).
3. The service matches each line to an order and its `AgentCollection`. Matched collections move to `reconciled`. It records one `AgentDeposit` for the net amount.
4. It books, per order: gross revenue as usual, and the delivery fee as an expense taken from the Charge column. Deposit = collections − fees.
5. Lines that do not match, or a payout that does not equal the sum of its lines, open a `Finding` ("3PL short-pay").
6. Fee rules in settings (`FeeRule`) price orders whose Charge is missing, and they set the expected fee for other 3PLs.
7. The app shows settlements, findings and unpaid orders. It shows no sync controls or sync status.

Outside agents call it with the normal API or MCP key that holds the payout permission (O7: there is no partner key). The same shape serves the trial 3PL (Kasapa Express) and later partners.

### 8.2 Meta ad spend
1. CodAdmin has its own Meta connection (`MetaConnection`), using the OAuth code in `metaOAuthService.ts` (built for WhatsApp today). Required scopes and App Review are not checked. Check them before the milestone.
2. A daily job (Bull queue) pulls campaign and ad insights into `MetaSpendDay`: spend, impressions, reach, link clicks, landing page views, checkouts started, 3-second views, ThruPlays.
3. A mapping screen assigns campaigns to products by name rule or by pick. "Not mapped" campaigns show on the Marketing page and in a suggestion card.
4. Spend posts to the ledger as an expense (MAN-49 and MAN-50 in Linear describe earlier drafts; both are stale since March).
5. Meta's rate limits and the attribution window are not checked (UNVERIFIED).
6. The Meta CAPI code for checkout is separate and stays.

### 8.3 Messaging
Use: auto-confirm by WhatsApp or SMS, queue reminders, delivery notices, customer replies.
Today: Arkesel for SMS, Meta Cloud API for WhatsApp, `MessageLog` for status.

Provider research (`messaging-providers.md`, seen 2026-10-17, pass 2). Treat all prices as UNVERIFIED until re-read before a decision:
| Item | Finding | Status |
|---|---|---|
| Twilio SMS | Nigeria $0.3868 per segment; Ghana $0.3741 per segment (Twilio pages) | Confirmed on Twilio pages. Note: the NG figure may be the international route. An aggregator lists Twilio Ghana at $0.03065, ten times lower. CONFLICT; read the Twilio CSV. |
| Plivo SMS Nigeria | MTN $0.2729, Airtel $0.4165, Glo $0.5423, other $0.3199 | Confirmed on Plivo page |
| Hubtel Ghana SMS | GH₵0.033 per SMS; bundles down to about GH₵0.016 | The two Hubtel pages disagree |
| WhatsApp via Twilio | $0.005 Twilio fee + Meta fee (shown $0.0034 for utility) | A secondary source gives Nigeria utility $0.01 and marketing $0.06 (older card). CONFLICT. Meta's rate card (1 July 2026) values were not retrieved. |
| Who pays Meta under a Tech Provider | Unknown | UNVERIFIED |
| Per-seller WhatsApp | Twilio Tech Provider: 3 to 4 weeks approval | Confirmed on Twilio page. Only needed for seller SaaS. |
| Africa's Talking | Nigeria sender ID free, about 1 working day. Voice NGN 15 per minute outgoing. SMS prices not found. | Pricing page returned 403; voice page 3 years old |
| Sender ID rules | Nigeria: per-network registration (MTN strictest), days to 3 weeks. Ghana: NCA registration. | UNVERIFIED (blog source) |
| Arkesel, mNotify, Termii | Prices not retrieved | Open |

Decisions for this rebuild:
- Keep Arkesel (SMS) and the Meta Cloud API (WhatsApp) for the owner's business. A WhatsApp utility message costs about 2% of a Twilio SMS to NG or GH, so WhatsApp is the first channel for auto-confirm.
- Build a provider interface (`send`, `status webhook`, `inbound`) so a second provider can be added.
- The messaging wallet, top-up and per-seller WhatsApp onboarding are part of seller SaaS (non-goal now).
- Voice and tap-to-call are not in release one.

### 8.4 Paystack
Paystack already handles buyer checkout (deposit or full pay), webhooks with idempotency, and subscriptions.
- Keep it as is. Remove the legacy handler past its 2026-09-01 sunset date (`paystackController.ts:118`) in the correctness milestone.
- The mockups say Paystack is Nigeria-only in the current app. Open question 3.
- Subscription enforcement (MAN-69, MAN-70) belongs to seller SaaS, not this rebuild.

### 8.5 Arkesel
Arkesel stays the SMS provider (`smsService.ts`). Put it behind the provider interface. Check its delivery receipts feed `MessageEvent`. Prices UNVERIFIED.

---

## 9. Data correctness and migration risks

| # | Risk | Evidence | What we do |
|---|---|---|---|
| 1 | Four revenue definitions | GL 4010 (dashboard, finance); sum of `totalAmount` with cancelled (sales trends); delivered-only by `updatedAt` (profit margins); line revenue for all statuses (product performance) | One definition (section 4). Retire the other three. Add tests that every revenue endpoint agrees on one fixture. |
| 2 | Delivery rate mixes cohorts | Numerator by `deliveryDate`, denominator by `createdAt` (`analyticsService.ts` 86 to 88 and 241) | Replace with the three named rates. |
| 3 | Rep success-rate bug | `repPerformanceService.ts` 110 to 117 counts only delivered and commission-unpaid orders | Compute from order status. Pay state does not matter. |
| 4 | Branch state | Audit says the tree has no `statusVersion` or multi-store model. Git check: `develop` equals `main`; MAN-56 only on a local branch; multi-store on unmerged remote branches | Treat `develop` as the baseline. Decide on MAN-56 and multi-store before milestone 0 (open question 7). |
| 5 | Empty migration placeholders | Three 20260218 migrations contain one comment line ("applied directly to DB"). GUESS: applied to production by hand. | Diff a production `pg_dump` against the repo. Write real SQL or delete the folders. This blocks safe new migrations. A fresh database built by `migrate deploy` skips these objects. |
| 6 | Prod migration drift | Memory notes record 11 pending additive migrations; `deploy-staging.sh` tolerates a failed `migrate deploy` | Apply them on staging first. Make the deploy script fail on a failed migration. |
| 7 | NULL `tenant_id` rows hidden | Startup seeding creates GL accounts with `tenant_id = NULL`; the tenant extension then hides them | Backfill, add a not-null rule where safe, and seed a chart per tenant. Test with two tenants. |
| 8 | Fail-open tenant isolation | The extension lets queries through without a context (cron, queues, public routes); 12 models lack `tenantId`; `agingService.refreshAll` is global and runs `deleteMany({})` | Add `tenantId` and scope them. Make queues and crons set a tenant context. Make `refreshAll` per tenant. |
| 9 | Money type split | Float on orders, products, expenses, payouts; Decimal in the ledger. The "decimal migration" never changed the schema. | New models use Decimal. Open question 4 for old columns. |
| 10 | Aging inflated | 1,321 Logiswift collections all in draft. Aging counts all non-reconciled. The GH₵200k "critical" is likely unreconciled, not unpaid. GUESS: not checked against Logiswift payments. | The settlement reconcile fixes it. The first run is a backfill of the draft collections from app data (no portal export, O1). |
| 11 | Workflow engine bypass | `update_order` and `assign_agent` skip `orderService`, so skip GL, inventory and history. `http_request` is a mock. | Route them through services before AI or auto-confirm uses workflows. |
| 12 | No warehouse stock ledger | `PATCH /products/:id/stock` overwrites the number | Replace with `StockLevel` and movements. |
| 13 | Cash position may double count | `getCashFlowReport` adds in-transit, receivables and expected (GUESS) | Review the formula when building the Finance page. |
| 14 | Digital and Paystack fees outside the summary | `getFinancialSummary` seems to leave out digital revenue (4020) and Paystack fees (5060) (GUESS) | Include them or state the exclusion in the KPI. |
| 15 | MCP details | The audit says 13 tools; the fact-check counted 14. The schema resource is stale. | Use 14. Rebuild the schema resource from the real models. |
| 16 | Low test coverage | Backend gate lines 37%, branches 25%; MCP read tools untested; most pages untested | Every KPI service and tool gets tests. Whether the suites pass today is unknown (not run). |
| 17 | Product cost conflict | Mockup products page used GH₵86 landed cost; NUMBERS.md used GH₵40; owner set GH₵30 per set on 18 Oct | Use GH₵30. Compute landed cost from shipments (decision 8), not a typed number. |
| 18 | Doc rot | `CLAUDE.md` names Shadcn and `WorkflowEditor`; the code uses hand-written UI and `WorkflowWizard` | Fix `CLAUDE.md` in milestone 0. |

---

## 10. Suggested milestone order

This is rough. The real plan comes in step 5. One pull request per milestone.

| # | Milestone | Content | Done when |
|---|---|---|---|
| M0 | Correctness base | Pick baseline branch. Migration diff against production. Tenant fixes (section 9, items 5 to 8). Failed-migration deploy guard. Remove legacy Paystack handler. Fix `CLAUDE.md`. | Two-tenant isolation tests pass. `migrate deploy` builds the same schema as production. |
| M1 | KPI definitions | KPI services for every number in section 4. One revenue definition. Three rates. Rep success-rate fix. Order timestamps and backfill. `FxRate`. Tests on a fixed data set. | All old revenue endpoints return one answer. Numbers match NUMBERS.md on a fixture. |
| M2 | Tool registry and audit | Registry, actor identity, audit log changes, per-key rate limit. Move the 14 MCP tools onto it. | Every MCP call has an actor in the audit log. |
| M3 | Design shell | Tokens from `app.css`, layout, sidebar groups, top bar, command palette, dark mode, shared components. Dashboard on live KPI services. | Dashboard shows live numbers in the new shell. |
| M4 | Stock and fulfilment | Locations, levels, counts, shipment receiving, landed cost, transfers with agent receipt. Products, Inventory and Deliveries pages. | The 9 Oct shipment shows 288 counted and 12 short. Stock gap per location shows. |
| M5 | Settlement and finance | Fee rules, the generic record-partner-payout action, auto-reconcile, deposit, fee expense. Finance page. Findings. Backfill reconcile. | Aging reflects true unpaid orders. A partner payout recorded by an outside agent reconciles with no hand step. |
| M6 | Roles, targets, rewards | `Role`, assignments, `Target`, `RewardTier`, North Star setup, Targets, Leaderboard, Staff page. | Targets show on or off track per role and person. |
| M7 | Lead conversion | Rep screen (5 pages), call card, `UpsellLine`, `CommissionEntry`, GH₵8 plus 10% rule, auto-confirm message, queue timer, time to first call. | A rep earns and sees GH₵8 per delivered order and the upsell reward. |
| M8 | Marketing | Meta connection, daily pull, mapping screen, funnel, max CPA, ad drilldown. | Spend and funnel match Ads Manager for a test week. |
| M9 | Inbox and messages | Notifications, reminders, threads, rep and agent inboxes, message events, reply tracking. | A customer reply and a team note show in the right inbox. |
| M10 | Delivery agent app | Phone app with inbox, stock receipt, deposits, language switch. | An agent completes a delivery and confirms stock on a phone. |
| M11 | AI chat, read-only | Drawer on every screen, suggestion cards, KPI and problem-finder tools. | The chat answers number questions from the KPI services and lists open findings. |
| M12 | AI write tools | Expense, stock, order tools with preview and confirm. | Each write shows a preview, needs a confirm and leaves an audit row. |
| Later | Seller SaaS | Signup, billing enforcement, onboarding, messaging wallet, per-seller WhatsApp. | Not in this rebuild. |

Order notes:
- M0 and M1 come first. Every later screen depends on correct data and one definition per number.
- M2 comes before the screens so each new feature registers its tools as it ships.
- M5 comes before M7 because the commission ledger posts to payables and the reconcile fixes the cash numbers the owner checks daily.
- Linear cleanup (plan step 6) happens before M0 starts. MAN-62 and MAN-63 are blocked on a deploy. MAN-64 is superseded.

---

## 11. Open questions

For the owner:
| # | Question | Source |
|---|---|---|
| 1 | Twi and Ga strings in the agent app need a native speaker check. Should the agent app have a language switch at all? The mockup added one. | Round 2 builder E; round 3 — ANSWERED (D1, O3): English only; no other language is planned. See `docs/prd/decisions.md`. |
| 2 | Landed cost uses the counted quantity (288), not the shipped quantity (300). The design says yes. Confirm. | Stock round; NUMBERS.md — ANSWERED (D2): landed cost per unit uses the counted quantity (288). See `docs/prd/decisions.md`. |
| 3 | Workflows has a new "By region" assign mode in the mockups. Build it? Paystack is Nigeria-only in the current app. Does the Ghana business need a Ghana payment option? | Round 2 builder B — ANSWERED (D3, G1): build "By region" assign. Keep Paystack behind a provider interface; it works as today. O2: no Paystack Ghana (Ghana sells by COD). O4: "By region" is a Workflow (condition "Region is X", action "Assign to"). See `docs/prd/decisions.md`. |
| 4 | Convert `Order`, `Product`, `Expense` and `Payout` money columns from Float to Decimal? It is safer for the books but is a large data migration. | Audit risk 5 — ANSWERED (D4): convert money columns from Float to Decimal in M0. See `docs/prd/decisions.md`. |
| 5 | August and September cost basis. Aug and Sep show +12% margin. GUESS: these used an older cost per set. Restate at GH₵30 landed cost, or leave history as booked? | NUMBERS.md; progress.md — ANSWERED (D5): August and September stay as booked, with a note. No restatement. See `docs/prd/decisions.md`. |
| 6 | Target for time to first call, and the wait that triggers an alert (mockup shows 12 min, 41 min, 2 min and a 3 h 10 min oldest wait). | KPI review — ANSWERED (D6, G5): target 15 minutes, alert at 30 minutes, counted only inside operating hours. See `docs/prd/decisions.md`. |
| 7 | MAN-56 (order state machine) and multi-store (unmerged branches): bring them in, rebuild them or drop them? Multi-store is not in the locked decisions. | Audit and fact-check — ANSWERED (D7): rebuild the order state machine (MAN-56) in M1; multi-store stays out until the SaaS phase. See `docs/prd/decisions.md`. |
| 8 | Do `digital_delivered` orders (ebooks) count as delivered revenue? The dashboard whitelist leaves them out today. | Audit — ANSWERED (D8): a paid digital order counts as delivered revenue; a free bundled digital item does not. See `docs/prd/decisions.md`. |
| 9 | Delivery-role reward tiers (GH₵100, 250, 400 + day off) come from round 2. NUMBERS.md only restates the rep tiers. Confirm the delivery tiers still stand. | Source gap — ANSWERED (D9): no airtime tier; cash tiers only (Rep 100% GH₵300, 120% GH₵500 + paid day off; Delivery 100% GH₵250, 120% GH₵400 + paid day off). See `docs/prd/decisions.md`. |

For checking (GUESS items):
| # | Item |
|---|---|
| 10 | Does GL 4010 post with `entryDate` = delivery date? (section 5.4) |
| 11 | Do `Order` / `OrderHistory` rows give enough history to backfill `confirmedAt`, `dispatchedAt` and `firstContactAt`? |
| 12 | Does `getCashFlowReport` double count? Does `getFinancialSummary` leave out digital revenue and Paystack fees? |
| 13 | Meta Marketing API scopes, App Review and rate limits for the spend pull. |
| 14 | Messaging prices and the Twilio SMS conflict (section 8.3). |
| 15 | Whether any of the three placeholder migrations created objects that production uses (the `period_close` enum value suggests yes). |
