import { formatCurrency } from '../../../utils/format';
import { NOT_AVAILABLE, type Amount, type TileKey } from '../../../services/finance-overview.service';
import { shortDay } from '../../dashboard/format';

export const TILE_ORDER: TileKey[] = ['deliveredRevenue', 'cashReceived', 'cashOutstanding', 'netMargin', 'profitPerOrder', 'cashRunway'];

export const money = (v: Amount | null | undefined, currency: string) =>
  v === null || v === undefined || v === NOT_AVAILABLE ? NOT_AVAILABLE : formatCurrency(v, currency);

/** "-16%" or "n/a". The API sends one decimal; the page shows whole percent, rounded away from zero. */
export const wholePct = (v: Amount): string => (typeof v === 'number' ? `${v < 0 ? '-' : ''}${Math.round(Math.abs(v))}%` : NOT_AVAILABLE);

export const dayRange = (from: string, to: string) => (from === to ? shortDay(from) : `${shortDay(from)} to ${shortDay(to)}`);
