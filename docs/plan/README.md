# CodAdmin rebuild: task plan overview

This folder holds one task plan per milestone: `M0.md` to `M12.md`, plus `M3b.md` (checkout and payments). Source: `docs/prd/PRD.md` section 10, `docs/prd/decisions.md`, and the area files in `docs/prd/areas/`. Each plan has tasks (ID, hours, size, depends on, F-IDs, testable done criteria), decisions to take at task time, a dependency map, risks, an effort table and a coverage table. One builder does the tasks in order. Opus reviews. The owner approves each milestone before any push.

Two planners wrote the files in parallel (M0 to M4, and M5 to M12). Opus reconciled them on 2026-10-18. What changed is in section 7. The owner then reviewed the plan page and made decisions O1 to O7 (`docs/prd/decisions.md`; O7 came on 2026-10-19). Section 9 lists what those decisions changed in the plan.

## 1. All milestones

Hours: "likely" is the sum of the task hours. "Planned" is the expected value (O + 4M + P) / 6 with a 25% buffer. O and P factors are set per milestone in each file (M0 to M4: 70% and 160%; M3b, M5, M9: 80% and 160%; M6, M7, M11: 80% and 150%; M8: 80% and 170%; M10, M12: 80% and 140%). One builder, so hours are working hours, not calendar time.

| Milestone | Goal | Depends on | Tasks | Likely h | Planned h (25% buffer) | F-IDs owned (partial count) |
|---|---|---|---|---|---|---|
| M0 | Correctness base: tenant isolation, schema parity with production, Decimal money | none | 39 | 200 | 262 | 16 owned, 8 partial: F-122, F-125, F-126, F-150 to F-156, F-363, F-716, F-932, F-1013, F-1099, F-1236 |
| M1 | KPI definitions: one answer per number, new order state machine, `FxRate` | M0 | 38 | 211 | 277 | 23 owned, 6 partial: F-112 to F-114, F-250 to F-253, F-301 to F-304, F-359, F-362, F-610, F-720, F-767, F-768, F-900, F-901, F-905, F-935, F-1054, F-1232 |
| M2 | Tool registry and audit: every action has an actor and an audit row | M0, M1 | 22 | 128 | 168 | 9 owned, 3 partial: F-937, F-1208, F-1300 to F-1303, F-1305, F-1306, F-1309 |
| M3 | Design shell: v2 shell, Dashboard, Orders, Customers, Reports, Settings | M0, M1, M2 | 60 | 384 | 504 | 68 owned, 6 partial: F-100 to F-102, F-104, F-105, F-107 to F-111, F-115, F-120, F-121, F-123, F-124, F-140, F-200 to F-205, F-207, F-209, F-210, F-254, F-300, F-307, F-308, F-310, F-311, F-313 to F-316, F-318 to F-323, F-327, F-328, F-350 to F-354, F-356, F-361, F-1050 to F-1053, F-1057, F-1064, F-1215, F-1220 to F-1226, F-1230, F-1233, F-1234, F-1237 |
| M3b | Checkout and payments: forms, public checkout, provider interface | M3 (and M0 to M2) | 24 | 142 | 189 | 24 owned, 0 partial: F-400 to F-408, F-410 to F-423, F-934 |
| M4 | Stock and fulfilment: locations, ledger, shipment receiving, partners, Deliveries | M0 to M3 | 41 | 262 | 344 | 35 owned, 1 partial: F-211, F-305, F-600 to F-608, F-611, F-650 to F-653, F-655 to F-660, F-700 to F-702, F-705 to F-711, F-713, F-715, F-719 |
| M5 | Settlement and finance: delivery fees, 3PL settlement, Finance pages, payout form | M0 to M2, M3b, M4 | 41 | 239 | 319 | 36 owned, 2 partial: F-309, F-703, F-704, F-712, F-721, F-902 to F-904, F-906 to F-913, F-915, F-917 to F-931, F-936, F-938, F-939, F-1055 |
| M6 | Roles, targets, rewards: North Star, targets by role and person, staff invites | M0 to M4, M5 | 27 | 170 | 223 | 33 owned, 1 partial: F-208, F-513, F-916, F-1100 to F-1105, F-1107 to F-1114, F-1150 to F-1163, F-1165, F-1231 |
| M7 | Lead conversion: rep app, call outcomes, commission, auto-confirm core | M0 to M3, M5, M6 | 27 | 170 | 223 | 27 owned, 6 partial: F-317, F-324, F-355, F-357, F-750 to F-762, F-764 to F-766, F-769, F-771, F-914, F-1061, F-1106, F-1164, F-1229 |
| M8 | Marketing: Meta spend and funnel, campaign tags, Marketing tab | M1, M3, M3b, M5, M6 | 24 | 140 | 190 | 17 owned, 0 partial: F-409, F-933, F-1000 to F-1011, F-1014, F-1056, F-1205 |
| M9 | Inbox and messages: Messages, Workflows, Inbox, Connections page | M0 to M4, M3b, M5 to M8 | 52 | 320 | 427 | 61 owned, 1 partial: F-106, F-325, F-326, F-360, F-450 to F-466, F-500 to F-512, F-514, F-550 to F-558, F-560, F-763, F-1200 to F-1204, F-1206, F-1207, F-1209 to F-1213, F-1227, F-1228, F-1235 |
| M10 | Delivery agent app: phone app, stock confirm, cash deposit | M0, M1, M3, M4, M5, M6, M9 | 21 | 123 | 159 | 24 owned, 0 partial: F-103, F-212, F-306, F-559, F-654, F-800 to F-818 |
| M11 | AI chat, read only: KPI answers, suggestion cards, audit-log screen | M0 to M3, M4 to M10 | 25 | 152 | 200 | 20 owned, 3 partial: F-206, F-312, F-358, F-467, F-516, F-561, F-609, F-661, F-717, F-770, F-1012, F-1015, F-1060, F-1307, F-1308, F-1310 to F-1312, F-1314, F-1315 |
| M12 | AI write tools: preview, confirm, audit row per write | M2, M4, M5, M7, M9, M10, M11 | 17 | 95 | 123 | 5 owned, 0 partial: F-515, F-1304, F-1313, F-1316, F-1317 |
| **Total** | | | **458** | **2736** | **3608** | |

The F-ID column lists the owned F-IDs. The partial count is the F-IDs this milestone only part-builds; the lists are in each file's Coverage section. An F-ID is owned by the milestone where it lands last and is listed once as "owned". Earlier milestones that do part of it list it as "partial". Every PRD F-ID is owned by exactly one milestone.

## 2. Order and dependency map

Build order for one builder: M0, M1, M2, M3, M3b, M4, M5, M6, M7, M8, M9, M10, M11, M12.

```
M0 -> M1 -> M2 -> M3 --+--> M3b ---------------+
                       |                       v
                       +--> M4 ------------> M5 -> M6 --+--> M7 --+
                                                        |        v
                                                        +--> M8 -> M9 -> M10 -> M11 -> M12
```

Direct needs (from each file's "Depends on"):
- M3b needs M3 only. M4 needs M3 only, so M3b and M4 can run side by side with two builders.
- M5 needs M3b (provider interface, neutral webhook, digital revenue and Paystack fee on 5060) and M4 (partners, stock counts).
- M6 needs M5 (payout form, commission posting). M7 needs M5 and M6. M8 needs M3b (forms list), M5 (account 5080, fee rules) and M6.
- M9 needs M3b (provider interface), M4 to M8. M10 needs M4, M5, M6, M9. M11 needs M4 to M10. M12 needs M2, M4, M5, M7, M9, M10, M11.

## 3. Overall critical path

By planned hours, the longest chain of milestones is **M0 > M1 > M2 > M3 > M4 > M5 > M6 > M7 > M9 > M10 > M11 > M12**: 3229 planned hours (2454 likely). M3b and M8 are not on it. They run beside M4 and M7 if a second builder exists.

With one builder, calendar time follows the total, not the path: **3608 planned hours** (2736 likely) for 14 milestones and 458 tasks. The path only matters if more than one builder works. The longest single-task chain inside each milestone is in that milestone's Effort section.

## 4. Owner actions

| When | What the owner does | Task |
|---|---|---|
| Before M0 | Finish the Linear cleanup (MAN-62 and MAN-63 wait on a deploy; MAN-64 is superseded). | PRD section 10 notes |
| M0 | Allow read-only production access: SSH schema dump, read-only SQL on money columns, 14 days of server logs. | M0-T05, M0-T07, M0-T19 |
| M0 end | Read the R15 money-unit result and the parity diff. Approve the production runbook. The production migration is a separate step. | M0-T39 |
| M1 end | Confirm year pace, closed-cohort days and the FX rate provider. | M1-T38 |
| M2 end | Read the legacy MCP key list and decide which keys to tighten. | M2-T22 |
| M3 | Review at gates G1 (shell and Dashboard), G2 (Orders and Customers), G3 (Reports and Settings). Confirm the menu matrix and the Dashboard defaults at G1. | M3-T41, M3-T50, M3-T69, M3-T75 |
| M3b | One phone test of the public form in the Facebook in-app browser. Review at gate G1. | M3b-T19, M3b-T25 |
| M4 end | Review the summary of all M4 work and approve the PR. M4 never touches production. | M4-T41 |
| M5 | Approve before any production backfill of the 1,321 draft collections. Tell the outside agents (the ones that run partner syncs) how to call the "record partner payout" action with a normal API or MCP key. | M5-T30, M5-T10 |
| M8 start | Submit Meta App Review and Business Verification on day 1, as soon as the scope check is written. | M8-T01 |
| Every milestone end | Owner review of the PR and the "Decide at task time" results. Push and the PR to `develop` only after the owner says yes. Never push to `main`. | Last task of each file |

## 5. Top risks

1. **Money and production data (M0).** Decimal migration of 29 money columns, `depositPaid` and `balanceDue` may be minor units (R15), and 11 pending migrations must match production. Mitigation: read-only checks first, proof script, rehearsal on a production dump, runbook, separate owner-approved production step.
2. **Removed (O2).** The Paystack Ghana risk is gone: Ghana sells by COD and Paystack works as today.
3. **Size of M3 (60 tasks, 384 likely hours) and M9 (52 tasks).** One PR each. Mitigation: owner gates inside M3; cut lines in section 6.
4. **One answer for every number (M1).** Old revenue endpoints disagree today. Mitigation: KPI service layer, one fixture that reproduces `NUMBERS.md`, contract tests.
5. **Stock migration (M4).** Moves `AgentStock` and the warehouse number into `StockLevel` and corrects 148 out-for-delivery orders. Mitigation: dry-run mode, printed counts, sums must match, separate approval.
6. **Settlement data comes from agents outside the app (M5, PRD risk 25).** Mitigation: one generic "record partner payout" action (API and MCP tool), idempotent replay, a gap raises a Finding, backfill dry run on a staging copy.
7. **Meta access and review time (M8, PRD risk 23).** Mitigation: scope check first, owner submits review on day 1, CSV fallback.
8. **Session rotation change (M3-T23).** A bug could log every user out. Mitigation: migrate without invalidating tokens, test on a staging copy, keep the old column to the end of the PR.
9. **Workflows and WhatsApp only provable on a real number (M9).** Mitigation: cut line below; test numbers.

## 6. Cut lines

- **M3** (cut order if time runs out): Settings extras first (photo, export my data, sessions UI), then the Reports Team tab. The old M3 item "Design extras" meant the checkout form Design tab, which is now M3b-T14.
- **M3b**: the Design tab and the live preview (M3b-T14, M3b-T15). Keep M3b-T02 to M3b-T07 (payments) and the public page.
- **M4**: stock history modal, proof and attempts blocks, claim panel polish.
- **M9**: take **Workflows out as a second PR**: M9-T21 to M9-T25 and M9-T41 to M9-T43 (8 tasks, 56 likely hours, about 75 planned). The workflow part of M9-T48 (tests) goes with them. The rest of M9 (Messages, Inbox, Connections) does not depend on them. The plan keeps one PR as the PRD says.

## 7. Plan rules and what the reconcile changed

**Payments have their own milestone (M3b).** Moved out of M3: the provider interface, `PaymentConnection` service, form payment rules, the checkout forms API and UI, the public checkout and the pixel and CAPI tests. Moved out of M5: the provider interface and `PaymentConnection` API (duplicate), the neutral webhook and online order creation, the provider fee hook and payout posting, form payment rules (duplicate) and the callback page. Each F-ID in the F-400 range and F-934 has its tasks in M3b only. Moved task IDs are not reused, so M3 and M5 keep their numbers (M3 has no T01, T04, T05, T06, T18, T19, T51 to T59; M5 has no T01, T09, T20 to T23, T33, T43).

**Each model is created once, in the earliest milestone.** Later migrations only add fields or new models.

| Model | Created in | Later work |
|---|---|---|
| `Target`, `Finding`, `FeeRule`, `FxRate` | M1-T02 | M5-T02 extends `FeeRule` and `Finding`; M6-T01 adds a `Target` column only if the hierarchy needs one |
| `Role`, `RoleAssignment` | M2-T01 | M6-T01 adds fields (permission grid) |
| `UserSession` | M3-T02 | none |
| `PaymentConnection` | M3b-T02 | none |
| `StockLocation`, `StockLevel`, `StockCount`, `StockCountLine`, `DeliveryPartnerProfile`, `DeliveryAttempt` | M4-T01, M4-T02 | M5 uses `daysToPay` from M4-T02 and no longer adds it |
| `PartnerSettlement`, `PartnerSettlementLine`, `CommissionEntry` | M5-T02 | none |
| `RewardTier`, `BadgeAward`, `AssignmentCursor` | M6-T01 | none |
| `UpsellLine`, `ConfirmToken` | M7-T01 | M7 no longer repeats fields added in M1-T01 (`Call`) and M3-T02 (`Customer`, `Order.requiresManualCall`) |
| `MetaConnection`, `MetaAdAccount`, `MetaSpendDay`, `MetaCampaignMapping`, `FormVisitDay` | M8-T03 | none |
| Messaging, inbox and workflow models | M9-T01, M9-T02, M9-T03 | `Notification` already exists (M0-T09); M9-T02 extends it |
| `ChatThread`, `ChatMessage`, `SuggestionState` | M11-T02 | none |
| `AiAction` | M12-T01 | M2 adds only a nullable `AuditLog.aiActionId`; M12-T01 adds the relation |

**Reps and agents stay on the current pages behind flags.** M3-T33 adds `features.repApp` and `features.agentApp` (default off). M7-T13 turns on the rep flag when the rep app ships. M10-T08 turns on the agent flag when the agent app ships. Until then the restyled current pages stay, with the same permission checks. No rep or agent lands on a placeholder.

**Task rules.** No task is over 8 hours. Every milestone ends with `/simplify`, full checks, a browser check and the owner review. Every migration is applied by hand to `ecommerce_cod_test`. Every new model has a required `tenantId` and is in the scoped list.

**Coverage rule.** An F-ID is owned by the milestone where it lands last. Other milestones that touch it list it as partial. F-814 (agent language switch) is dropped by decision D1 and is recorded in M10-T09 (English only, no switch).

## 8. Checks run on this plan

Run by script on 2026-10-18 after the reconcile: every F-ID in `docs/prd/PRD.md` and `docs/prd/areas/*.md` (range ends such as F-199 left out) is owned by exactly one coverage table; every "Depends on" task ID exists; no task is over 8 hours; every model is created in one task; task counts and hours in the table above equal the sums of the task rows.

## 9. Changes from the owner plan-page review (2026-10-18) and O7 (2026-10-19)

Decisions O1 to O7 are in `docs/prd/decisions.md`. They changed the plan like this. Removed task IDs are not reused.

| Decision | Plan change |
|---|---|
| O1 Logiswift sync is outside the app | Removed M5-T16 (Logiswift connector inputs, 7 h) and M5-T31 (extend `logiswift-sync` with a portal export, 7 h). M5-T10 is now the one generic "record partner payout" action (API and MCP tool), with no partner-specific code. M5-T09 and M5-T33 (a generic partner key and its card) were then removed by O7. No "Logiswift sync status" on Connections. The 1,321 draft collections backfill (M5-T30) uses app data only. M0-T24 and M2-T13 say "outside agents" instead of naming the script. |
| O2 No Paystack Ghana | Removed M3b-T01 (4 h, the GH₵1 test charge) and R14. M3b-T02 now depends on M3 only. Risk 24 and the owner action are gone. Paystack stays behind the provider interface. |
| O3 Country-agnostic app | M1-T03 `regions.ts` is a helper over `country-state-city` data, not a list of 16 Ghana regions. Setup takes a country; the store currency follows it. English only (no Twi or Ga). GH₵ figures are sample values. |
| O4 Assign by region is a Workflow | Removed M6-T14 (partner resolve, 4 h) and F-714 (coverage). M4-T02 has no `PartnerCoverage` and no fallback flag. M4-T19 (8 h to 6 h) and M4-T33 (8 h to 5 h) lose the coverage API and grid. M9-T23 is now "Assign to" with Evenly or Weighted; region is a Workflow condition. |
| O5 All money in the store currency | M3-T31, M8 and the finance areas show other currencies converted at that day's rate with the original kept. |
| O6 Store currency is not locked | M1-T31 no longer rejects a currency change. The lock tests and the "first sale" open item are gone. PRD section 5.7 states how amounts are stored. |
| O7 No generic partner key | Removed M5-T09 (partner key service, 6 h) and M5-T33 (partner key card, 4 h). M5-T10 no longer depends on M5-T09. It accepts an API or MCP key that holds the payout permission. M5-T02 no longer creates `PartnerConnector`. F-718 and F-1214 are removed. M4-T19 data source default for a company is CSV, or Connector when an outside agent posts for it. M9 has no partner key card. M5 goes from 43 to 41 tasks, 249 to 239 likely hours, 332 to 319 planned hours. The M5 critical path is unchanged (74 h). The overall path drops from 3242 to 3229 planned hours. |

Totals before and after: 464 tasks and 2773 likely hours (3657 planned) became 460 tasks and 2746 likely hours (3621 planned). Requirements: 401 became 400 (F-714 removed).

Totals after O7: 460 tasks and 2746 likely hours (3621 planned) became 458 tasks and 2736 likely hours (3608 planned). Requirements: 400 became 398 (F-718 and F-1214 removed).
