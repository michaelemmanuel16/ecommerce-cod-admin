import { useEffect, useRef, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { Button, Select } from '../../components/ui-v2';
import { DateRange } from './DateRange';
import type { Option } from './useFilterOptions';
import { rangeOf, SEARCH_DEBOUNCE_MS, type ListView } from './urlState';

interface FilterBarProps {
  view: ListView;
  /** replace: true for typing, so the Back button does not step through every key press. */
  onChange: (next: ListView, replace?: boolean) => void;
  products: Option[];
  agents: Option[];
  reps: Option[];
  children?: React.ReactNode;
}

/** Search, filters and date range of the Orders list (F-310 to F-312). Every change goes to the URL and resets to page 1. */
export function FilterBar({ view, onChange, products, agents, reps, children }: FilterBarProps) {
  const [draft, setDraft] = useState(view.q);
  const latest = useRef(view);
  latest.current = view;
  const change = (patch: Partial<ListView>, replace = false) => onChange({ ...latest.current, ...patch, page: 1 }, replace);

  // a link, a tab click or Back changed the search: show it
  useEffect(() => setDraft(view.q), [view.q]);
  // typing: wait 300 ms after the last key press
  useEffect(() => {
    const next = draft.trim();
    if (next === latest.current.q) return;
    const timer = setTimeout(() => change({ q: next }, true), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const idOf = (v: string): number | null => (v ? Number(v) : null);

  return (
    <div className="filters">
      <label className="srch">
        <Search style={{ width: 16, height: 16 }} aria-hidden="true" />
        <input
          type="search"
          value={draft}
          maxLength={100}
          placeholder="Search order, phone or name"
          aria-label="Search orders"
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      {products.length > 0 && (
        <Select compact label="Product" value={view.product ?? ''} onChange={(e) => change({ product: idOf(e.target.value) })}>
          <option value="">All products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}
      {agents.length > 0 && (
        <Select compact label="Delivery agent" value={view.agent ?? ''} onChange={(e) => change({ agent: idOf(e.target.value) })}>
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      )}
      {reps.length > 0 && (
        <Select
          compact
          label="Assigned to"
          value={view.rep === null ? '' : String(view.rep)}
          onChange={(e) => change({ rep: e.target.value === 'none' ? 'none' : idOf(e.target.value) })}
        >
          <option value="">Any call rep</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          <option value="none">Unassigned</option>
        </Select>
      )}
      <Button variant={view.flagged ? 'primary' : 'default'} aria-pressed={view.flagged} onClick={() => change({ flagged: !view.flagged })}>
        <Sparkles style={{ color: view.flagged ? undefined : 'var(--violet)' }} />
        Flagged by agent
      </Button>
      <DateRange
        range={rangeOf(view)}
        basis={view.basis}
        onRange={(r) => change({ from: r.from, to: r.to })}
        onBasis={(basis) => change({ basis })}
      />
      {children}
    </div>
  );
}
