# CodAdmin Linear Audit (MAN team)

Generated 2026-10-17 from `linear api` GraphQL (read-only). Source: MAN team, all states, 217 issues total. Stale = no update in more than 60 days.

Note: `linear issue list` has no JSON flag and requires a sort flag, so the data came from a raw GraphQL query. Every MAN issue belongs to a project; none lack one. AdMarrow projects excluded per request.


## CodAdmin Embed Widget + Paystack Everywhere

- Status: started · progress 47% · target date: none
- Description: Drop-in JS embed widget for tenant landing pages + Paystack as buyer payment + tenant payouts + SaaS subscriptions. Parent plan: /Users/mac/.claude/plans/i-want-to-improve-sleepy-sun.md
- Milestones: none
- Issues by state: backlog 8, unstarted 1, completed 8, canceled 1 (total 18)

Open issues (9):

| ID | Title | State | Priority | Milestone | Last updated | Days since | 1-line description |
|---|---|---|---|---|---|---|---|
| MAN-62 | [CODA-8] Magic Groove dogfood — first real-traffic test of CodAdmin checkout | Backlog | High | - | 2026-06-08 | 130 | ⚠️ DECISION UPDATE — 2026-06-08 This section supersedes the original spec below wherever they conflict. Read before implementing. Operational, no code... |
| MAN-69 | Numeric-cap enforcement (orders/staff/products/agents/forms) | Backlog | High | - | 2026-06-11 | 127 | Add numeric-cap enforcement so the limits-only tiers actually bite. Today MAN-61 seeds the caps for display only — orderService.createOrder() never re... |
| MAN-70 | Unpaid + Free-expiry access lockout | Backlog | High | - | 2026-06-11 | 127 | One lazy, request-time access gate that blocks tenants who shouldn't have dashboard access: subscriptionStatus in (pending, past_due, cancelled) → blo... |
| MAN-74 | Demo app — shared all-features sandbox for prospects (next milestone) | Todo | High | - | 2026-06-11 | 127 | Demo app — shared, all-features, sample data (NEXT milestone after MAN-61) MAN-61 ships pricing-first registration: homepage → pricing → pick plan → r... |
| MAN-63 | [CODA-9] Migrate Pile Combo + ManShield + Harmony Boost to CodAdmin checkout | Backlog | Medium | - | 2026-06-08 | 130 | ⚠️ DECISION UPDATE — 2026-06-08 This section supersedes the original spec below wherever they conflict. Read before implementing. Operational, no code... |
| MAN-68 | Billing v2 / Subscription enforcement | Backlog | Medium | - | 2026-06-11 | 127 | Billing v2 / Subscription enforcement (epic) Follow-up work deferred from MAN-61 (Paystack subscription billing engine). MAN-61 ships the engine, the ... |
| MAN-71 | Dunning emails (payment failed / renewed / card expiring) | Backlog | Medium | - | 2026-06-11 | 127 | Transactional dunning emails for the subscription lifecycle: Payment failed (invoice.payment_failed) → "update your card" with a re-auth link. Payment... |
| MAN-72 | Admin billing dashboard (renews-at / past-due / churn) | Backlog | Medium | - | 2026-06-11 | 127 | Full platform-admin billing dashboard. MAN-61 ships only a minimal read-only "Billing activity" list (event type / tenant / amount / timestamp). This ... |
| MAN-73 | Annual / bi-annual billing | Backlog | Low | - | 2026-06-11 | 127 | Add annual / bi-annual billing as a second Paystack interval alongside the monthly Plans: Second set of Paystack Plans (annual) for Growth/Scale. Pric... |

## Multi-Store Per Login

- Status: started · progress 75% · target date: none
- Description: One owner login manages many fully-isolated stores; switch one active store at a time; each store its own paid Paystack subscription. From 3 gstack reviews (CEO/Eng/Design), 26 tasks to ~23 issues, foundation-first deps.
- Milestones: none
- Issues by state: backlog 1, unstarted 5, completed 18 (total 24)

Open issues (6):

| ID | Title | State | Priority | Milestone | Last updated | Days since | 1-line description |
|---|---|---|---|---|---|---|---|
| MAN-102 | Create Tenant modal: billing email + plan + pending state (D3) | Todo | High | - | 2026-07-06 | 102 | Source: gstack design task D3 (plan-design-review) + eng decision C. Priority P1. Files: frontend/src/pages/PlatformTenants.tsx, frontend/src/services... |
| MAN-103 | Pending-return: confirming + poll/refetch + auto-swap (D4) | Todo | High | - | 2026-07-06 | 102 | Source: gstack design task D4 (plan-design-review). Priority P1. Files: frontend/src/components/billing/PendingPlanBanner.tsx. Task Pending-return exp... |
| MAN-104 | Three failure states: payment-failed, stuck-pending, switch-fail (D5) | Todo | High | - | 2026-07-06 | 102 | Source: gstack design task D5 (plan-design-review). Priority P1. Files: frontend/src/components/billing/PendingPlanBanner.tsx, frontend/src/stores/aut... |
| MAN-105 | Mobile (375px): switcher in sidebar drawer (D6) | Todo | Medium | - | 2026-07-06 | 102 | Source: gstack design task D6 (plan-design-review). Priority P2. Files: frontend/src/components/layout/Sidebar.tsx. Task On mobile (375px), render the... |
| MAN-106 | Switcher a11y: role=menu, arrow nav, Esc, aria-current, 44px (D7) | Todo | Medium | - | 2026-07-06 | 102 | Source: gstack design task D7 (plan-design-review). Priority P2. Files: frontend/src/components/ui/Dropdown.tsx. Task Switcher a11y: role=menu, arrow-... |
| MAN-107 | TODO: blue-* to primary-* token migration (D8, deferred) | Backlog | Low | - | 2026-07-06 | 102 | Source: gstack design task D8 (plan-design-review). Priority P3 — DEFERRED, not part of the sprint. Files: frontend/tailwind.config.js. Task (deferred... |

## Platform Launch

- Status: started · progress 70% · target date: none
- Description: (none)
- Milestones: Phase 4: Marketing Data Integration; Phase 3: Customer Communication; Phase 2: Agent Mobile Experience; Phase 1: Complete the Core
- Issues by state: backlog 8, completed 19, canceled 1 (total 28)

Open issues (8):

| ID | Title | State | Priority | Milestone | Last updated | Days since | 1-line description |
|---|---|---|---|---|---|---|---|
| MAN-49 | Database schema & GL config for Meta Ads integration | Backlog | Urgent | Phase 4: Marketing Data Integration | 2026-03-17 | 213 | Summary Add Prisma models for Meta Ads integration and configure the GL system for marketing expenses. Acceptance Criteria - MetaConnection model stor... |
| MAN-50 | Meta Ads API service, controller & routes | Backlog | Urgent | Phase 4: Marketing Data Integration | 2026-03-17 | 213 | Summary Build the core Meta Ads API service with OAuth flow, token management, campaign data fetching, and GL journal entry creation. Acceptance Crite... |
| MAN-51 | Marketing sync queue & scheduled job | Backlog | High | Phase 4: Marketing Data Integration | 2026-03-17 | 213 | Summary Create a Bull/Redis queue for daily automated sync of Meta Ads campaign data, plus GL journal entry creation from synced spend data. Acceptanc... |
| MAN-52 | Frontend: Marketing connections & OAuth UI | Backlog | High | Phase 4: Marketing Data Integration | 2026-03-17 | 213 | Summary Build the frontend for connecting Meta Business Manager accounts via OAuth and managing ad account sync settings. Acceptance Criteria - market... |
| MAN-53 | Frontend: Marketing dashboard, campaigns & product profitability | Backlog | High | Phase 4: Marketing Data Integration | 2026-03-17 | 213 | Summary Build the marketing dashboard with KPI cards, charts, and campaign performance table with product mapping. Acceptance Criteria Marketing Dashb... |
| MAN-65 | Order activity feed UI (surface OrderHistory) | Backlog | Medium | - | 2026-06-01 | 137 | Context MAN-56 added the order state machine + OrderHistory audit rows. Every status change now writes a row with actor (system / sales rep / delivery... |
| MAN-75 | Move product/image uploads to object storage (Cloudflare R2) — environment-independent images | Backlog | Medium | - | 2026-06-21 | 117 | Problem Product images (and any multer uploads) are written to the backend container's local disk at /app/uploads and served as relative /uploads/<fil... |
| MAN-64 | [CODA-2b] Checkout templates + skins + admin builder UI | Backlog | None | - | 2026-05-30 | 139 | CODA-2b Checkout templates + skins + admin builder UI Context Split from MAN-56 (CODA-2) during 2026-05-29 brainstorm. MAN-56 ships the order state ma... |

## Financial Management Module (Phase 1 & 2)

- Status: planned · progress 87% · target date: none
- Description: (none)
- Milestones: none
- Issues by state: unstarted 2, completed 13 (total 15)

Open issues (2):

| ID | Title | State | Priority | Milestone | Last updated | Days since | 1-line description |
|---|---|---|---|---|---|---|---|
| MAN-19 | [F-014] Implement Automated Notifications | Todo | Urgent | - | 2026-01-13 | 276 | Overview Key stakeholders receive automated email notifications for important financial events without having to check dashboard. Two notification typ... |
| MAN-20 | [F-015] Implement Multi-Format Report Exports | Todo | Urgent | - | 2026-01-13 | 276 | Overview All financial reports shall be exportable to PDF (for sharing), CSV (for analysis), and viewable as interactive dashboard charts. Email deliv... |

## Future Backlog

- Status: planned · progress 31% · target date: none
- Description: (none)
- Milestones: none
- Issues by state: backlog 11, completed 5 (total 16)

Open issues (11):

| ID | Title | State | Priority | Milestone | Last updated | Days since | 1-line description |
|---|---|---|---|---|---|---|---|
| MAN-54 | Product-level Meta pixel config + CAPI event tracking (OrderConfirmed / OrderDelivered) | Backlog | High | - | 2026-04-27 | 172 | Overview Move pixel tracking configuration from CheckoutForm to Product and implement server-side Meta CAPI events for OrderConfirmed and OrderDeliver... |
| MAN-33 | AI Operations Assistant | Backlog | Medium | - | 2026-03-15 | 215 | Smart agent assignment based on location/workload, route optimization suggestions, demand forecasting by product/region |
| MAN-34 | AI Admin Copilot | Backlog | Medium | - | 2026-03-15 | 215 | Natural language queries on business data, auto-generated daily/weekly reports, anomaly detection for returns and agent performance |
| MAN-35 | Agent Inventory Phase 3 — Automated Reconciliation | Backlog | Medium | - | 2026-03-15 | 215 | Automated reconciliation matching stock allocated to orders fulfilled and returns. Bulk return processing, discrepancy alerts, auto-generated reconcil... |
| MAN-37 | Customer self-service portal | Backlog | Medium | - | 2026-03-15 | 215 | Expand public order tracking. Customer order history by phone number, re-order functionality, delivery ETA display |
| MAN-39 | Multi-currency support (GHS, NGN, XOF) | Backlog | Medium | - | 2026-03-15 | 215 | Support multiple West African currencies for cross-border COD operations |
| MAN-41 | Audit trail & activity logging | Backlog | Medium | - | 2026-03-15 | 215 | Full activity logging for compliance, dispute resolution, and operational transparency |
| MAN-36 | Agent Inventory Phase 4 — Analytics | Backlog | Low | - | 2026-03-15 | 215 | Agent efficiency metrics (stock turns, fulfillment rate, return rate), top-performing agents by inventory efficiency, dead stock identification (7+ da... |
| MAN-38 | Advanced workflow actions | Backlog | Low | - | 2026-03-15 | 215 | WhatsApp and SMS as workflow action types, create task action for follow-ups, workflow execution analytics |
| MAN-40 | Multi-language (English + French) | Backlog | Low | - | 2026-03-15 | 215 | Internationalization for French-speaking West African markets (Côte d'Ivoire, Senegal, etc.) |
| MAN-42 | Advanced reporting | Backlog | Low | - | 2026-03-15 | 215 | Exportable reports, scheduled email reports, custom date ranges, PDF generation |

## Flags

### Duplicates and overlaps
- MAN-42 "Advanced reporting" (Future Backlog) overlaps MAN-20 "[F-015] Multi-Format Report Exports" (Financial, Todo). Both cover PDF/CSV exports. Possible duplicate. (CONFIRMED from issue text.)
- MAN-41 "Audit trail & activity logging" (Future Backlog) overlaps MAN-65 "Order activity feed UI" (Platform Launch), which surfaces the OrderHistory audit rows added by done MAN-56. Partial overlap, different scope (compliance vs UI). (CONFIRMED from text; overlap call is judgement.)
- MAN-64 "[CODA-2b] Checkout templates + skins + admin builder UI" (Platform Launch, Backlog, P0). The 2026-06-08 decision notes on done MAN-57, MAN-58, MAN-59 say "Skins dropped, single template". MAN-64 looks superseded. (CONFIRMED that the decision notes say skins are dropped; that MAN-64 is obsolete is UNVERIFIED until the owner confirms.)
- MAN-54 "Product-level Meta pixel config + CAPI events" (Future Backlog) sits near done MAN-59 "Meta CAPI + custom thank-you URL". Check it is not re-proposing shipped work. (UNVERIFIED.)
- MAN-68 is an epic ("Billing v2 / Subscription enforcement"). Its children MAN-69, 70, 71, 72, 73 sit in the same project as separate issues. Confirm they are sub-issues, or they will be tracked twice. (CONFIRMED from text.)
- MAN-74 "Demo app" (Embed project) is described as the next milestone after done MAN-61. It has no milestone set. (CONFIRMED.)

### Looks already done or superseded
- MAN-64 (see above).
- MAN-75 "Move uploads to Cloudflare R2". The memory file `reference_codadmin_infra.md` mentions R2. Check whether R2 is already in use before scheduling this. (UNVERIFIED.)
- MAN-19 and MAN-20 (Financial, Todo, P1) sit in a project shown at 87% progress. The two open items may be the last of a module that is otherwise shipped. Check whether the module is really "Planned". (CONFIRMED that the project shows 87%; the status question is judgement.)

### Blocked
- MAN-62 "Magic Groove dogfood" and MAN-63 "Migrate Pile Combo + ManShield + Harmony Boost" (Embed, Backlog). Both are operational and post-deploy: the description says they run only after MAN-57/58/59 are merged and deployed to codadminpro.com. MAN-57/58/59 are Done. So these are blocked on a deploy and an admin action, not code. (CONFIRMED from the description text.) MAN-63 is also linked as blocked by MAN-62. (CONFIRMED from relations.)
- MAN-103 to MAN-106 (Multi-Store, Todo): a dependency chain. MAN-102 blocks 103, 103 blocks 104, 104 blocks 105, 105 blocks 106. MAN-102 is the head and is itself open. (CONFIRMED from relations.) MAN-89 (Done) blocked 102/103. Nothing else is blocked in the open set.
- MAN-107 (Multi-Store, Backlog, P3) is marked DEFERRED and not part of the launch. (CONFIRMED.)

### Stale (no update in more than 60 days)
- All 36 open issues in these five projects are stale. The oldest is 276 days (MAN-19/20). The newest is 102 days (Multi-Store). Last-updated dates are in the tables above. (CONFIRMED.)

### Notes
- Every MAN issue belongs to a project. The "no project" set is empty. (CONFIRMED.)
- The summary above counts all 217 MAN issues, including the AdMarrow projects (AdMarrow Phase 1 Frontend: 59 issues, AdMarrow Phase 2: 57). They are left out of the tables and not otherwise analysed.
- Gaps: no comments or cycles were pulled. Project milestone target dates are all empty. Blocking was read from relations, and only the direction of the "blocks" edges has been checked for the Multi-Store and Embed chains.

## Applied 2026-10-19

Owner-approved cleanup from `docs/plan/linear-cleanup.html`, applied through the Linear GraphQL API. Each issue got the comment from the proposal.

**Canceled (19), comment "Superseded by CodAdmin rebuild":** MAN-49, 50, 51, 52, 53 (M8); MAN-65 (M3-T47); MAN-54 (M3b); MAN-20, 42 (M3 G8); MAN-19 (M9); MAN-33, 34 (M11, M12); MAN-35 (M4, M5); MAN-36 (M4); MAN-39 (M1); MAN-41 (M2); MAN-38 (M9); MAN-64 (skins cancelled, M3b); MAN-40 (dropped, English only, O3).

**Moved to new project "CodAdmin SaaS later" (16, state unchanged):** MAN-68, 69, 70, 71, 72, 73, 74, 37, 102, 103, 104, 105, 106, 107, plus MAN-62 (do after M3b) and MAN-63 (renamed "Move ManShield and Harmony Boost to CodAdmin checkout"; Pile Combo removed from scope).

**MAN-75: Done.** Product image upload already goes to R2: `backend/src/controllers/uploadController.ts:21-23`, `backend/src/config/r2.ts:15-24` and `:48-64`, `backend/src/routes/uploadRoutes.ts:9`, `backend/.env.example:92-99`. No M4 task added; plan totals unchanged (458 tasks).

**Projects set to Completed (5), each with the update "All open issues closed or moved. Work continues in CodAdmin Rebuild (and CodAdmin SaaS later).":** CodAdmin Embed Widget + Paystack Everywhere; Multi-Store Per Login; Platform Launch; Financial Management Module (Phase 1 & 2); Future Backlog. Each had 0 open issues before the change (checked). No unlisted open issue was found.

**Archived (85) to free the free-plan issue limit (owner choice, 2026-10-19):** Done or Canceled issues in the 5 Completed projects, the 19 canceled above, and MAN-75. Archived, not deleted; restorable. MAN-67, MAN-66, MAN-61, MAN-60, MAN-59, MAN-58, MAN-57, MAN-56, MAN-55, MAN-108, MAN-101, MAN-100, MAN-99, MAN-98, MAN-97, MAN-96, MAN-95, MAN-94, MAN-93, MAN-92, MAN-91, MAN-90, MAN-89, MAN-88, MAN-87, MAN-86, MAN-85, MAN-84, MAN-83, MAN-82, MAN-81, MAN-80, MAN-79, MAN-78, MAN-77, MAN-76, MAN-75, MAN-65, MAN-64, MAN-53, MAN-52, MAN-51, MAN-50, MAN-49, MAN-48, MAN-32, MAN-31, MAN-30, MAN-29, MAN-28, MAN-27, MAN-26, MAN-25, MAN-24, MAN-23, MAN-20, MAN-19, MAN-18, MAN-17, MAN-16, MAN-15, MAN-14, MAN-13, MAN-12, MAN-11, MAN-10, MAN-9, MAN-8, MAN-7, MAN-6, MAN-54, MAN-47, MAN-46, MAN-45, MAN-44, MAN-43, MAN-42, MAN-41, MAN-40, MAN-39, MAN-38, MAN-36, MAN-35, MAN-34, MAN-33.

**Created: project "CodAdmin Rebuild"** (https://linear.app/manny-studio/project/codadmin-rebuild-7358f08cb537): 14 milestones (M0–M12 + M3b), 106 issues MAN-225 to MAN-331, state Backlog. MAN-283 does not exist (number used by the create call Linear refused at the limit). In each milestone the close-out issue is blocked by the others (92 relations). Keys are in `docs/plan/linear-issues.md`. Verified through the API: per-milestone counts match the draft, no duplicate titles.


## Moved to team CodAdmin (COD), 2026-10-19

Cause: Linear GitHub issue sync links the admarrow repo to team MAN. Every new MAN issue got a copy in admarrow (#118-#223).

Done:
1. Created team CodAdmin (key COD). No GitHub sync on it.
2. Removed the admarrow GitHub link from each of the 106 Rebuild issues, then moved them to COD (state Backlog, milestones and blocks relations kept).
3. Closed admarrow #118-#223 as "not planned" with a comment. Linear issues stayed open (tested on one issue first).
4. Project "CodAdmin Rebuild" now belongs to team COD only. MAN-283 never existed.

| Old key | New key |
|---|---|
| MAN-225 | COD-2 |
| MAN-226 | COD-3 |
| MAN-227 | COD-4 |
| MAN-228 | COD-5 |
| MAN-229 | COD-6 |
| MAN-230 | COD-7 |
| MAN-231 | COD-8 |
| MAN-232 | COD-9 |
| MAN-233 | COD-10 |
| MAN-234 | COD-11 |
| MAN-235 | COD-12 |
| MAN-236 | COD-13 |
| MAN-237 | COD-14 |
| MAN-238 | COD-15 |
| MAN-239 | COD-16 |
| MAN-240 | COD-17 |
| MAN-241 | COD-18 |
| MAN-242 | COD-19 |
| MAN-243 | COD-20 |
| MAN-244 | COD-21 |
| MAN-245 | COD-22 |
| MAN-246 | COD-23 |
| MAN-247 | COD-24 |
| MAN-248 | COD-25 |
| MAN-249 | COD-26 |
| MAN-250 | COD-27 |
| MAN-251 | COD-28 |
| MAN-252 | COD-29 |
| MAN-253 | COD-30 |
| MAN-254 | COD-31 |
| MAN-255 | COD-32 |
| MAN-256 | COD-33 |
| MAN-257 | COD-34 |
| MAN-258 | COD-35 |
| MAN-259 | COD-36 |
| MAN-260 | COD-37 |
| MAN-261 | COD-38 |
| MAN-262 | COD-39 |
| MAN-263 | COD-40 |
| MAN-264 | COD-41 |
| MAN-265 | COD-42 |
| MAN-266 | COD-43 |
| MAN-267 | COD-44 |
| MAN-268 | COD-45 |
| MAN-269 | COD-46 |
| MAN-270 | COD-47 |
| MAN-271 | COD-48 |
| MAN-272 | COD-49 |
| MAN-273 | COD-50 |
| MAN-274 | COD-51 |
| MAN-275 | COD-52 |
| MAN-276 | COD-53 |
| MAN-277 | COD-54 |
| MAN-278 | COD-55 |
| MAN-279 | COD-56 |
| MAN-280 | COD-57 |
| MAN-281 | COD-58 |
| MAN-282 | COD-59 |
| MAN-284 | COD-60 |
| MAN-285 | COD-61 |
| MAN-286 | COD-62 |
| MAN-287 | COD-63 |
| MAN-288 | COD-64 |
| MAN-289 | COD-65 |
| MAN-290 | COD-66 |
| MAN-291 | COD-67 |
| MAN-292 | COD-68 |
| MAN-293 | COD-69 |
| MAN-294 | COD-70 |
| MAN-295 | COD-71 |
| MAN-296 | COD-72 |
| MAN-297 | COD-73 |
| MAN-298 | COD-74 |
| MAN-299 | COD-75 |
| MAN-300 | COD-76 |
| MAN-301 | COD-77 |
| MAN-302 | COD-78 |
| MAN-303 | COD-79 |
| MAN-304 | COD-80 |
| MAN-305 | COD-81 |
| MAN-306 | COD-82 |
| MAN-307 | COD-83 |
| MAN-308 | COD-84 |
| MAN-309 | COD-85 |
| MAN-310 | COD-86 |
| MAN-311 | COD-87 |
| MAN-312 | COD-88 |
| MAN-313 | COD-89 |
| MAN-314 | COD-90 |
| MAN-315 | COD-91 |
| MAN-316 | COD-92 |
| MAN-317 | COD-93 |
| MAN-318 | COD-94 |
| MAN-319 | COD-95 |
| MAN-320 | COD-96 |
| MAN-321 | COD-97 |
| MAN-322 | COD-98 |
| MAN-323 | COD-99 |
| MAN-324 | COD-100 |
| MAN-325 | COD-101 |
| MAN-326 | COD-102 |
| MAN-327 | COD-103 |
| MAN-328 | COD-104 |
| MAN-329 | COD-105 |
| MAN-330 | COD-106 |
| MAN-331 | COD-1 |
