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
