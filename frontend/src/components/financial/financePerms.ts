/**
 * The permission each Finance button needs. The pairs match the backend route table (financialRoutes, glRoutes), so a
 * button is enabled exactly when its route would answer. `reason` is the tooltip text on the disabled button.
 */
import type { Action, Resource } from '../../types';

export const FINANCE_PERMS = {
  addExpense: { resource: 'financial', action: 'create', reason: 'You do not have permission to add expenses.' },
  editExpense: { resource: 'expenses', action: 'edit', reason: 'You do not have permission to edit expenses.' },
  deleteExpense: { resource: 'expenses', action: 'delete', reason: 'You do not have permission to delete expenses.' },
  postJournal: { resource: 'journal', action: 'post', reason: 'You do not have permission to post journal entries.' },
  recordPayout: { resource: 'payouts', action: 'create', reason: 'You do not have permission to record payouts.' },
  voidJournal: { resource: 'journal', action: 'void', reason: 'You do not have permission to void journal entries.' },
} as const satisfies Record<string, { resource: Resource; action: Action; reason: string }>;

export type FinancePerm = keyof typeof FINANCE_PERMS;
