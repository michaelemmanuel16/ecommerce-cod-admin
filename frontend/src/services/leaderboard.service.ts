import apiClient from './api';

/**
 * The Leaderboard API (M6-T11): ranking by percent of each person's own target, reward progress inside month and year rows, and the
 * result badges. The API client turns money strings under money keys into numbers; `target` stays a string.
 */

export type BoardRole = 'call_rep' | 'delivery';
/** today | week | month | year | YYYY-MM */
export type BoardPeriod = string;

export interface BoardRow {
  rank: number | null;
  userId: number;
  name: string;
  kind: 'person' | 'ai_agent' | 'company' | string;
  roleId: number;
  roleName: string;
  payout: boolean;
  ranked: boolean;
  /** Why the row is not ranked: "Set a target", "Too early", "No data for this metric". */
  reason: string | null;
  target: string | null;
  actual: number | null;
  /** Percent of the person's own target, one decimal. */
  percent: number | null;
  // call reps
  confirmed?: number | null;
  confirmationRate?: number | null;
  deliveredFromConfirmed?: number | null;
  // delivery
  success?: number | null;
  daysToPay?: number | null;
  closed?: number;
  delivered?: number;
  // month and year only
  tier?: 'none' | '100' | '120';
  flag?: 'contract_review' | null;
  flagText?: string;
  badges?: Array<{ key: string; period: string }>;
  reward?: { amount: number | string; dayOff: boolean } | null;
  earned?: boolean;
  distance?: { next: '100' | '120'; amount: number | null; unit: string; message: string } | null;
  message?: string;
}

interface TierView { amount: number | string; dayOff: boolean; payout: boolean }
export interface Board {
  role: BoardRole;
  period: { key: string; kind: 'today' | 'week' | 'month' | 'year'; label: string; from: string; to: string; closed: boolean };
  note: string | null;
  currency: string;
  /** Month and year only. */
  rewards: { tiers: Array<{ roleId: number; roleName: string; tier100: TierView | null; tier120: TierView | null }>; noPayout: string[]; message: string } | null;
  rows: BoardRow[];
}

export interface BadgeList {
  display: boolean;
  badges: Array<{
    key: string; label: string; description: string; locked: boolean; message?: string;
    holders: Array<{ userId: number; name: string; kind: string; period: string }>;
  }>;
}

export const leaderboardService = {
  async board(role: BoardRole, period: BoardPeriod): Promise<Board> {
    const { data } = await apiClient.get<Board>('/api/leaderboard', { params: { role, period } });
    return data;
  },
  async badges(period?: string): Promise<BadgeList> {
    const { data } = await apiClient.get<BadgeList>('/api/badges', { params: period ? { period } : {} });
    return data;
  },
};
