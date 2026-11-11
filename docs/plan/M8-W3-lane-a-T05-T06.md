# M8 wave 3, lane A: COD-71 tasks T05 (insights pull) + T06 (daily job, Refresh now)

Worktree `.claude/worktrees/m8-a`, branch `m8/lane-a` (reset to `feature/m8-marketing` after the T04 merge). Test DB `ecommerce_cod_test_a`. **No schema changes.** Backend only (the card UI is T17). Lane B is building `src/services/marketing/metaLedgerService.ts` (T07, `postMetaSpend(adAccountId, dates)`) and the expense lock: do not touch those. If T07 is not merged when you reach step T06.3, call it through a one-line import and leave a `// T07` note; the merge will connect it.

Read first: repo `CLAUDE.md`, `docs/plan/M8.md` rows T05 and T06, `docs/plan/M8-T01-meta-access.md` (fields, rate limits). Reuse: `metaOAuthService.ts` (`ADS_GRAPH_API_VERSION`/`ADS_GRAPH_API_BASE`, token in a header like `fetchAdAccounts`), `metaTokenHealthService.ts` (`metaAdsApiError(adAccountId, err)`, `checkAdsTokens`), `providerCrypto` `decryptString`, `src/utils/tenantLoop.ts` `forEachTenant`, an existing Bull queue as the pattern (`src/queues/fxRateQueue.ts` is the closest: daily repeat job with a timezone), `notificationService.createNotification` + `findTenantAdmins`.

## T05: `src/services/marketing/metaInsightsService.ts` (one commit)
1. `fetchCampaignInsights(token, accountId, since, until)`: `GET /act_<id>/insights` on v25, `level=campaign`, `time_increment=1`, `time_range={since,until}`, fields `account_currency,campaign_id,campaign_name,date_start,spend,impressions,inline_link_clicks,actions`, `limit=500`, follow `paging.next`. Do not set attribution (account default). Also fetch `effective_status` of the campaigns in the result with one `GET /?ids=...&fields=effective_status` call (batched by 50).
2. Parse each row: `linkClicks = inline_link_clicks`, from `actions`: `landing_page_view`, `offsite_conversion.fb_pixel_initiate_checkout` (checkouts; do NOT add `omni_initiated_checkout`), `offsite_conversion.fb_pixel_purchase` (purchases). Missing values are 0. `spend` as a decimal string (money helper, no float math).
3. Backoff: on HTTP error codes 4, 17, 613, 80000 (any subcode), or `X-Business-Use-Case-Usage` `call_count` >= 90: wait and retry (2s, 8s, 30s; inject the sleep for tests), then throw a `MetaRateLimitError`. Error 190 or `OAuthException` code 190: call `metaAdsApiError(adAccountId, err)` and stop this account.
4. `pullAccount(adAccountId, days = 3)` inside tenant context: dates = the last `days` days **in the account's timezone** (today included). Upsert `MetaSpendDay` on `(adAccountId, campaignId, date)` with all fields, `currency` = `account_currency`, `pulledAt` now. A campaign present before but missing now keeps its rows (never delete). Set `lastPulledAt`, clear `lastPullError`, `failedPullCount = 0` on success; on failure set `lastPullError` (plain words, no token, no raw URL) and `failedPullCount + 1`. Skip accounts that are `enabled=false` or `status=disconnected`. Return the dates pulled.
5. Tests (unit, Meta HTTP mocked with a recorded-shape fixture in `src/__tests__/fixtures/metaInsights.json`; base it on the T01 fields): parse incl. purchases; paging; rate-limit then success keeps every day; 190 marks disconnected; deleted campaign keeps rows; re-pull same data changes no row (counts + values); timezone date window. Integration on `_a`: pull twice, same rows.

## T06: daily job + Refresh now (second commit)
1. `src/queues/metaPullQueue.ts`: repeat job **05:00 Africa/Accra** daily, registered at boot next to the other queues. For each tenant (`forEachTenant`, tenant context), each enabled connected account: `pullAccount(id, 3)`, then `postMetaSpend(id, dates)`. One tenant or account failing does not stop the others (catch, log without token, continue).
2. Token health: same job runs `checkAdsTokens()` per tenant before the pulls.
3. Alert: when an account reaches `failedPullCount === 2`, notify owner and admins once ("Meta Ads pull failed twice for <account name>. Check Settings, Integrations."). No repeat at 3, 4...; reset at success.
4. `POST /api/meta-ads/accounts/:id/refresh` (marketing:update), rate limit 1 per account per 5 minutes (429 "Refresh again in a few minutes."): runs `pullAccount` + `postMetaSpend` now, returns `{ lastPulledAt, days, lastPullError }`.
5. Tests: fake-clock test that the repeat rule is 05:00 Africa/Accra; running the job twice changes no row; a failing tenant does not stop the next; alert fires once at 2 failures; refresh 429 on the second call; call rep 403.

## Checks
`npx prisma generate && npx tsc --noEmit && npm run lint`, `npx jest --config jest.unit.config.js --forceExit`, new/changed test files by name with `--runInBand --forceExit`. Never the full suite. Time-box jest runs.

## Report
Two commits: `feat(M8): Meta insights pull (COD-71)` and `feat(M8): daily Meta pull job and Refresh now (COD-71)`. Do not push. Reply: shas, files, check output, changes from spec and why.
