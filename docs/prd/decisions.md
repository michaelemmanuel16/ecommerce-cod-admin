# Owner decisions for the PRD (2026-10-18)

These are final. The PRD must follow them. Do not reopen them.
The newest section is "Owner plan-page review (2026-10-18)" (O1 to O7; O7 was added on 2026-10-19). Where it replaces an older item, the old text stays in its row, struck through, with a "REPLACED by Ox" note. Do not follow struck text.
Also follow the 13 locked decisions in `docs/superpowers/specs/2026-10-18-codadmin-rebuild-design.md` §3.

## Design doc open questions (§11)
| # | Decision |
|---|---|
| D1 | Agent app: English only. ~~Add Twi/Ga after a native speaker checks them.~~ The "add Twi/Ga later" part is REPLACED by O3 (English only; no other language is planned). |
| D2 | Landed cost per unit uses the counted quantity (288), not the shipped quantity (300). |
| D3 | Build "By region" assign. O4 sets how: it is a Workflow (condition "Region is X", action "Assign to"), not a coverage grid. (Payments: see G1, which replaces the old "COD only" answer.) |
| D4 | Convert money columns (Order, Product, Expense, Payout and others) from Float to Decimal in M0. |
| D5 | August and September stay as booked, with a note. No restatement. |
| D6 | Time to first call: target 15 minutes, alert at 30 minutes. Count only inside operating hours (G5). |
| D7 | Rebuild the order state machine (MAN-56) in M1. Multi-store stays out until the SaaS phase. |
| D8 | A paid digital order counts as delivered revenue. A free bundled digital item does not. |
| D9 | No airtime reward tier anywhere. Cash tiers only: Rep 100% GH₵300; 120% GH₵500 + paid day off. Delivery 100% GH₵250; 120% GH₵400 + paid day off. |

## Settings fixes
| # | Decision |
|---|---|
| S1 | Reward tiers live only in Settings → Rewards. North Star & targets shows a one-line link to them. |
| S2 | AOV is computed and shown on Finance and Reports. North Star & targets has a "planned AOV" field. Default = AOV of the last 30 days of actual orders. The owner can edit it. |
| S3 | REPLACED by O3, O5 and O6. ~~Store currency is set at setup and locks after the first sale. A different currency needs a new store (SaaS phase). Extra currencies: ₦ for ad spend (taken from the Meta ad account automatically) and supplier currencies.~~ Still valid: rates are a daily automatic rate, a manual override and a per-day rate history. The stale-rate warning shows only for manual rates. |

## Gap questions (docs/prd/gap-matrix.md §5)
| # | Decision |
|---|---|
| G1 | Keep Paystack. The business will move toward taking online payments (digital now, physical prepaid later). Build payments behind a provider interface so another provider can replace or join Paystack later. ~~Ghana (GH₵, mobile money) must work, not only Nigeria.~~ The Ghana sentence is REPLACED by O2. |
| G2 | Do NOT hide Billing and plans. Keep the Billing tab, plans and plan limits visible. Fix the mockup plan numbers to match the live plans. Multi-store itself stays out until SaaS (D7). |
| G3 | REPLACED by F1–F4 below. There is no separate "agent pay". |
| G4 | A target reward is earned at month close, on delivery-date numbers. |
| G5 | The time-to-first-call clock runs only inside operating hours. The owner enters the hours in Settings → Operations. |
| G6 | Refusals: at 2 refused deliveries mark the customer High risk. At 3 turn COD off for that customer and send the order to a manual call. The owner can override. |
| G7 | REPLACED by O4. ~~Each partner's coverage is entered once, over all 16 Ghana regions. Logiswift is the fallback for anything not covered.~~ |
| G8 | Reports first release: CSV and Excel direct download only. Saved reports, recent exports and PDF come later. |
| G9 | Call reps can create orders and add and edit customers. Add "New order" to the rep Queue. |
| G10 | In the first release, AI suggestion cards never change data. A card opens a pre-filled screen and a person confirms. Direct AI writes start in M12. |

## Review decisions (Opus, PRD review 2026-10-18)
Technical or factual. The PRD must follow them.
| # | Decision |
|---|---|
| R1 | Computed numbers follow the written formula, not the mockup sample (e.g. projected October GH₵167.8k). Mockup samples are illustration only. |
| R2 | Orders needed a day = monthly need ÷ real days in that month (October 31 → 56). Not ÷30. |
| R3 | "Delivered from confirmed" per rep uses closed confirmed orders as the base (NUMBERS.md: 253 ÷ 486 = 52%). |
| R4 | Use the live chart of accounts (commissions payable 2020, not 2100). New accounts: 2040, 2050 (supplier payables), 3010, 5070 (delivery fee, single line), 5080 (ad spend). No 2030 (agent pay removed by F1). One cash account (1015) for cash held by partners; fix the double count. |
| R5 | Fee per delivered order comes from each partner's fee rules, not a fixed GH₵34. Break-even and max CPA use the weighted fee from data. |
| R6 | Rep commission is a line in the P&L. Delivery fees are one line (3PL and agents together), booked once. October margin is about −16% once the commission line is in (formula wins, R1); updated 2026-10-19. |
| R7 | Meta spend: pull hourly for today's spend; re-pull the last 3 days daily for final figures. |
| R8 | Old MessageTemplates component: move stored text into Messages → Templates, then delete it. |
| R9 | Orders from online payment are created after payment succeeds (as today). payment_pending / payment_failed stay in the enum with no creation path in release one. |
| R10 | Time to first call = time to the first rep call attempt, inside operating hours. A customer YES reply to auto-confirm confirms the order and closes the clock (counted as "auto-confirmed", not as a rep call). |
| R11 | Stock may go negative at delivery. It does not block the delivery; it raises a Finding. |
| R12 | Planned AOV default = average value of delivered orders in the last 30 days. |
| R13 | Keep the existing MCP write tool orders_update_status (no regression). New AI writes start in M12. Audit log: API first, screen in M11. |
| R14 | REPLACED by O2 (removed). ~~Payment provider check before promising online payment in Ghana. Check is a P0 task in the payments milestone.~~ |
| R16 | REPLACED by O6. ~~The store currency locks at the first order created (first sale), not the first delivered order. Decided in M1-T31.~~ The store currency does not lock. |
| R15 | Money amount units (depositPaid/balanceDue may be minor units): verify on production data in M0 before the Decimal migration. |

## Delivery fee (owner, 2026-10-18; replaces G3)
| # | Decision |
|---|---|
| F1 | One term: **delivery fee**. Never "agent pay" or "agent fee". The fee is what we pay whoever delivers the order. |
| F2 | Each partner (3PL company or own agent) has one fee rule in Settings: fee per delivered, per failed, per returned order. Sample: Kofi GH₵25 (the fee rule). The GH₵12/GH₵10 "agent pay" sample is removed. |
| F3 | The fee is booked once, as a delivery fee expense, when the outcome happens (delivered / failed / returned). No second expense, no extra P&L line. |
| F4 | Settlement is the same for 3PLs and agents: the partner keeps the fee from the cash they collect and hands in the rest. Expected cash from a partner = cash collected − fees. The 3PL payout and the agent deposit are matched against that net amount. No fee payout through the payout form. |

## PRD review answers (owner, 2026-10-18)
| # | Decision |
|---|---|
| P2 | A "NO" reply to auto-confirm does not cancel. The order goes to the call queue with a "said NO" flag; a rep calls once before cancel. |
| P3 | After the owner overrides COD for a customer, the refusal count restarts at zero. |
| P4 | The auto-confirm message goes out at once, also outside operating hours. Only the rep call clock waits for opening time. |
| P5 | Reps can reply to customers on WhatsApp from the Conversations page. |
| P6 | Commission (GH₵8) is paid only for orders a rep confirms by call. Auto-confirmed orders earn no commission. |
| P7 | Rep target counts confirmed orders that get delivered, counted at month close. |
| P8 | REPLACED by O4. ~~Where partners overlap on a region, the owner sets a priority order; the first partner on the list gets the order (fallback Logiswift per G7).~~ |

## Owner plan-page review (2026-10-18)
The owner reviewed the plan page and made these decisions. They are final. They replace the items named in each row.
| # | Decision |
|---|---|
| O1 | **Logiswift sync is outside the app.** Agents run the sync on a schedule outside the app. The app has no Logiswift settlement endpoint, no signed Logiswift payload, no portal-export task, no reader for Logiswift status words and no "Logiswift sync status" on Connections. The app has ONE generic, partner-agnostic action, "record partner payout" (an API route and an MCP tool), that any agent can call for any delivery partner. It matches the lines to orders, records one deposit for the net amount (F4) and opens a Finding for each gap. Logiswift is one delivery partner like any other: no special code for it. Outside API and MCP keys that exist today keep working (M2-T13). The backfill of the 1,321 draft collections stays (it is app data) and does not need a portal export. Replaces design-doc decision 7 (the extended sync, the connector for Logiswift) and the PRD "signed settlement endpoint" wording. |
| O2 | **Paystack Ghana is not needed now.** Ghana sells by COD. Removed: R14, the GH₵1 test charge (M3b-T01), "Ghana (GH₵, mobile money) must work" in G1, the Paystack Ghana risk and its open items. Paystack stays behind the provider interface and works as today. Replaces R14 and the Ghana part of G1. |
| O3 | **The app is country-agnostic.** At setup the owner picks a country. The store currency is that country's currency (set automatically). Regions come from the chosen country (country-state-city data), not a fixed list of 16 Ghana regions. The app is English only (no Twi or Ga). Money settings (rep commission, reward tiers, fee rules) are entered in the store currency. GH₵ figures stay only as sample values for the Manny Dynamics store. "Naira for ad spend" becomes "the ad account's currency". Replaces D1 (add Twi/Ga later), the setup part of S3, the "16 Ghana regions" list and the fixed regions constant. |
| O4 | **"Assign by region" is a Workflow.** Condition: "Region is X" (workflow conditions already include Region and Country). Action: "Assign to" one or more delivery agents or partners, split Evenly or Weighted. Many agents can serve one region. If no workflow matches, the order stays unassigned for the fulfilment lead. There is no coverage grid on Deliveries, no priority order, no fallback partner and no "Setup incomplete needs a covered region" rule. Replaces G7 and P8. D3 still holds (build "By region" assign), built this way. |
| O5 | **All money shows in the store currency.** An amount in another currency (for example a ₦ Meta ad spend or a supplier invoice) converts at that day's rate. The original amount and its currency stay on the record. D4 (Float to Decimal) is unchanged. |
| O6 | **The store currency is NOT locked.** The owner can change it in Settings at any time. All figures convert with the per-day rate history. Kept from S3: daily automatic rate, manual override, per-day rate history, stale warning for manual rates only. Removed: "currency locks after the first sale", "a different currency needs a new store", the lock rejection test and the open item "currency lock: first order or first delivered". Replaces S3 (lock) and R16. How amounts are stored is in PRD section 5.7. |
| O7 | **No generic partner key in this rebuild** (owner, 2026-10-19). Outside agents (for example the Logiswift sync, which runs outside the app per O1) use the normal API or MCP key, with the permissions they need (for example the payout permission for "record partner payout"). Removed: F-718 (partner key service), F-1214 (partner key card), the `PartnerConnector` model, `/api/connections/partners`, the Connections card CN-14, M5-T09 and M5-T33. A scoped per-partner key may be added later, when a third party (a 3PL company, or a SaaS seller's 3PL) needs to call the API. Replaces the partner key part of O1. |

D5 in plain words (for the plan page): August and September were booked with an older, lower cost per set. They show a +12% margin; October shows about −16%. They are not recalculated. The P&L shows a note on those months.
