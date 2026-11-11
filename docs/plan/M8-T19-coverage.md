# M8-T19 coverage note

One row per T19 criterion. Paths are under `backend/src/__tests__/`.

| Criterion | File | Test |
|---|---|---|
| Fixture numbers (parse, paging, status) | `unit/metaInsightsService.test.ts` | `parseInsightRow` reads link clicks, landing views, checkouts and purchases; `fetchCampaignInsights` follows paging, adds status |
| Fixture numbers (end to end: 94,700.65 NGN, 845.54 GHS) | `integration/m8EndToEnd.test.ts` | tenant A: the job writes MetaSpendDay and one expense per (account, day); 5080 equals the converted spend |
| Fixture numbers (max CPA, tiles) | `integration/marketingKpi.test.ts`, `unit/marketingKpiMath.test.ts` | max CPA account level: GH₵185 profit gives GH₵62.90 = ₦7,040; tiles spend equals the 5080 ledger total |
| Job idempotency (pull) | `integration/metaInsightsPull.test.ts`, `integration/metaPullJob.test.ts` | pulling twice leaves the same rows; running it twice changes no row |
| Job idempotency (job, ledger, balances) | `integration/m8EndToEnd.test.ts` | running the job again changes no row, expense, entry or balance |
| FX and ledger | `integration/metaLedger.test.ts`, `unit/metaLedgerConvert.test.ts` | missing rate; first post DR 5080 / CR 1010; re-run changes nothing; raised/lowered spend; mix of changes |
| FX and ledger (job path, difference entry) | `integration/m8EndToEnd.test.ts` | one day changes in Meta: exactly one new entry with the difference |
| Mapping | `integration/campaignMapping.test.ts`, `unit/campaignMappingResolve.test.ts` | a pick beats the rule; longest prefix wins; unmapped list |
| Max CPA | `integration/marketingKpi.test.ts`, `unit/campaignStatus.test.ts`, `integration/marketingFunnel.test.ts` | per product; no closed cohort; no room for ads; status lines at 85% and max CPA |
| Two-tenant | `integration/m8EndToEnd.test.ts` (new), plus `campaignMapping`, `marketingFunnel`, `marketingKpi`, `metaAdsConnection`, `metaLedger` | tenant B data never appears in any tenant A response (summary, funnel, performance, unmapped, campaigns, accounts) |
| Token secrecy (API output) | `integration/m8TokenSecrecy.test.ts` (new) | no GET or POST under /api/meta-ads or /api/marketing carries the token |
| Token secrecy (failure paths) | `integration/m8TokenSecrecy.test.ts` (new) | error 190; rate limit to exhaustion, twice; network error with URL holding access_token |
| Token secrecy (existing) | `integration/metaAdsConnection.test.ts`, `unit/metaInsightsService.test.ts` | no response body and no log line contains a token; 190 records a plain error without the token |

Gaps filled by the two new files: job-level idempotency with ledger and balances, the one-difference-entry run through the job, a combined two-tenant sweep, and token secrecy across every route and every pull failure path.
