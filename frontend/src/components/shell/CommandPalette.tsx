import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShoppingBag, Sparkles, User, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/authStore';
import { useShellStore } from '../../stores/shellStore';
import { searchService, type SearchResults } from '../../services/search.service';
import { formatCurrency, formatPhoneLocal } from '../../utils/format';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { useLayer } from '../ui-v2/useLayer';
import { useToast } from '../ui-v2';
import {
  ACTIONS, goPages, shortcutHint, shortcutTarget, visibleActions, type PaletteAction,
} from './commandPaletteModel';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;
/** `G` then a letter: the second key must come within this time. */
const CHORD_MS = 1500;

const typing = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

interface Row {
  id: string;
  icon: LucideIcon;
  accent?: boolean;
  label: string;
  hint?: string;
  run: () => void;
}
interface Section {
  title: string;
  rows: Row[];
}

/**
 * The ⌘K command palette (M3-T35, F-105), built from the mockup's `.veil > .cmdk`. It is mounted once in the shell.
 * It opens on cmd+K / ctrl+K and on a click of the top-bar search box (both flip `paletteOpen` in the shell store),
 * and it owns the `G` + letter page shortcuts, which work while the palette is closed.
 */
export function CommandPalette({ actions = ACTIONS }: { actions?: PaletteAction[] }) {
  const open = useShellStore((s) => s.paletteOpen);
  const setOpen = useShellStore((s) => s.setPaletteOpen);
  const user = useAuthStore((s) => s.user);
  const menu = useAuthStore((s) => s.menu);
  const navigate = useNavigate();

  const pages = useMemo(
    () => goPages(menu, user?.role ?? '', !!user?.isPlatformAdmin),
    [menu, user?.role, user?.isPlatformAdmin],
  );

  useEffect(() => {
    let chordAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useShellStore.getState().paletteOpen);
        return;
      }
      if (useShellStore.getState().paletteOpen || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'g') {
        chordAt = Date.now();
        return;
      }
      const armed = Date.now() - chordAt < CHORD_MS;
      chordAt = 0;
      if (!armed) return;
      const to = shortcutTarget(key, pages);
      if (to) {
        e.preventDefault();
        navigate(to);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pages, navigate, setOpen]);

  if (!open) return null;
  return <Panel pages={pages} menu={menu} actions={actions} onClose={() => setOpen(false)} />;
}

interface PanelProps {
  pages: ReturnType<typeof goPages>;
  menu: string[] | null;
  actions: PaletteAction[];
  onClose: () => void;
}

// Mounted only while the palette is open, so the query, results and selection start fresh every time.
function Panel({ pages, menu, actions, onClose }: PanelProps) {
  const navigate = useNavigate();
  const say = useToast();
  const setDrawerOpen = useShellStore((s) => s.setDrawerOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [selected, setSelected] = useState(0);
  const latest = useRef(0);

  useLayer(true, panelRef, onClose);

  const term = query.trim();
  const searching = term.length >= MIN_CHARS;

  // Search fires from 3 characters, after a short pause. Each request gets a number; a response whose number is no
  // longer the latest is dropped, so a slow older answer never replaces a newer one.
  useEffect(() => {
    const id = ++latest.current;
    if (!searching) {
      setResults(null);
      setState('idle');
      return;
    }
    setState('loading');
    const timer = setTimeout(() => {
      searchService.search(term).then(
        (found) => {
          if (id !== latest.current) return;
          setResults(found);
          setState('idle');
        },
        () => {
          if (id !== latest.current) return;
          setResults(null);
          setState('error');
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, searching]);

  const sections = useMemo<Section[]>(() => {
    const go = (to: string) => () => { onClose(); navigate(to); };
    const needle = term.toLowerCase();

    const ask: Section = {
      title: 'Ask the agent',
      rows: [{
        id: 'ask',
        icon: Sparkles,
        accent: true,
        label: term ? `Ask: ${term}` : 'Ask the agent a question',
        hint: '↵',
        run: () => {
          // The drawer mount point opens; the agent itself arrives in M11, so the person gets a plain message.
          onClose();
          setDrawerOpen(true);
          say('The agent is not available yet.');
        },
      }],
    };
    const goTo: Section = {
      title: 'Go to',
      rows: pages
        .filter((p) => !needle || p.label.toLowerCase().includes(needle))
        .map((p) => ({ id: `go-${p.key}`, icon: p.icon, label: p.label, hint: shortcutHint(p.key) ?? undefined, run: go(p.to as string) })),
    };
    const act: Section = {
      title: 'Actions',
      rows: visibleActions(menu, actions)
        .filter((a) => !needle || a.label.toLowerCase().includes(needle))
        .map((a) => ({ id: `act-${a.key}`, icon: a.icon, label: a.label, run: go(a.to as string) })),
    };

    const found: Section[] = [];
    if (searching && results) {
      found.push({
        title: 'Orders',
        rows: results.orders.map((o) => ({
          id: `order-${o.id}`,
          icon: ShoppingBag,
          label: `#${o.id}${o.customer ? ` · ${o.customer.firstName} ${o.customer.lastName}`.trimEnd() : ''}`,
          hint: `${formatCurrency(o.totalAmount)} · ${ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS] ?? o.status}`,
          run: go(`/orders/${o.id}`),
        })),
      }, {
        title: 'Customers',
        rows: results.customers.map((c) => ({
          id: `customer-${c.id}`,
          icon: User,
          label: `${c.firstName} ${c.lastName}`.trim(),
          hint: formatPhoneLocal(c.phoneNumber),
          run: go(`/customers/${c.id}`),
        })),
      });
    }
    // With a search term the matches come first, so Enter opens the first match.
    return [...found, ask, goTo, act].filter((s) => s.rows.length > 0);
  }, [term, searching, results, pages, menu, actions, navigate, onClose, setDrawerOpen, say]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  useEffect(() => setSelected(0), [flat.length, term]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[selected]?.run();
    }
  };

  useEffect(() => {
    panelRef.current?.querySelector('.it.sel')?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const noMatch = searching && state === 'idle' && results && results.orders.length + results.customers.length === 0;
  let index = -1;

  return (
    <div className="veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} className="cmdk" role="dialog" aria-modal="true" aria-label="Command menu" tabIndex={-1}>
        <div className="in">
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command or ask a question…"
            aria-label="Command menu search"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={flat[selected] ? `cmdk-${flat[selected].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="list" id="cmdk-list" role="listbox">
          {state === 'loading' && <p className="note" role="status">Searching…</p>}
          {state === 'error' && <p className="note" role="status">Search is not available right now.</p>}
          {noMatch && <p className="note" role="status">No orders or customers match “{term}”.</p>}
          {sections.map((s) => (
            <div key={s.title} role="group" aria-label={s.title}>
              <p aria-hidden="true">{s.title}</p>
              {s.rows.map((r) => {
                const i = ++index;
                return (
                  <button
                    key={r.id}
                    id={`cmdk-${r.id}`}
                    type="button"
                    role="option"
                    aria-selected={i === selected}
                    tabIndex={-1}
                    className={clsx('it', i === selected && 'sel')}
                    onMouseMove={() => i !== selected && setSelected(i)}
                    onClick={r.run}
                  >
                    <r.icon className={r.accent ? 'accent' : undefined} />
                    {r.label}
                    {r.hint && <small>{r.hint}</small>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
