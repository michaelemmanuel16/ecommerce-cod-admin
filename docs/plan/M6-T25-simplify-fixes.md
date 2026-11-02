# M6-T25: whole-milestone /simplify fixes

Source: /simplify over `git diff origin/develop...HEAD` (app code: backend/src, frontend/src, backend/prisma; tests excluded) at 70992194, 2026-11-02. Four reviews (reuse, simplification, efficiency, altitude), deduplicated here.

Rules for both lanes:
- No behaviour change unless an item says so. The API may gain fields; no field is removed.
- Grep for callers (backend/src, backend/scripts, frontend/src, e2e, scripts, mcp, tools, and the test folders) before every delete or un-export. Put the evidence in the report.
- If a test imports something you un-export, keep the export. If an item turns out wrong or bigger than described, skip it and say why.
- Local checks only (CI runs the full suite): see "Checks" at the end. Never run the full integration suite locally.

Two lanes, no shared files:
- **Lane A (backend + full-stack items):** items 1–30. Worktree `.claude/worktrees/m6-a`, test DB `ecommerce_cod_test_a`. Owns all backend files and these frontend files: `pages/staff/roleModel.ts`, `pages/staff/model.ts`, `pages/staff/RoleCards.tsx`, `pages/staff/RewardRule.tsx`, `pages/staff/TeamTable.tsx`, `pages/staff/PayCard.tsx`, `pages/targets/*`, `pages/Targets.tsx`, `pages/northStar/*`, `services/staff.service.ts`, `services/roles.service.ts`, `services/targets*.ts`, `utils/people.ts`.
- **Lane B (frontend-only):** items 31–37. Worktree `.claude/worktrees/m6-b`, test DB `ecommerce_cod_test_b`. Owns `pages/Leaderboard.tsx`, `pages/leaderboard/*`, `pages/dashboard/blocks/TopThisMonth.tsx`, `pages/dashboard/format.ts`, `pages/AcceptInvite.tsx`. Do not touch lane A files.

## Lane A

### Efficiency
1. `middleware/auth.ts:32` + `permissionService.ts` (`isUserActive`): no DB query per request on a cache hit. Keep `active` in the held cache entry (same TTL). Call `invalidateAccess` for that user on deactivate, delete and erase, so a deactivated user is refused on the next request as today. Add a test: deactivate, next request is 401/403.
2. `permissionService.ts` (`heldGrid`, `isUserActive` miss paths): cache the in-flight promise per (tenant, user), like `matrixCache`.
3. `permissionService.ts:42-49` (`loadMatrix`): `systemConfig.findFirst` and `role.findMany` in one `Promise.all`.
4. `navService.ts:122-135` (`getShell`): reuse the held grids already loaded for the permission union; take `preferences` from data already loaded if available. One fewer read of role assignments.
5. `periodCloseService.ts:169` + `badgeService.ts`: compute the wanted badges before the `$transaction`; inside keep only `createMany` and counts. Run families and earlier months with `Promise.all`; one `boardBase` per family per month. Same badges (existing tests).
6. `northStarService.getTree`: run `actualsOf` only when the caller needs actuals (flag or a separate `/targets/roles?month=` route). Staff `RoleCards` uses the light form. Targets page unchanged.
7. Targets batch save: add `POST /targets/batch` over the existing `saveTargets`/`saveMany` (same permission gate as the single save). `northStar/StepDrivers.tsx:80-88` uses it in one call instead of N serial POSTs. Test: batch saves the same rows as N single saves.
8. `useBlock` keys: one key per endpoint and arguments across `Targets.tsx`, `staff/RoleCards.tsx`, `staff/RewardRule.tsx` (for example `tree|${month}`, `rewards`, `attainment|${month}`), so the cache and in-flight de-dup work.
9. `assignmentCursor.ts:58-63`: `SELECT … FOR UPDATE` first; create the row only when none comes back (or one `INSERT … ON CONFLICT … RETURNING`). Same pick order (existing tests).
10. `rolePermissionService.saveMatrix`: guards first, then one `$transaction` of updates, then one `invalidateAccess()`.
11. `dashboardService.ts:401` (`topThisMonth`): cache by `tenant|month` (small TTL map), not per range key.
12. `leaderboardService.ts:258`: group `badgeRows` by user once into a `Map`.
13. `schema.prisma` `CommissionEntry`: add `@@index([tenantId, kind, period])` in a new migration `20261102100000_m6_commission_period_idx`. Apply by hand to `ecommerce_cod_test_a` first. Index only.

### Reuse
14. `leaderboardService.ts:55`: use `daysInMonth` from `kpi/dates.ts`.
15. Month parsing: add `parseMonth` (and `shiftMonth` if needed) to `kpi/dates.ts`; use it in `leaderboardService.ts:44`, `badgeService.ts:26`, `northStarService.ts:34` (`monthParts`), `targetService.ts:98`.
16. `pairKey`: one export (in `leaderboardMath.ts`) used by `leaderboardService.ts:73` and `periodCloseService.ts:46`; use it where `roleAssignmentService`/`inviteService` build `${userId}:${roleId}`.
17. Local `money` aliases (`targetService.ts:78`, `northStarService.ts:299`, `leaderboardService.ts:234`, `rewardService.ts:265`): call `Money.toApi` / `Money.formatWithSign` directly.
18. `sessionService.signIn` tenant-less branch: use `claims(user)` from the same file if the output is the same.
19. Avatar tint: one `avatarClass(kind, id, tones = AVATAR_TONES)` in `utils/people.ts`. Use it in `staff/roleModel.ts:103`, `targets/RoleGroups.tsx:32`, `staff/TeamTable.tsx`, `staff/PayCard.tsx`. Same colours on screen (keep a page's own tone list if it differs). Lane B uses it in leaderboard and TopThisMonth after lane A merges; lane B must NOT edit `utils/people.ts`.
20. `services/staff.service.ts:85` and `services/roles.service.ts:79`: one `quiet` constant.

### Dead code and exports
21. Delete `rewardService.getRepPay` (test-only caller: move or delete that test case).
22. Delete `targetService.rolePool` and `roleHolderTargets`; tests call `roleViews`. Fix the comment at line ~586.
23. Delete `leaderboardMath.rankPercent`.
24. `controllers/helpers.ts:7`: delete the stale "role controller keeps its own copies" sentence.
25. Un-export the names in review items 10–14 that nothing imports outside their file (list in the report): `feeNotEditable`, `HolderStatus`, `STAFF_STATUSES`, `INVITE_CHANNELS`, `CURRENCY_SIGN`, the types and constants listed below, `yearQuarterRows`, `quarterTargetsOf`, `chipText`. Keep any a test or script imports.
    - Types: `CursorCandidate`, `InviteStaffInput`, `InviteDelivery`, `YearPlan`, `PaceMarker`, `YearPaceInput`, `YearPace`, `PeriodKind`, `PeriodSpec`, `CalculatorInput`, `PlannedReward`, `RewardMessageInput`, `ChildInput`, `YearPlanResult`, `ReleasedTargets`, `StatusInput`, `UpdateStaffInput`, `UpdateUserInput`, `DeliveredFee`; FE `NewRole`, `AssignBody`, `InviteBody`, `StaffPatch`, `WorkloadRow`, `HolderKind`, `CalculatorParams`, `SaveTargetInput`, `FormErrors`, `TargetDialogProps`, `TierView`.
    - Constants: `CONTRACT_REVIEW_BELOW`, `CONTRACT_REVIEW`, `NEAR_EMPTY_BELOW`, `NEAR_EMPTY_NOTE`, `NO_ACTIVITY_NOTE`, `REVENUE_METRIC`, `DRIVER_METRICS`, `DEFAULT_CONFIRMATION`, `DEFAULT_DELIVERY_SUCCESS`, `DEFAULT_NET_MARGIN`, `DAY_OFF_NOTE`, `TOP_TIER`, `REP_PAY_DEFAULTS`, `SETTINGS_NOTICE`, `heldAssignmentSelect`, FE `NEEDS_SETTINGS`.
26. `middleware/auth.ts` (`PERMISSION_DEBUG` block in `requireResourcePermission`): remove the env-flag branch; log the evaluated grid at debug level inside the permission check if useful.

### One source for rules the API owns (no behaviour change)
27. Tool catalog: the API returns `ROLE_TOOLS` (key, label, kind) in the existing roles/permissions response. `staff/roleModel.ts` `TOOLS` and its copy of `sameGrid` go; use the API list and the API `custom` flag. Same switches on screen.
28. Pay policy: each role row in the roles API carries `payPolicy` (`methods`, `defaultMethod`, `amountEditable`) from `staffService.payPolicyFor`. `staff/model.ts` (`isDeliveryRole`, `payChoices`) reads it. Same form behaviour.
29. Role attainment: `/targets/tree` returns `roleAttainment` (done, target, percent, status) per role, computed once on the server with the current frontend rule ("behind wins"). `targets/model.ts` `buildGroups` and `staff/roleModel.ts` `roleProgress` render it. Same numbers (port the existing frontend tests to the server function).
30. `targets/model.ts`: inline or un-export `chipText` (item 25) if no test needs it.

## Lane B

31. `Leaderboard.tsx`: build `BadgesCard` from `rows[].badges`; drop the third (badges) request if the rows carry the same data. Fetch the hidden role's board only if its tab count is shown; if the count needs the whole board, keep it and say so.
32. `Leaderboard.tsx:51-53`: one `isMonth` test for `withRewards` and `badgePeriod`.
33. `Leaderboard.tsx:50` + `leaderboard/model.ts:40`: drop `ranksFirst`; use the API order (the API test pins the order; check it exists, else keep and say so).
34. `AcceptInvite.tsx:16-17`: use `apiErrorMessage` from `utils/apiError.ts`.
35. `kindTag`: one export in `leaderboard/model.ts`; `TopThisMonth.tsx` imports it.
36. `initials`: M6 callers use one function. Keep the empty-name behaviour each caller's tests expect; if the two differ in a way a test pins, leave it and say so.
37. After lane A's item 19 is merged into the M6 branch (Opus tells you), use `avatarClass` from `utils/people.ts` in `leaderboard/model.ts` (`avatarTone`) and `TopThisMonth.tsx`. Same colours.

## Skipped (with reason)
- Altitude items that change who can do what (targets gate on `targets:*` cells, one menu table for seeded roles, one `assertMayGrant`, route-vs-service Owner rule, `positionOf` column, one permission store, `measured` via `Role.targetMetric`, `setupNorthStar` on a cell, removing the legacy matrix endpoint, active check in `sessionService`, invalidation in a write wrapper): behaviour or API change; to the backlog for the owner (m2-backlog item 15).
- `daysToPayOf` as raw SQL: correctness risk on the money path; backlog.
- `/targets/daily?metrics=`: few metrics; low value.
- Staff page six modal states into one: UI refactor, low value now.
- `formatCount`/`toLocaleString`/`pct` formatters: locales and rounding differ; leave.
- `useDebounced` effect hook, `splitName` x3, `bcrypt` cost helper, `startOfUtcDay` file: low value or behaviour differs.
- Accept-invite password rule weaker than reset (`min(8)`): not a cleanup; passed to /cso.

## Checks (each lane)
Backend: `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, and each touched integration test file run alone (`npx jest --config jest.integration.config.js <file> --runInBand --forceExit`) against your lane's test DB. Frontend: `npx tsc --noEmit` (no new errors), `npm run lint`, `npx vitest run <touched test files>`. No builds, no full suite (CI runs them). Commit on your lane branch; report the sha, check output, and grep evidence for each delete. Do not push. Do not merge.
