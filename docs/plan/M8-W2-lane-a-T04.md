# M8 wave 2, lane A: COD-71 task T04 (Meta Ads connection + token health)

Worktree `.claude/worktrees/m8-a`, branch `m8/lane-a` (rebased on `feature/m8-marketing` after T03). Test DB `ecommerce_cod_test_a`. Backend only; the card UI is T17.

Read first: repo `CLAUDE.md`, `docs/plan/M8.md` (lean), `docs/plan/M8-T01-meta-access.md`. Existing code to reuse: `src/services/metaOAuthService.ts`, `src/controllers/whatsappOAuthController.ts`, `src/services/whatsappTokenRefreshService.ts`, the `enc:v1:` string helpers (`encryptString` / `decryptString`, used by `metaCapiService.ts`), `notificationService.createNotification`, the `marketing` resource in `src/config/defaultRolePermissions.ts`, `requireResourcePermission`.

## Rules
- **Do not change the WhatsApp login behaviour.** Its URL, scopes, callback and stored token stay the same. A unit test pins the WhatsApp auth URL.
- Ads Graph calls use `v25.0` (new constant `ADS_GRAPH_API_VERSION`). WhatsApp keeps `GRAPH_API_VERSION` v21.
- A token is never logged, never returned by any API, never put in a redirect URL.
- Keep it small. No new abstractions beyond what is listed.

## Build
1. **OAuth state**: move the in-memory CSRF state store out of `whatsappOAuthController.ts` into `src/utils/oauthState.ts` (`createOAuthState(payload)`, `consumeOAuthState(state)`, same 10-minute expiry and cleanup). WhatsApp uses it with no behaviour change. Meta Ads uses it too.
2. **`metaOAuthService.ts` additions**:
   - `generateAdsAuthUrl(redirectUri, state)`: if `META_ADS_CONFIG_ID` is set, Facebook Login for Business: `config_id`, `response_type=code`, `override_default_response_type=true` (system user token). Otherwise `scope=ads_read,business_management`.
   - `getAdsRedirectUri()` = `${BACKEND_URL}/api/meta-ads/oauth/callback`.
   - `debugToken(token)` using the app token `${META_APP_ID}|${META_APP_SECRET}` -> `{ isValid, type, expiresAt (Date|null; 0 = never), scopes: string[] }`.
   - `fetchAdAccounts(token)`: `GET /me/adaccounts?fields=account_id,name,currency,timezone_name,account_status` with paging.
3. **New `src/services/metaAdsConnectionService.ts`** and controller + routes `src/routes/metaAdsRoutes.ts` mounted at `/api/meta-ads`:
   - `POST /oauth/initiate` (marketing:update) -> `{ authUrl }`. State payload holds userId and tenantId.
   - `GET /oauth/callback` (public, `apiLimiter`, mounted in `server.ts` next to the WhatsApp callback): consume state, exchange code; for a user token exchange to long-lived (`exchangeForLongLivedToken`). `debugToken` it. Missing `ads_read` -> redirect with the missing scope named. Keep the token **encrypted** in a short-lived pending store (Redis key with 10 min TTL if Redis is used elsewhere for this; else in the `oauthState` store) keyed by a new pick id. Redirect to `${FRONTEND_URL}/settings?tab=integrations&section=meta-ads&metaAds=pick&pick=<id>` (or `metaAds=error&message=...`).
   - `GET /oauth/pick/:pickId` (marketing:update): the ad accounts from `fetchAdAccounts` (id, name, currency, timezone, already connected yes/no). No token.
   - `POST /oauth/pick/:pickId` (marketing:update) `{ accountIds: string[] }`: upsert `MetaAdAccount` per id for the tenant: encrypted token, `tokenType` (`system_user` | `user`), `tokenExpiresAt`, `scopes`, currency and timezone from Meta, `status=connected`, `statusReason=null`, `connectedById`. Re-connecting an existing account replaces its token (this is "Reconnect"). Consumes the pick.
   - `GET /accounts` (marketing:view): rows without the token: id, accountId, name, currency, timezone, enabled, status, statusReason, tokenType, tokenExpiresAt, lastPulledAt, lastPullError.
   - `PATCH /accounts/:id` (marketing:update) `{ enabled }`.
   - `DELETE /accounts/:id` (marketing:update): delete the row (its `MetaSpendDay` rows go with it by cascade; the posted expenses keep their ledger entries, FK set null). For a `user` token used by no other row, call `revokeToken`.
4. **Token health** (`src/services/metaTokenHealthService.ts`):
   - `checkAdsTokens()` inside a tenant context: for each distinct token, `debugToken`. Invalid, or `ads_read` missing, or expired -> every row with it: `status=disconnected`, `statusReason` (plain words: "Meta access was removed. Reconnect Meta Ads." / "Missing permission: ads_read"). A user token expiring within 7 days -> `statusReason` "Expires on <date>. Reconnect Meta Ads." (status stays connected). Valid again -> `connected`, reason null.
   - Alert: when a row **changes** to disconnected or to the 7-day warning, `createNotification` to the tenant's owner and admins once (no repeat while the state stays the same).
   - `metaAdsApiError(err)`: a pull or call that gets Meta error 190 (invalid token) marks the account disconnected through the same path. T05 calls it.
   - WhatsApp: in `refreshTokenIfNeeded`, when the refresh fails, notify owner and admins ("WhatsApp connection could not refresh. Reconnect WhatsApp in Settings."). At most one per tenant per day (store `oauthRefreshFailedAt` in the provider JSON and skip if it is today). Clear it on success. Nothing else in that file changes.
   - Scheduling is T06. Export the functions only.
5. **Permissions**: confirm the default grid gives `marketing:update` to Owner and the Marketing role, and `marketing:view` to Owner, Admin, Manager, Marketing. If the Marketing role grid lacks it, add it (this is T13). Call rep denied.

## Tests (Meta HTTP mocked; no real calls)
- Unit: WhatsApp auth URL unchanged (pinned); ads URL with and without `META_ADS_CONFIG_ID`; `debugToken` parsing (expires_at 0 -> null); health transitions and one-alert-per-change; WhatsApp refresh-failure alert once per day.
- Integration (`ecommerce_cod_test_a`): initiate -> callback -> pick list -> save -> list; missing scope redirect; PATCH toggle; DELETE; reconnect replaces token; two-tenant isolation (tenant B cannot see or change A's accounts); call rep gets 403; **no response body and no log line contains the token** (spy on logger, search JSON).

## Checks
`npx prisma generate && npx tsc --noEmit && npm run lint`, unit tests, and the new/changed test files by name, with `--runInBand --forceExit`. Never the full suite.

## Report
One commit `feat(M8): Meta Ads connection and token health (COD-71)`. Do not push. Reply: sha, files, check output, anything changed from this spec and why.
