# M8 wave 2, lane B: COD-73 task T09 (campaign to product mapping)

Worktree `.claude/worktrees/m8-b`, branch `m8/lane-b` (rebased on `feature/m8-marketing` after T03). Test DB `ecommerce_cod_test_b`: run `prisma migrate deploy` on it first. **No schema changes in this lane** (lane A owns the schema). Backend only; the dialog UI is T16.

Read first: repo `CLAUDE.md`, `docs/plan/M8.md` (lean). Models from T03: `MetaCampaignMapping` (kind `prefix` | `campaign`), `MetaSpendDay`, `MetaAdAccount`, `Product` (`isActive`).

## Build `src/services/marketing/campaignMappingService.ts` + routes `/api/marketing/mappings`
1. `resolveProducts(campaigns: {adAccountId, campaignId, campaignName}[])` -> map of campaign key to `{ productId, productName, via: 'campaign' | 'prefix', archived: boolean } | null`.
   - A one-off pick (`kind=campaign`) wins.
   - Else the longest prefix rule whose `prefix` matches the start of `campaignName`, case-insensitive, after trimming. Example: rule `MG_` maps `MG_ManualCBO | 16032026` to Magic Groove.
   - `archived = !product.isActive`: the mapping still applies; the flag drives a warning.
   - One DB read for rules and one for picks per call (no per-campaign queries).
2. `listCampaigns({ from, to })`: distinct campaigns in `MetaSpendDay` for the range with spend total, resolved product, and `mapped` yes/no. `listUnmapped({from,to})` = the unmapped ones with their spend total (M11 card C-03 and the "Not mapped" strip use this).
3. Routes (tenant scoped, `requireResourcePermission('marketing', ...)`):
   - `GET /api/marketing/mappings` (view): rules and picks with product names and archived flag.
   - `POST /api/marketing/mappings/rules` (update) `{ prefix, productId }`: prefix 1-40 chars, trimmed; duplicate prefix -> 409 "This prefix is already mapped."; product from another tenant -> 404.
   - `PUT /api/marketing/mappings/campaigns` (update) `{ adAccountId, campaignId, productId }`: upsert a pick. `productId: null` deletes the pick.
   - `DELETE /api/marketing/mappings/rules/:id` (update).
   - `GET /api/marketing/campaigns?from&to` (view): `listCampaigns`. `GET /api/marketing/campaigns/unmapped?from&to` (view).
   - Validate with the project's existing validation style (look at a recent M6/M7 route).

## Tests
- Unit: pick beats rule; longest prefix wins (`MG_` vs `MG_T`); case-insensitive; no match -> null; archived flag.
- Integration (`ecommerce_cod_test_b`): create rule, list campaigns with seeded `MetaSpendDay`, pick overrides rule, delete rule, unmapped list and spend total, duplicate prefix 409, two-tenant isolation, call rep 403, marketing:view-only user cannot write.

## Checks
`npx prisma generate && npx tsc --noEmit && npm run lint`, unit tests, the new test files by name, `--runInBand --forceExit`. Never the full suite.

## Report
One commit `feat(M8): campaign to product mapping service (COD-73)`. Do not push. Reply: sha, files, check output, changes from spec and why.
