# M5-T30 backfill: staging counts

Script: `backend/scripts/backfill-collections-fees-aging.ts`. Logic: `backend/src/services/collectionsBackfillService.ts`. Test: `backend/src/__tests__/integration/m5CollectionsBackfill.test.ts`.

Run on `ecommerce_cod_staging_m5` (fresh copy of the production copy, then `prisma migrate deploy`). Date of run: 2026-10-27. Nothing ran on production.

## What the script does

- Dry run is the default. It prints counts and sums and writes nothing. `--apply` writes.
- A draft collection is reconciled only when the app shows its cash was paid. The partner's recorded deposits must be larger than the partner's reconciled and deposited collections. The surplus pays the oldest delivered drafts first, whole collections only. The cash held is not touched, because the deposits already took it down.
- A draft with no such cover is true unpaid cash and stays a draft.
- Fees: a delivered, failed or returned order on or after 2026-10-01 with no fee gets the fee from its partner's rule. It posts DR 5070 / CR 1015 dated the outcome date. An open collection goes down by the fee, like a new one. A partner with no rule is left alone.
- Aging is read live from the open collections, so there is nothing to store. The script prints the aging card before and after.
- August and September ledger rows are never written. The script compares them before and after and exits with code 1 on any change.
- A second `--apply` changes nothing.

## Result on the copy

The 1,321 figure does not hold. The copy has 1,323 draft collections for the company-1 tenant (1,315 on delivered orders). The app holds no evidence that any of them was paid, so none is reconciled. The cash held already equals the drafts. The drafts are true unpaid cash in the app's own books.

| Measure | Before | After `--apply` | Second `--apply` |
|---|---|---|---|
| Draft collections, company-1 | 1,323 (GH₵232,030.00) | 1,323 (GH₵232,030.00) | 1,323 |
| True unpaid (draft on delivered order) | 1,315 (GH₵230,830.00) | 1,315 (GH₵230,830.00) | 1,315 |
| Drafts not on a delivered order (left alone) | 8 (GH₵1,200.00) | 8 | 8 |
| Drafts covered by recorded deposits | 0 | 0 | 0 |
| Draft collections, all tenants | 1,699 | 1,699 | 1,699 |
| Aug ledger, company-1 | 1,288 entries, 5,759 lines, debit 312,195.00 | same | same |
| Sep ledger, company-1 | 1,880 entries, 6,316 lines, debit 401,134.00 | same | same |
| Aug and Sep entries, all tenants | 3,942 (debit 1,103,809.00) | same | same |
| All journal entries | 10,795 | 10,795 | 10,795 |
| Fees stamped | 0 | 0 | 0 |

Aging card, company-1 (net of delivery fee), unchanged by the run: 1,315 orders, GH₵230,830.00. Buckets 0-3: 0. 4-7: 1 (130.00). 8-14: 119 (19,870.00). 15+: 1,195 (210,830.00).

## Cash held per partner (company-1)

Rule: cash held equals collected minus recorded deposits (collections are held net of the fee, so the fee is already inside). Limit: 5% of collected (the settlement variance limit).

| Partner | Collected | Fees inside | Recorded deposits | Expected | Held | Difference | Within limit |
|---|---|---|---|---|---|---|---|
| 4 | 257,690.00 | 0.00 | 257,690.00 | 0.00 | 330.00 | 330.00 | yes (0.13%) |
| 5 | 755,870.04 | 0.00 | 523,840.04 | 232,030.00 | 232,200.00 | 170.00 | yes (0.02%) |

The two gaps (330 and 170) equal how far `AgentBalance.totalCollected` sits above the sum of the partner's collections (258,020 against 257,690; 756,040.04 against 755,870.04). They are old balance drift, not caused by the backfill.

## Not reconciled, and why

- The 1,323 drafts (the plan says 1,321): no app data says they were paid. No deposits or settlements exist on the copy (`agent_deposits` and `partner_settlements` are empty). Only a portal export or a recorded partner payout can clear them.
- October fees: the copy has no fee rule (`fee_rules` is empty), so 562 company-1 outcomes since 1 October are left unstamped (442 delivered, 45 returned, the rest failed). Stamping 0 would lock them. Enter the rules first, then run `--apply`.
- The fixture tenant (`fixture-numbers`, 376 drafts, GH₵92,000) shows cash held above collected for four partners (seed data). The limit check fails there. It is not a real tenant.
- 8 drafts sit on cancelled, returned or failed orders (GH₵1,200.00). They are not in aging. There is no void status, so they are left for an owner decision.
