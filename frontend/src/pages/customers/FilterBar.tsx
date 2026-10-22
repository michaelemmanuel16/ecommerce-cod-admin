import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Search, Sparkles, X } from 'lucide-react';
import { Button, Select } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import { getCountryByCurrency, getRegionsForCountry } from '../../utils/countries';
import { isRisk, RISK_LABEL, RISKS } from './model';
import { SEARCH_DEBOUNCE_MS, type ListView } from './urlState';

interface FilterBarProps {
  view: ListView;
  /** replace: true for typing, so the Back button does not step through every key press. */
  onChange: (next: ListView, replace?: boolean) => void;
  /** The towns in use. */
  towns: string[];
}

/** Search and filters of the Customers list (F-352, F-353). Every change goes to the URL and resets to page 1. */
export function FilterBar({ view, onChange, towns }: FilterBarProps) {
  const [draft, setDraft] = useState(view.q);
  const latest = useRef(view);
  latest.current = view;
  const change = (patch: Partial<ListView>, replace = false) => onChange({ ...latest.current, ...patch, page: 1 }, replace);
  const currency = useConfigStore((s) => s.currency);
  const regions = useMemo(() => getRegionsForCountry(getCountryByCurrency(currency)), [currency]);

  // a link, a tab click or Back changed the search: show it
  useEffect(() => setDraft(view.q), [view.q]);
  // typing: wait 300 ms after the last key press
  useEffect(() => {
    const next = draft.trim();
    if (next === latest.current.q) return;
    const timer = setTimeout(() => change({ q: next }, true), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  return (
    <div className="filters">
      <label className="srch">
        <Search style={{ width: 16, height: 16 }} aria-hidden="true" />
        <input
          type="text"
          value={draft}
          maxLength={100}
          placeholder="Search name or phone"
          aria-label="Search customers"
          onChange={(e) => setDraft(e.target.value)}
        />
        {draft && (
          <button type="button" className="srchx" aria-label="Clear search" onClick={() => setDraft('')}>
            <X />
          </button>
        )}
      </label>
      <Select compact label="City/Town" value={view.town} onChange={(e) => change({ town: e.target.value })}>
        <option value="">All towns</option>
        {/* a town in the link that nobody lives in any more still shows as selected */}
        {(view.town && !towns.includes(view.town) ? [...towns, view.town] : towns).map((t) => <option key={t} value={t}>{t}</option>)}
      </Select>
      <Select compact label="State" value={view.region} onChange={(e) => change({ region: e.target.value })}>
        <option value="">All states</option>
        {(view.region && !regions.includes(view.region) ? [...regions, view.region] : regions).map((r) => <option key={r} value={r}>{r}</option>)}
      </Select>
      <Select compact label="Risk" value={view.risk ?? ''} onChange={(e) => change({ risk: isRisk(e.target.value) ? e.target.value : null })}>
        <option value="">Any risk</option>
        {RISKS.map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}
      </Select>
      <Button variant={view.blocked ? 'primary' : 'default'} aria-pressed={view.blocked} onClick={() => change({ blocked: !view.blocked })}>
        <Ban />
        Blocked
      </Button>
      <Button variant={view.flagged ? 'primary' : 'default'} aria-pressed={view.flagged} onClick={() => change({ flagged: !view.flagged })}>
        <Sparkles style={{ color: view.flagged ? undefined : 'var(--violet)' }} />
        Flagged by agent
      </Button>
    </div>
  );
}
