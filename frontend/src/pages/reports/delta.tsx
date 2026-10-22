import type { ReactNode } from 'react';
import { Tag } from '../../components/ui-v2';
import type { Counted, RateTile } from './types';

type Good = 'up' | 'down';

/**
 * The "vs previous" row of a tile (mockup .dlt): a tag with the change and the earlier figure. The API sends the change;
 * this only picks the arrow and the colour. `good` says which direction is good news (failed deliveries going up is bad).
 * `hasPrevious` is false when compare is off: the tile then has no such row. A previous period with nothing in it reads "No data".
 */
function row(hasPrevious: boolean, change: number | null, unit: string, good: Good, previousText: string): ReactNode {
  if (!hasPrevious) return null;
  if (change === null) return <><Tag tone="n">No data</Tag>in the previous period</>;
  const whole = Math.round(change);
  if (whole === 0) return <><Tag tone="n">Same</Tag>vs {previousText}</>;
  const up = whole > 0;
  return <><Tag tone={up === (good === 'up') ? 'ok' : 'bad'}>{up ? '▲' : '▼'} {Math.abs(whole)}{unit}</Tag>vs {previousText}</>;
}

export function countChange(c: Counted, good: Good = 'up'): ReactNode {
  return row(c.previous !== null, c.deltaPercent, '%', good, (c.previous ?? 0).toLocaleString('en-US'));
}

/** A money tile: the previous figure is passed as text, already formatted. */
export function percentChange(deltaPercent: number | null, previousText: string | null, good: Good = 'up'): ReactNode {
  return row(previousText !== null, deltaPercent, '%', good, previousText ?? '');
}

export function rateChange(r: RateTile): ReactNode {
  return row(r.previous !== null, r.deltaPoints, ' pts', 'up', r.previous === null ? '' : `${Math.round(r.previous)}%`);
}

/** Figures that are a snapshot of today have no previous period. Shown only while compare is on. */
export const snapshotChange = (compare: boolean): ReactNode =>
  compare ? <><Tag tone="n">Snapshot</Tag>no previous figure</> : null;
