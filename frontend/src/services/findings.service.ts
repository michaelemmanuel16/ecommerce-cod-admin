import apiClient from './api';
import { parseMoney } from '../utils/money';

/** The Findings API (backend findingRoutes.ts, M5-T08, F-909). */

export const FINDING_TYPES = [
  'ledger_gap', 'stock_gap', 'short_pay', 'cash_gap', 'unpaid_term', 'repeat_refuser', 'payment_unmatched', 'ledger_post_failed',
  'paystack_unsettled', 'fee_rule_missing', 'unmatched_line', 'charge_variance', 'over_pay', 'excess_deposit', 'negative_cash_held',
  'verify_exceeds_cash_held',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export type FindingStatus = 'open' | 'explained' | 'closed' | 'written_off';

export interface Finding {
  id: number;
  type: FindingType;
  status: FindingStatus;
  subjectType: string;
  subjectId: string;
  amount: number | null;
  note: string | null;
  explanation: string | null;
  assigneeId: number | null;
  assignee: { id: number; name: string } | null;
  resolvedById: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface FindingList {
  findings: Finding[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export interface FindingFilters {
  type?: FindingType;
  status?: FindingStatus;
  /** A user id, or 'none' for the unassigned. */
  assigneeId?: number | 'none';
  page?: number;
  limit?: number;
}

/** PATCH body: assign, or explain / write off with a note. */
export interface FindingChange {
  assigneeId?: number | null;
  status?: 'explained' | 'written_off';
  explanation?: string;
}

const row = (f: Finding): Finding => ({ ...f, amount: f.amount === null || f.amount === undefined ? null : parseMoney(f.amount) });

export const findingsService = {
  async list(filters: FindingFilters): Promise<FindingList> {
    const { data } = await apiClient.get<FindingList>('/api/findings', { params: filters, quiet: true });
    return { findings: data.findings.map(row), pagination: data.pagination };
  },

  async update(id: number, change: FindingChange): Promise<Finding> {
    const { data } = await apiClient.patch<{ finding: Finding }>(`/api/findings/${id}`, change, { quiet: true });
    return row(data.finding);
  },
};

export interface Assignee {
  id: number;
  name: string;
}

let assignees: Promise<Assignee[]> | null = null;

/**
 * The people a Finding can be given to (GET /api/users, owner, admin and manager only). Read once per session: a refused or
 * failed call gives an empty list and is tried again on the next visit.
 */
export function findingAssignees(): Promise<Assignee[]> {
  assignees ??= apiClient
    .get<{ users: Array<{ id: number; firstName: string; lastName: string; isActive?: boolean }> }>('/api/users', { params: { isActive: true, limit: 100 }, quiet: true })
    .then(({ data }) => data.users.filter((u) => u.isActive !== false).map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() })))
    .catch(() => {
      assignees = null;
      return [];
    });
  return assignees;
}
