import apiClient from './api';
import type { StaffKind, StaffRole } from './staff.service';

/**
 * The role cards API (M6-T19, F-1151, F-1152, F-1156), from the roles routes of M6-T03: the overview, the holders of a role with
 * the ones that left, a new role, a delete, and the three ways to add a holder. Every call is `quiet`: the page says a refusal
 * once, in its own words (the API's message, such as "Move 2 holders first").
 * The API client turns money strings under money keys into numbers; a role target's `value` is one of them.
 */

export interface RoleHolder {
  assignmentId: number;
  since: string;
  id: number;
  name: string;
  email: string;
  kind: StaffKind;
  typeLabel: string;
  status: 'active' | 'invited' | 'deactivated';
}

/** A role card: the role with its holders now, the tools that are on, and this month's target if one is set. */
export interface RoleCard {
  id: number;
  name: string;
  area: string | null;
  contract: { purpose?: string; results?: string; accountabilities?: string; standards?: string } | null;
  presetRole: string | null;
  isSystem: boolean;
  /** Keys of the switches that are on ("view_orders"). */
  tools: string[];
  toolCount: number;
  toolTotal: number;
  holderCount: number;
  custom: boolean;
  holders: RoleHolder[];
  target: { metric: string; unit: string; value: number; periodStart: string; periodEnd: string } | null;
}

/** One line of a role's history: the current holders first, then the ones that left. */
export interface RoleAssignment {
  assignmentId: number;
  from: string;
  to: string | null;
  current: boolean;
  id: number;
  name: string;
  kind: StaffKind;
  typeLabel: string;
}

export type AssignBody =
  | { type: 'ai_agent'; name: string }
  | { type: 'company'; name: string };

/** What an assign answers. `apiKey.key` is in the answer of an AI agent only, and only this once. */
export interface AssignResult {
  holder: { id: number; name: string; kind: StaffKind };
  apiKey?: { key: string; keyPrefix: string; label: string; toolCount: number };
}

export interface NewRole {
  name: string;
  purpose?: string;
  copyToolsFromRoleId?: number;
}

const quiet = { quiet: true } as const;

export const rolesService = {
  async overview(): Promise<RoleCard[]> {
    return (await apiClient.get('/api/roles/overview', { skipCache: true, quiet: true })).data.roles;
  },
  async assignments(roleId: number): Promise<RoleAssignment[]> {
    return (await apiClient.get(`/api/roles/${roleId}/assignments`, { skipCache: true, quiet: true })).data.assignments;
  },
  async create(body: NewRole): Promise<RoleCard> {
    const { purpose, ...rest } = body;
    return (await apiClient.post('/api/roles', { ...rest, ...(purpose && { contract: { purpose } }) }, quiet)).data.role;
  },
  async remove(roleId: number): Promise<void> {
    await apiClient.delete(`/api/roles/${roleId}`, quiet);
  },
  async assign(roleId: number, body: AssignBody): Promise<AssignResult> {
    return (await apiClient.post(`/api/roles/${roleId}/assign`, body, quiet)).data;
  },
  async unassign(roleId: number, assignmentId: number): Promise<void> {
    await apiClient.delete(`/api/roles/${roleId}/assignments/${assignmentId}`, quiet);
  },
};

/** The role select of the invite and edit modals reads the same cards. */
export const toStaffRoles = (cards: RoleCard[]): StaffRole[] => cards.map((r) => ({ roleId: r.id, name: r.name, presetRole: r.presetRole }));
