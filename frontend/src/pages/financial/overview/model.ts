import { formatCurrency } from '../../../utils/format';
import { NOT_AVAILABLE, type OkTile, type Tile, type TileKey, type Tone } from '../../../services/finance-overview.service';
import { shortDay } from '../../dashboard/format';

export const TILE_ORDER: TileKey[] = ['deliveredRevenue', 'cashReceived', 'cashOutstanding', 'netMargin', 'profitPerOrder', 'cashRunway'];

export const isOk = (t: Tile): t is OkTile => t.status === 'ok';

export const TAG_TONE: Record<Tone, 'ok' | 'warn' | 'bad' | 'n'> = { ok: 'ok', warn: 'warn', bad: 'bad', neutral: 'n' };

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const money = (v: number | string | null | undefined, currency: string) =>
  v === null || v === undefined || v === NOT_AVAILABLE ? NOT_AVAILABLE : formatCurrency(typeof v === 'number' ? Math.round(v * 100) / 100 : v, currency);

/** "-16%" or "n/a". The API sends one decimal; the page shows whole percent, rounded away from zero. */
export const wholePct = (v: number | string): string => (typeof v === 'number' ? `${v < 0 ? '-' : ''}${Math.round(Math.abs(v))}%` : NOT_AVAILABLE);

export const dayRange = (from: string, to: string) => (from === to ? shortDay(from) : `${shortDay(from)} to ${shortDay(to)}`);

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

/** The revenue target tag, same words as the Dashboard (kpi/status.ts progressTag). */
export const TARGET_TAG: Record<'hit' | 'on_track' | 'behind' | 'off_track', { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  hit: { label: 'Hit', tone: 'ok' },
  on_track: { label: 'On track', tone: 'ok' },
  behind: { label: 'Behind', tone: 'warn' },
  off_track: { label: 'Off track', tone: 'bad' },
};
