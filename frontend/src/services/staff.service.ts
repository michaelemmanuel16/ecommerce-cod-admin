import apiClient from './api';

/**
 * The Staff page API (M6-T20): GET /api/staff with its tab counts (T05), the invite, resend and revoke of T06, the row actions,
 * the workload and the role list. Every call is `quiet`: the page says a refusal once, in its own toast.
 * The API client turns money strings under money keys into numbers; `commissionAmount` is one of them.
 */

export type StaffStatus = 'active' | 'invited' | 'deactivated' | 'deleted';
export type StaffKind = 'person' | 'company' | 'ai_agent' | 'system';
export type PayMethod = 'per_order' | 'fee_rule' | 'none';
export type InviteChannel = 'email' | 'sms' | 'whatsapp';

export interface StaffRow {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  kind: StaffKind;
  /** The base role (UserRole). */
  role: string;
  status: StaffStatus;
  isActive: boolean;
  lastLogin: string | null;
  /** The last sign-in of a person, or the last use of an AI agent's key. */
  lastActiveAt: string | null;
  invitedAt: string | null;
  commissionAmount: number | null;
  vehicleType: string | null;
  vehicleId: string | null;
  location: string | null;
  payMethod: PayMethod | null;
  positions: Array<{ id: number; name: string }>;
  /** A delivery partner's fee is a rule, not a field of the person. `delivered` is the rule in force today for a delivered order. */
  feeRule: { editable: false; url: string; delivered: { basis: 'flat' | 'percent'; amount: number } | null } | null;
}

export interface StaffList {
  counts: Record<StaffStatus, number>;
  staff: StaffRow[];
}

export interface StaffQuery { status?: StaffStatus; role?: string; q?: string }

export interface StaffRole { roleId: number; name: string; presetRole: string | null }

export interface InviteBody {
  name: string;
  email: string;
  phoneNumber?: string;
  roleId: number;
  channel: InviteChannel;
  payMethod?: PayMethod;
  amount?: number;
  vehicleType?: string;
  vehicleId?: string;
  city?: string;
}

/** What an invite or a resend answers: the link is in this answer only. */
export interface InviteResult {
  staff: StaffRow;
  link: string;
  expiresAt: string;
  delivery: { channel: InviteChannel; sent: boolean; reason?: string };
}

export interface StaffPatch {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  role?: string;
  payMethod?: PayMethod;
  commissionAmount?: number;
  vehicleType?: string;
  vehicleId?: string;
  location?: string;
}

export interface WorkloadRow { id: number; openOrders: number; asRep: number; asAgent: number }

const quiet = { quiet: true } as const;

export const staffService = {
  async list(query: StaffQuery): Promise<StaffList> {
    return (await apiClient.get('/api/staff', { params: query, skipCache: true, quiet: true })).data;
  },
  async workload(): Promise<WorkloadRow[]> {
    return (await apiClient.get('/api/staff/workload', { skipCache: true, quiet: true })).data.workload;
  },
  /** The roles of the tenant for the role select, from the role overview (users:view). */
  async roles(): Promise<StaffRole[]> {
    const rows: Array<{ id: number; name: string; presetRole: string | null }> = (await apiClient.get('/api/roles/overview', quiet)).data.roles;
    return rows.map((r) => ({ roleId: r.id, name: r.name, presetRole: r.presetRole }));
  },
  async invite(body: InviteBody): Promise<InviteResult> {
    return (await apiClient.post('/api/staff/invite', body, quiet)).data;
  },
  async resend(id: number, channel: InviteChannel): Promise<InviteResult> {
    return (await apiClient.post(`/api/staff/${id}/resend-invite`, { channel }, quiet)).data;
  },
  async revoke(id: number): Promise<void> {
    await apiClient.post(`/api/staff/${id}/revoke-invite`, {}, quiet);
  },
  async update(id: number, patch: StaffPatch): Promise<StaffRow> {
    return (await apiClient.put(`/api/staff/${id}`, patch, quiet)).data.staff;
  },
  async resetPassword(id: number, password: string): Promise<void> {
    await apiClient.post(`/api/staff/${id}/reset-password`, { password }, quiet);
  },
  async deactivate(id: number): Promise<void> {
    await apiClient.post(`/api/staff/${id}/deactivate`, {}, quiet);
  },
  async reactivate(id: number): Promise<void> {
    await apiClient.post(`/api/staff/${id}/reactivate`, {}, quiet);
  },
  async remove(id: number): Promise<void> {
    await apiClient.delete(`/api/staff/${id}`, quiet);
  },
  /** Erase for good. `confirm` is the person's email, typed. */
  async removePermanently(id: number, confirm: string): Promise<void> {
    await apiClient.delete(`/api/staff/${id}/permanent`, { data: { confirm }, ...quiet });
  },
};

/** The company rep pay of Settings, Rewards (F-1231), for the Pay column. null when the person may not read it. */
export async function companyRepPay(): Promise<{ currency: string; baseCommission: number; upsellPercent: number } | null> {
  try {
    const data = (await apiClient.get('/api/rewards/settings', { quiet: true })).data;
    return { currency: data.currency, baseCommission: Number(data.repPay.baseCommission), upsellPercent: Number(data.repPay.upsellPercent) };
  } catch {
    return null;
  }
}
