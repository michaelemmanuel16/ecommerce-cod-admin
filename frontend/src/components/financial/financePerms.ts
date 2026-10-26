/**
 * The permission each Finance button needs. The pairs match the backend route table (financialRoutes, glRoutes), so a
 * button is enabled exactly when its route would answer. `reason` is the tooltip text on the disabled button.
 * `roles`: for a route the backend guards by role, not by permission pair; the button needs both.
 */
import type { Action, Resource } from '../../types';

export const FINANCE_PERMS = {
  addExpense: { resource: 'financial', action: 'create', reason: 'You do not have permission to add expenses.' },
  editExpense: { resource: 'expenses', action: 'edit', reason: 'You do not have permission to edit expenses.' },
  deleteExpense: { resource: 'expenses', action: 'delete', reason: 'You do not have permission to delete expenses.' },
  postJournal: { resource: 'journal', action: 'post', reason: 'You do not have permission to post journal entries.' },
  recordPayout: { resource: 'payouts', action: 'create', reason: 'You do not have permission to record payouts.' },
  // Agent collections (M5-T36). The routes check roles: verify (accountant and up), block (manager and up), write-off (owner).
  verifyCollection: { resource: 'financial', action: 'update', roles: ['super_admin', 'admin', 'manager', 'accountant'], reason: 'You do not have permission to verify collections.' },
  remindPartner: { resource: 'financial', action: 'update', reason: 'You do not have permission to send reminders.' },
  blockPartner: { resource: 'financial', action: 'update', roles: ['super_admin', 'admin', 'manager'], reason: 'Only the owner, admins and managers can block or unblock a partner.' },
  resolveFinding: { resource: 'financial', action: 'update', reason: 'You do not have permission to resolve Findings.' },
  writeOffFinding: { resource: 'financial', action: 'update', roles: ['super_admin'], reason: 'Only the owner can write off a Finding.' },
  voidJournal: { resource: 'journal', action: 'void', reason: 'You do not have permission to void journal entries.' },
} as const satisfies Record<string, { resource: Resource; action: Action; reason: string; roles?: readonly string[] }>;

export type FinancePerm = keyof typeof FINANCE_PERMS;
