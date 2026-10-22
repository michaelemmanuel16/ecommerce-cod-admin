import { useCallback, useRef, useState } from 'react';
import { readPref, writePref } from './prefs';

export type ColumnId = 'select' | 'order' | 'customer' | 'altPhone' | 'product' | 'status' | 'rep' | 'agent' | 'amount' | 'date' | 'assign';

const DEFAULT_WIDTHS: Record<ColumnId, number> = {
  select: 48, order: 96, customer: 220, altPhone: 140, product: 210, status: 210, rep: 150, agent: 160, amount: 110, date: 130, assign: 64,
};
const MIN_WIDTH = 64;
/** F-307: the alternate phone is off until the person turns it on from the column menu. */
const DEFAULT_HIDDEN: ColumnId[] = ['altPhone'];
/** These three always show: without them a row cannot be told apart, opened or acted on. */
export const FIXED_COLUMNS: ColumnId[] = ['select', 'order', 'assign'];

interface Saved {
  widths: Partial<Record<ColumnId, number>>;
  hidden: ColumnId[];
}

/** Column widths and the hidden columns, saved per user (F-307). A resize saves when the drag ends. */
export function useColumnPrefs() {
  const [saved, setSaved] = useState<Saved>(() => {
    const s = readPref<Partial<Saved>>('columns', {});
    return { widths: s.widths ?? {}, hidden: s.hidden ?? DEFAULT_HIDDEN };
  });
  const latest = useRef(saved);
  latest.current = saved;

  const widthOf = useCallback((id: ColumnId) => saved.widths[id] ?? DEFAULT_WIDTHS[id], [saved.widths]);

  const setWidth = useCallback((id: ColumnId, width: number, commit: boolean) => {
    const next = { ...latest.current, widths: { ...latest.current.widths, [id]: Math.max(MIN_WIDTH, Math.round(width)) } };
    latest.current = next;
    setSaved(next);
    if (commit) writePref('columns', next);
  }, []);

  const toggle = useCallback((id: ColumnId) => {
    const cur = latest.current;
    const hidden = cur.hidden.includes(id) ? cur.hidden.filter((h) => h !== id) : [...cur.hidden, id];
    const next = { ...cur, hidden };
    latest.current = next;
    setSaved(next);
    writePref('columns', next);
  }, []);

  return { widthOf, setWidth, hidden: saved.hidden, toggle };
}
