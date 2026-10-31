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
