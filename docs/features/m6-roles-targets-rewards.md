# M6 Roles, Targets and Rewards

Milestone M6 of the CodAdmin rebuild: roles, targets, rewards. Roles and permissions are per tenant. The owner sets a North Star once and sees targets split by quarter, month, role and person. Staff are invited, not created with a password. Rewards are earned at month close. Plan: `docs/plan/M6.md`.

---

## COD-56 — Roles schema and position roles
**Date:** 2026-10-31 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-56-t01-schema`, merge 4b94e839; lane `m6/cod-56-t02-roles`, merge 9f5d6553) | **Commits:** 74a32f45, 0a868128, 7bf68cb0, af56bb6a, d11b7c65

### Summary
Schema for roles, rewards, badges and invites, then the system roles and the move of every user to a position role. Plan tasks: M6-T01, M6-T02. Partial: T01, T02 done; the issue is still In Progress.

### Changes
- **Database (`20261031100000_m6_roles_targets_rewards_schema`):** new tables `reward_tiers`, `badge_awards`, `assignment_cursors`, all with a required `tenant_id` and in the tenant-scoped list (`prismaExtensions.ts`). `roles` gets `permissions` (JSONB, the fine grid; the 16 tool switches stay in `tools`), `preset_role` and `target_metric`. `Role.isSystem` keeps its old meaning: the integration role hidden from staff. `users` gets `invited_at`, `invite_token_hash` (unique, only the hash is stored) and `invite_expires_at`. `targets` gets `source` (default `auto`) and a role foreign key. `commission_entries` gets `period` and `role_id`, unique on (tenant, user, kind, period, role) so a month-close reward is booked once. Index on `role_assignments` (holder, to_date) replaces the holder index. `reward_tiers.amount` is Decimal(19,4). No data changes.
- **One role table:** `DEFAULT_ROLES` in `config/defaultRoles.ts` is the single list. Admin and Manager are added. Marketing has preset `manager` and four granted resources (orders view, customers view, analytics view and export, marketing view and update).
- **Permission rule:** `mergeRolePermissions` (saved matrix laid over the defaults) is shared by the auth middleware and the seed, so both apply one rule. `ROLE_NAME_BY_USER_ROLE` replaces the nav service's own name table.
- **Owner guard:** `isOwnerRole` checks `presetRole` `super_admin` only. `deleteRole` in `roleService` refuses to delete the Owner role.
- **Seed and migration split:** the server-boot seed only inserts missing roles and never updates existing rows. Existing tenants get preset, grid and RoleAssignments only from `backend/scripts/migrate-users-to-roles.ts`. The script copies the tenant's saved matrix to the roles (no reset), leaves a set field alone, and is idempotent. Flags: `--dry-run` (runs in a READ ONLY transaction), `--tenant <id>`, `--allow-production`. An unknown `--tenant` is an error. System users and AI agent users get no position role. Users with no tenant are counted in the report, not migrated.
- **Helpers:** `runPerTenant` in `scripts/lib/scriptArgs.ts` (production guard, flags, per-tenant try/catch, exit code); `migrate-stock-to-levels.ts` now uses it. `startOfUtcDay` util shared by the nav service and the migration.

### Verification
- Backend typecheck, lint and build clean (merged branch at 9f5d6553). Unit 111 suites / 1569 tests pass. Integration 159 suites pass, 2058 tests (2043 pass, 11 skipped). The 4 `cashChain` failures came from rows left by an earlier crashed run (fixed references such as REF-KOFI-1); the file passes alone, 15/15.
- Frontend build and lint clean; 173 files / 1396 tests pass. `validate-workflows` ok.
- Tests: `m6Schema`, `m6RoleMigration`, `twoTenantModels`, `tenantDefaults`.
- No screens changed, so no browser check yet. The M6 screens come in T15 to T22.
- The T02 dry run on the production copy waits for T28. The T01 migration must be applied to the copy first.

### Open points
- COD-179 (tenant purge, pre-existing); COD-191 is closed as its duplicate.
- COD-192: flaky `ordersMutationApi` test.
- T03 and T06 must give new users a role on create and on invite.
- T04 union must keep access for AI agents and system users.

---

## COD-56 — Role service and API (M6-T03)
**Date:** 2026-10-31 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-56-t03-roles-api`, merge c02d40b3) | **Commits:** 34814123, a164713d

### Summary
The API for roles and who holds them. Plan task: M6-T03. COD-56 is still In Progress (T04 to T06 left).

### Changes
- **Roles (`roleService`, `roleController`, `routes/roleRoutes`):** list (Owner only), overview with holders and counts in one query, get, create, update, delete. `presetRole` is set on create and update (Owner only on update, never on the Owner role). Seeded role names cannot be renamed. A role with holders or API keys cannot be deleted ("Move 1 holder first").
- **Holders (`roleAssignmentService`):** four ways to add a holder: an existing user, an invited person (`adminService.createUser` with `access: 'invite'`), an AI agent (Owner only; it gets an MCP key limited to the role's tools, shown once) and a company (no login). Unassign ends the assignment today and keeps the row as history. It also revokes the agent's keys for that role (`mcpKeyService.revokeKeysIn`, cache evicted after the commit).
- **Guards:** the last Owner holder cannot be removed (409 `LAST_OWNER`). One rank rule (`assertOutranks`): the actor must outrank the role's base role and the holder's own role, so an admin cannot give or take a role at or above their own. Deactivated users and system users cannot get a role.
- **Signup:** `seedTenantDefaults(tenantId, ownerUserId)` gives the first user the Owner role.
- **Shared helpers:** `handler()` wrapper with `formatIssues`, `auditService.recordFromRequest`, `Requester` / `isOwner`, `splitName`, `isUniqueViolation`. A duplicate email returns 409 `EMAIL_EXISTS`.

### Verification
- Merged branch (c02d40b3): backend typecheck, lint and build clean. Unit 123 suites / 1675 tests pass. `validate-workflows` ok.
- Integration: `m6RolesApi` (39 tests), `mcpKeys`, `deliveryPartnersWrite`: 85 / 85 pass.
- API only; the roles screen is T19, so no browser check here.

### Open points
- T04: signup must not fail when the seed fails (a failure strands the tenant and blocks a retry). The seed will fill an empty Owner role on a later run.
- T06 must clear `invitedAt` when an invite is accepted.

---

## COD-56 — Staff service (M6-T05)
**Date:** 2026-11-01 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-56-t05-staff`, merge 7430c598) | **Commits:** b2b8c86d, 90942a67

### Summary
The API behind the Staff table. Plan task: M6-T05. COD-56 is still In Progress (T04 and T06 left).

### Changes
- **List (`staffService.listStaff`, `GET /api/staff?status&role&q`):** tab counts for active, invited, deactivated and deleted. The counts use the role and search filters but not the status filter. Without a status the list shows everyone except the deleted.
- **Actions (`routes/staffRoutes`, `staffController`):** edit, reset password, deactivate, reactivate, soft delete, permanent erase, and `GET /api/staff/workload` (open orders per person).
- **Soft delete:** new column `users.deleted_at` (migration `20261031230000_m6_user_deleted_at`). A deleted person is in the Deleted tab, cannot sign in, and can be restored. Restore of a person who never accepted their invite puts them back to invited.
- **Permanent erase (`eraseUser`):** the only hard-delete path. The confirm token is the person's email. A person with payouts or ledger entries cannot be erased (409 `HAS_RECORDS`). The old admin delete routes now use the same guards.
- **Last-Owner guard (`adminService.writeWithOwnerGuard`):** deactivate, delete and demote run in one transaction that locks the Owner rows (`FOR UPDATE`), so two requests at the same time cannot remove the last Owner. Sessions end after the commit, so a deactivated person is signed out on every device.
- **Edit (`adminService.updateUser`):** only the fields in `updateUserSchema` get through. A role change moves the position role with it (`systemRoleService.assignPositionRole`). A commission change applies to later deliveries only. A delivery partner's fee is not edited here (400 `FEE_NOT_EDITABLE`, set in the partner fee rule).
- **Shared helpers:** `controllers/helpers.ts` (`handler`, `idParam`, `parse`, `actorOf`), `assertMayManage` in `authUtils`, `emailConflictOf` and `isForeignKeyViolation` in `prismaErrors`.

### Verification
- Merged branch (7430c598): migrate, generate, backend typecheck, lint and build clean. Unit 123 suites / 1675 tests pass.
- Integration: `m6StaffApi` (19), `m6RolesApi`, `sessionsApi`, `deliveryPartnersWrite`, `m6RoleMigration`, `dataExportDelete`, `accountApi`: 7 suites / 154 tests pass.
- API only; the Staff table screen is T20, so no browser check here.

### Open points
- Security review after the merge: `updateUser` must check rank on every edit of another person (not only role and deactivate), and must not restore a deleted or invited person through `isActive: true`. The fix is on the T06 branch.
- Notification preferences were empty, so no migration (owner decision).

---

## COD-56 — Invite flow (M6-T06)
**Date:** 2026-11-01 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-56-t06-invites`, merge 8019a878) | **Commits:** 0ec05778 (T05 security fix), 8174467b, 092d36eb

### Summary
New staff join by invite link only. Nobody types a password for another person. Plan task: M6-T06. COD-56 is still In Progress (T04 left).

### Changes
- **Invite (`inviteService`, `POST /api/staff/invite`):** creates the person as Invited (inactive, `invitedAt` set) and sends a link by email, SMS or WhatsApp. If sending fails, the screen shows a copy-link dialog. The link is valid for `INVITE_TTL_DAYS` (7). Only the hash of the token is stored (`newHashedToken` in `utils/crypto.ts`).
- **Resend and revoke:** `POST /api/staff/:id/resend-invite` makes a new token (the old link stops working). `POST /api/staff/:id/revoke-invite` soft-deletes the invite (Deleted tab).
- **Accept (`POST /api/auth/accept-invite`, page `/accept-invite`):** the person sets a password and is signed in. One conditional update takes only a person who is still invited (`inviteTokenHash`, inactive, not deleted, `invitedAt` set). Any other case gives 400 `INVITE_INVALID`.
- **Security:** deactivate, delete and `updateUser` (isActive false) clear the invite token, so an old link cannot reactivate a person. The SMS and WhatsApp log stores the message without the link (`logBody`).
- **Old create paths closed:** `POST /api/users` and `POST /api/admin/users` return 410 `USE_INVITE`. The delivery-partner admin path keeps its password branch, because a partner signs in with it.
- **T05 security fix (0ec05778):** `updateUser` checks rank on every edit of another person and cannot restore a deleted or invited person through `isActive: true`.
- **Shared code:** `sessionService.signIn` (login and accept-invite), `utils/appUrl.ts`, `<NewPasswordFields>` and `lib/passwordRules.ts` (reset password and accept invite), the 72-character limit in `resetPasswordValidation`.

### Verification
- Merged branch (8019a878): migrate, generate, backend typecheck, lint and build clean. Unit 125 suites / 1683 tests pass.
- Integration: `m6InviteApi`, `m6StaffApi`, `m6RolesApi`, `m6Targets`, `navApi`, `systemUser`, `authFailClosed`, `onboardingApi`, `deliveryPartnersWrite`, `accountApi`, `sessionsApi`, `m6RoleMigration`: 12 suites / 237 tests pass.
- Frontend: build and lint clean; vitest 174 files / 1404 tests pass (includes `AcceptInvite`).

### Open points
- The full invite form on the Staff screen is T20. This task adds the accept page and the copy-link dialog only.

---

## COD-56 — Permissions: tool switches, permission grid, role union (M6-T04)
**Date:** 2026-11-01 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-56-t04-permissions`, merge 54717d6b, HEAD^2 4b1b3c27, cleanup 34a05b89) | **Commits:** 34574203, 4ceea128, ed049131, 7a987d78, 7e5f8ca1, ed702175

### Summary
Each role now has 16 tool switches and an advanced permission matrix. A person's access is the union of the roles they hold. Plan task: M6-T04. This closes COD-56.

### Changes
- **Tool switches (`config/roleToolRules.ts`, `PUT /api/roles/:id/tools`):** one table of 16 switches (7 read, 9 write). Each switch grants a set of matrix cells. A write switch needs its read switch, so turning off a read switch while its write switch is on gives a dependency error. "Update order status" grants `orders:update` and `orders:update_status`.
- **Permission matrix (`GET/PUT /api/roles/:id/permissions`, `rolePermissionService`):** the Owner edits the cells of a role. Switch writes and grid writes go through one `saveGrid`, so both keep the last-manager guard (the last role that gives `users:update` to an active holder cannot lose it). The Settings matrix save checks every role before it writes (`saveMatrix`).
- **Union of roles (`permissionService`):** a person gets every cell of every position role they hold. The grid fallback is the tenant matrix, and the middleware, the checks, the role views and the MCP keys all read it. An admin cannot give a role with cells the admin does not have (`assertGridWithin`, 403 `GRID_ABOVE_ACTOR`) and cannot give a role to themselves (403 `SELF_ASSIGN`).
- **One access invalidation (`accessService.invalidateAccess`):** every access change (switches, grid, assign, unassign, the user edit that changes a position role) clears the per-tenant permission and key caches after the commit and tells the holders. The next request uses the new access. There is no 60-second wait.
- **Active check:** `authenticate` refuses a valid token at once (401) when the user is deactivated or soft-deleted.
- **MCP:** a key's tools are the registry tools of its role (`registryToolsOfRole`). The key list shows the tool count of the role.
- **Owner race fix (4ceea128):** unassign locks the Owner holders (`FOR UPDATE`), so two calls at once cannot remove the last Owner.
- **Storage:** `Role.tools` is stored for the system role only. Other roles derive their switches from their cells.

### Verification
- Combined post-merge run on 780f8524/ecb4f120 (T04, T10, T15 together): backend `tsc`, lint and build OK. Unit 131 suites / 1744 tests pass. Integration 30 suites / 395 tests pass. Frontend build and lint OK; vitest 176 files / 1432 tests pass.
- Note: an earlier full run had one failure in `m6StaffApi` (Owner reactivate of an invited person got 403). It did not repeat in 15 runs. The test now prints the reply body. The later full run passed.

### Open points
- Phase 7 tickets (each needs a data migration): stop reading `systemConfig.rolePermissions`; one grid for the Owner and legacy roles (roleKind).
- The switch and matrix screens are T21.

---

## COD-57 — Target service (M6-T07)
**Date:** 2026-11-01 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-57-t07-targets`, merge 2e37b9b1) | **Commits:** 4508bbce, 2dff0328

### Summary
The service behind the target tree: North Star (year), quarter, month, role, person and daily targets. Plan task: M6-T07. The routes come in T08, so COD-57 stays In Progress.

### Changes
- **One write path (`targetService.writeTarget(tx, tenantId, op)`):** the ops are save, set children, delete and release. Each op locks the parent and child rows (`FOR UPDATE`) in one transaction.
- **Children must add up:** children that do not sum to the parent are rejected, and the message gives the difference.
- **Closed months (`monthClosed`, `closedMonths`):** a month with `closedAt` set cannot be edited.
- **Unassign returns the target to the pool:** `releasePersonTargets` runs inside the unassign transaction in `roleAssignmentService`. The notice (`announceRelease`) and the audit row go out after the commit.
- **Holder added mid-month:** no automatic proration. The person shows "Set a target" until the owner sets one.
- **Daily activity targets:** they save; a metric with no data returns "No data for this metric".
- **Year pace (`kpi/yearPace.ts`, `paceMarker`):** quarter plan, not straight days. Expected to date = closed quarter targets + (days gone / days in quarter) x current quarter target. `paceBasis` is `quarter_plan` or `days`. Quarter and month pace stay straight days. `utcDate` added to `kpi/dates.ts`.

### Verification
- Merged branch (2e37b9b1): migrate, generate, backend typecheck, lint and build clean. Unit 124 suites / 1680 tests pass (`yearPace` fixture: 17 Oct gives 1,359,783 = 75.5%).
- Integration: `m6Targets`, `m6RolesApi`, `m6StaffApi`, `m6Schema`, `m6RoleMigration`, `dashboardOwner`, `kpiLeadership`, `m5FinanceOverview`: 10 suites / 185 tests pass.
- Service only; the target screens come later, so no browser check here.

### Open points
- The last-Owner count in unassign runs before the transaction. The fix (row lock inside the transaction) is on the T08 branch.

---

## COD-57 — North Star service, calculators and target routes (M6-T08)
**Date:** 2026-11-01 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-57-t08-northstar`, merge 7d14f767) | **Commits:** 4ceea128 (last-Owner race fix), fa00acd6, 846ceab7, bdc571cc

### Summary
The North Star plan and the `/api/targets` routes. Plan task: M6-T08. With T07 this completes COD-57.

### Changes
- **Year tree (`northStarService.saveNorthStar`, `POST /api/targets/north-star`):** builds the North Star, 4 quarters and 12 months in one transaction (`targetService.replanYear`). Modes: even, grow (one thirtieth of the annual figure per step: 360/420/480/540k on 1,800,000) and custom (quarters must add up, else 400 `TARGET_SUM_MISMATCH` with the difference). Past and closed months keep their value on a re-plan; "past" uses the store date.
- **Driver targets (`PUT /api/targets/drivers`):** `planned_aov`, `confirmation_rate` (default 70), `delivery_success_rate` (default 60), `net_margin` (default 35), saved all or none. Planned AOV defaults to the last 30 days of delivered orders; an owner edit is stored as `manual` and kept. No delivered orders and no edit: 400 `AOV_REQUIRED`.
- **Calculators (`GET /api/targets/calculators`, `northStarMath.ts`):** orders delivered (round up), orders to take in (nearest), orders a day (round up), max cost per order. Fixture: 723, 1,721, 56. A rate of 0, below 0 or above 100% is 400 `RATE_INVALID`.
- **Routes (`targetRoutes.ts`):** read = manager level + `analytics:view`; North Star, its children and drivers = `settings:update` (Owner); one role, person or daily target = `users:update`. The generic routes refuse North Star rows (403 `USE_NORTH_STAR`). Role and user ids are checked against the tenant (404).
- **Last-Owner race (4ceea128):** `unassign` locks the role's active assignments (`FOR UPDATE`) and counts Owners inside the transaction.

### Verification
- Merged branch: typecheck, lint, build clean. Unit 128 suites / 1723 tests; integration 20 suites / 290 tests (with T09).
- `m6NorthStar` (19), `m6OwnerRace`, `m6Targets`, `m6RolesApi`, `dashboardOwner`, `kpiLeadership`, `m5FinanceOverview` pass.
- API only; the screens are T15 (Targets page) and T17 (wizard).

### Open points
- The growth mode is not stored; the screen sends it on every re-plan.

---

## COD-58 — Rewards settings and attainment (M6-T09)
**Date:** 2026-11-01 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-58-t09-rewards`, merge 675730ba) | **Commits:** 17623730, 0ce836fa

### Summary
The one place reward tiers and rep pay live, and each person's progress toward their target. Plan task: M6-T09. COD-58 is still In Progress (T10, T11 left).

### Changes
- **Settings (`GET/PUT /api/rewards/settings`):** cash tiers by role at 100% and 120% in `RewardTier` (with day-off note); rep pay (GH₵8 base, 10% upsell) and the badges switch in `SystemConfig.features.rewards` through `tenantFeatures`. A 120% amount below the 100% amount is 400 `TIER_ORDER`. GET = `settings:view`, PUT = `settings:update`.
- **One read of rep pay (`rewardService.getRepPay`):** GL posting still reads `User.commissionAmount` until T10/M7 switches to it.
- **Attainment (`GET /api/rewards/attainment?period&userId&roleId`):** per person and role: target, actual, percent, tier, reward, distance to the next tier (F-1108). Call reps count confirmed orders that got delivered, by delivery date (P7). Delivery partners use the delivery success rate (`outcomesByPartner`, one batch, same filters as `rates()`). Above 120%: "Top tier reached". No target: no reward and "Set a target". AI agents and companies: "No payout". An open month reads "On track to earn ... at month close"; a closed month "Earned". Managers and above see everyone; others see their own rows.
- **Shared code:** `config/targetMetrics.ts` (metric names and basis), `kpi/rates.deliveredByRep`, `utils/money` `CURRENCY_SIGN` / `formatWithSign` (NGN shows ₦), targetService read helpers `monthPersonTargets`, `monthRoleTargets`, `isMonthClosed`.
- **Wording guard:** no 80% tier and no "airtime" in reward code or messages (unit test).

### Verification
- Merged branch: same full run as T08 above. `m6RewardsApi` (16), `rewardMath`, `rewardWording`, `wordingGuard`, M5 commission and payout suites, `kpiRates`, `repRates` pass.

### Open points
- A person who left a role mid-month is skipped by the live-target rule; T10 judges them on their own target at month close (F-1110).

---

## COD-58 — Month close (M6-T10)
**Date:** 2026-11-01 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-58-t10-close`, merge c4ba8447, HEAD^2 65790ad9) | **Commits:** 2b8307e0, 13eb08b8, 883cf1f1, 65790ad9

### Summary
At the end of a month, attainment becomes reward entries and the month is locked. Plan task: M6-T10. COD-58 is still In Progress (T11 and the screens left).

### Changes
- **Plan (`periodCloseService`):** the plan is `rewardService.computeAttainment` for the month. The preview and the run read the same rule. A human holder at 100% or more gets one `CommissionEntry` of kind `reward` for the tier reached (the 120% amount only, not both), with the day off as a note. It posts DR 5050 / CR 2020 on the last day of the month (`postEntry`).
- **Lock:** the month, role, person and month targets of that month get `closedAt`, so T07 refuses edits. The month target is the lock. A month with no month target gives 409 `NOTHING_TO_CLOSE`.
- **One transaction per tenant and month,** under an advisory lock. It is safe to repeat: an entry exists once per tenant, person, reward, month and role (a unique key). A month already closed returns what it holds and creates nothing.
- **Failure:** any failure that is not a 4xx stops the run with nothing written and opens a Finding. A read failure gives 502 `KPI_UNAVAILABLE`. Nothing is paid on partial data.
- **Security review fix (65790ad9):** the 502 reply is generic. The raw error text goes only to the log and the Finding, not to the API reply.
- **No clawback:** a return after close does not take a reward back.
- **Routes (`periodCloseRoutes`):** `POST /api/period-close/:period/preview` and `POST /api/period-close/:period`. Both need `settings:update` and the Owner check.
- **Schedule (`queues/periodCloseQueue.ts`):** a job runs on day 1 at 03:00 Africa/Accra. For each tenant it closes the month that ended, as that tenant's system user. The previous month is worked out in the tenant time zone, not the server zone. A tenant with nothing to close is skipped.
- **Shared code:** a small date helper in `kpi/dates.ts`; read helpers in `targetService` and `rewardService`.

- **Frontend and database:** no screens, no migration.
- **Key files:** `services/periodCloseService.ts`, `queues/periodCloseQueue.ts`, `routes/periodCloseRoutes.ts`, `controllers/periodCloseController.ts`, `__tests__/integration/m6PeriodClose.test.ts`.

### Verification
- Combined post-merge run on 780f8524/ecb4f120 (T04, T10, T15 together): backend `tsc`, lint and build OK. Unit 131 suites / 1744 tests pass. Integration 30 suites / 395 tests pass. Frontend build and lint OK; vitest 176 files / 1432 tests pass.

### Open points
- The month close screen (preview and confirm) is not built yet.

---

## COD-58 — Leaderboard and badges service (M6-T11)
**Date:** 2026-11-01 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-58-t11-leaderboard`, merge c2e05be7, HEAD^2 b3852ba1) | **Commits:** 4e1d0e27, 2f893d1c (merge of T10), b3852ba1

### Summary
A ranked board per period and the badges people earn at month close. Plan task: M6-T11. With T09 and T10 this completes the COD-58 backend.

### Changes
- **Leaderboard (`GET /api/leaderboard`, `leaderboardService`, `leaderboardMath`):** ranks people by target attainment for a period. It needs the `targets:view` cell, which every role has. The Owner, Admin and Manager see every row. Anyone else sees their own row only.
- **Badges (`GET /api/badges`, `badgeService`):** read only. Badges are written by the month close and never by hand.
- **Badges inside the close transaction (b3852ba1):** `awardMonthBadges` counts and writes through the caller's client, so inside the close transaction it sees its own rows. `closeMonth` awards the badges inside the advisory-lock transaction, after the reward entries and before the targets close. The run result carries the new badge count. A failed close writes no badge.
- **Progress alias:** `GET /api/rewards/progress` is an alias. It calls the same function as the leaderboard for one person's attainment. A person sees their own; the Owner level sees anyone.
- **Validation:** new schemas in `validators/rewardSchema.ts`.

- **Frontend and database:** no screens. No migration; badges use the existing `BadgeAward` table.
- **Key files:** `services/leaderboardService.ts`, `services/leaderboardMath.ts`, `services/badgeService.ts`, `routes/leaderboardRoutes.ts`, `routes/badgeRoutes.ts`, `__tests__/integration/m6Leaderboard.test.ts`, `__tests__/unit/leaderboardMath.test.ts`.

### Verification
T11_VERIFY_PLACEHOLDER

### Open points
- The leaderboard and badge screens are not built yet.

---

## COD-59 — Targets page (M6-T15)
**Date:** 2026-11-01 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-59-t15-targets-page`, merge 9c10e087, HEAD^2 216d99fe) | **Commits:** 2c54b3f1, 216d99fe, follow-up fix 780f8524

### Summary
The Targets page: the North Star, the year tree, and role groups with an add-target dialog. Plan task: M6-T15.

### Changes
- **One tree read:** every role target hangs under the revenue month, so the page reads one tree (`targetService`, `northStarService`).
- **One status rule (`targetStatus.ts`):** the backend decides the status and the colour of each target. The page shows them and does not work them out. Actuals come from `targetActuals.ts`; `rewardService` shares the rule.
- **Follow-up fix (780f8524):** the `localDate` import was lost in the merge and is restored. The `lockParent` comment is back in place.

- **Page (`pages/Targets.tsx`, route `/targets`):** `NorthStarCard`, `RoleGroups`, `TargetDialog`, `model.ts`, `services/targets.service.ts`, `styles/targets.css`.
- **Navigation:** the nav model and the command palette point to the new page.
- **Narrow screens:** the table stacks at 760 px.
- **Database:** no migration.
- **Key files:** `frontend/src/pages/Targets.tsx`, `frontend/src/pages/targets/*`, `backend/src/services/targetStatus.ts`, `backend/src/services/targetActuals.ts`, `backend/src/__tests__/integration/m6TargetsTree.test.ts`, `frontend/src/__tests__/pages/Targets.test.tsx`.

### Verification
- Combined post-merge run on 780f8524/ecb4f120 (T04, T10, T15 together): backend `tsc`, lint and build OK. Unit 131 suites / 1744 tests pass. Integration 30 suites / 395 tests pass. Frontend build and lint OK; vitest 176 files / 1432 tests pass.

### Open points
- The screenshots came from a fixture proxy, not the real backend. The real-backend browser check is pending at the milestone QA.

---

## COD-58 — Persistent assignment cursor
**Date:** 2026-10-31 | **Type:** feat | **Branch:** feature/m6-roles-targets-rewards (lane `m6/cod-58-t13-cursor`, merge 3fa283e7) | **Commits:** 68577a8c, 5840ce98

### Summary
A smooth weighted round robin for order assignment whose position survives a restart. Plan task: M6-T13. Partial: T13 done; the issue is still In Progress.

### Changes
- **Cursor (`services/assignmentCursor.ts`):** smooth weighted round robin. Each pick runs in one transaction with `SELECT ... FOR UPDATE` on the `assignment_cursors` row, advances the state and writes it back. That row is the only state, so a restart continues the sequence and parallel picks are serialized.
- **Change from the plan:** the plan said "Redis cursor with DB fallback". Changed on review: a Redis copy next to the row needs reconciling, and a few assignments a minute do not need a cache. Redis is not used.
- **Rotation:** all active users of the role. Availability (active, `isAvailable`, delivery agent not blocked) is decided at pick time, so an away user is skipped without a reset.
- **List change:** a changed rotation list resets the cursor for that scope, with one log line.
- **Alert:** when nobody is available, the owner is alerted once per scope per hour (`notifyAdminsNoAssigneeAvailable` in `notificationService`, using the shared `findTenantAdmins`). Orders wait.
- **Assignment service:** `assignmentService` uses the cursor for its picks.

### Verification
- Backend typecheck, lint and build clean (merged branch at 9f5d6553). Unit 111 suites / 1569 tests pass. Integration 159 suites pass, 2058 tests (2043 pass, 11 skipped); the 4 `cashChain` failures came from rows left by an earlier crashed run and the file passes alone, 15/15.
- Frontend build and lint clean; 173 files / 1396 tests pass. `validate-workflows` ok.
- Tests: unit `assignmentCursor` and `assignmentService.extended`; integration `assignmentCursor`.
- No screens changed, so no browser check.

### Open points
- The workflow assign paths (`workflowQueue`, and `executeAssignUserAction` in `workflowService`) are not on the cursor yet. Planned in M9 F-511.
