# M8 wave 1, lane A: COD-71 task T03 (schema)

Worktree: `.claude/worktrees/m8-a`. Branch `m8/lane-a` (from `feature/m8-marketing`). Test DB `ecommerce_cod_test_a` (docker container `ecommerce-postgres-dev`, user `ecommerce_user`). You are the only lane that changes the schema.

Read `codadmin/CLAUDE.md` (repo `CLAUDE.md`) and `docs/plan/M8.md` (lean) and `docs/plan/M8-T01-meta-access.md` first.

## Setup
1. `cd backend && npm ci` if `node_modules` is missing (do not download anything else).
2. Bring `ecommerce_cod_test_a` up to the current migrations: `DATABASE_URL=postgresql://ecommerce_user:<pw from backend/.env.test>@localhost:5432/ecommerce_cod_test_a npx prisma migrate deploy`.

## Task T03: one migration `m8_marketing`
Follow existing schema conventions (look at `Expense`, `FxRate`, `Finding`, and how M5-M7 models declare `tenantId`). Every new model: required `tenantId` + `Tenant` relation (`onDelete: Cascade`), `@@index([tenantId])`, snake_case `@map`/`@@map`, and add it to the tenant-scoped model list in `src/utils/prismaExtensions.ts`. Money is `Decimal @db.Decimal(19, 4)`. Add the back-relations on `Tenant`.

1. `MetaAdAccount`: one row per connected ad account.
   - `id`, `tenantId`, `accountId` (string, `act_...`), `name`, `currency` (VarChar 3, from Meta), `timezone` (string, from Meta), `enabled` (bool, default true), `status` enum `MetaConnectionStatus` { connected, disconnected } default connected, `statusReason` String?, `accessToken` (String, stored encrypted with the existing `enc:v1:` helper; the field only holds ciphertext), `tokenType` String? ("system_user" | "user"), `tokenExpiresAt` DateTime?, `scopes` String[] default [], `connectedById` Int? (User), `lastPulledAt` DateTime?, `lastPullError` String?, `failedPullCount` Int default 0, `createdAt`, `updatedAt`.
   - `@@unique([tenantId, accountId])`.
2. `MetaSpendDay`: campaign level, one row per (account, campaign, date).
   - `id`, `tenantId`, `adAccountId` (FK MetaAdAccount, Cascade), `campaignId` String, `campaignName` String, `campaignStatus` String? (Meta effective status), `date` (`@db.Date`), `currency` VarChar 3, `spend` Decimal, `impressions` Int, `linkClicks` Int, `landingPageViews` Int, `checkoutsStarted` Int, `pulledAt` DateTime, `source` enum `MetaSpendSource` { api } default api.
   - `@@unique([adAccountId, campaignId, date])`, `@@index([tenantId, date])`.
3. `MetaCampaignMapping`: either a prefix rule or a one-off pick.
   - `id`, `tenantId`, `kind` enum `MetaMappingKind` { prefix, campaign }, `prefix` String? (for kind prefix), `adAccountId` Int? + `campaignId` String? (for kind campaign), `productId` Int (FK Product), `createdById` Int?, `createdAt`, `updatedAt`.
   - `@@unique([tenantId, kind, prefix])`, `@@unique([tenantId, adAccountId, campaignId])`. Postgres treats NULLs as distinct, so both uniques are safe.
4. `Order`: add `utmCampaign String? @map("utm_campaign")`, `utmContent String? @map("utm_content")`, and `@@index([tenantId, utmCampaign])`.
5. `Expense`: add `originalCurrency String? @db.VarChar(3)`, `originalAmount Decimal? @db.Decimal(19, 4)`, `fxRate Decimal? @db.Decimal(19, 8)`, plus `metaAdAccountId Int?` (FK MetaAdAccount, SetNull) and `@@unique([metaAdAccountId, expenseDate])` so there is one Meta expense per (account, day). Existing rows keep NULLs.
6. `FindingType`: add `fx_missing` only if it is not there yet.

Do NOT add `FormVisitDay`, `FormSubmission.device`, ad-level fields, or `MetaConnection` (the connection lives on `MetaAdAccount`). They are cut from lean M8.

## Checks (all must pass, paste the output in your report)
- `npx prisma format`, `npx prisma migrate dev --create-only --name m8_marketing` against a scratch DB, or write the SQL by hand; then `npx prisma migrate deploy` on `ecommerce_cod_test_a`.
- `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <ecommerce_cod_test_o url> --exit-code` shows no drift.
- `npx prisma generate && npx tsc --noEmit && npm run lint`.
- `npx jest --runInBand --forceExit src/__tests__/unit` (unit only; never the full suite).
- A short unit test that every new model name is in the scoped list.

## Report
One commit: `feat(M8): marketing schema (MetaAdAccount, MetaSpendDay, MetaCampaignMapping, order UTM, expense FX) (COD-71)`. Do not push. Reply with: commit sha, migration folder name, check output, anything you changed from this spec and why.
