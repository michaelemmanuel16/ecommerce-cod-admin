import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Inbox, Search } from 'lucide-react';
import { Button, EmptyState, Skeleton, Tag } from '../../components/ui-v2';
import { messagesService, type ConversationQuery } from '../../services/messages.service';
import { formatRelativeTime } from '../../utils/format';
import { CHANNEL_LABEL, initials } from './format';
import { Thread } from './Thread';
import type { ConversationRow } from './types';

type Filter = 'unanswered' | 'mine' | 'all';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'unanswered', label: 'Unanswered' },
  { id: 'mine', label: 'Mine' },
  { id: 'all', label: 'All' },
];

const queryFor = (filter: Filter, q: string): ConversationQuery => ({
  ...(filter === 'unanswered' ? { status: 'open' as const, unanswered: true } : filter === 'mine' ? { status: 'open' as const, assignedTo: 'me' as const } : {}),
  ...(q ? { q } : {}),
});

interface Props {
  meId: number | null;
  /** Reply, assign and Mark done: the messages:create permission. */
  canWrite: boolean;
  /** Owner, admin and manager can hand a conversation to anyone; a rep only to themselves. */
  canPickPeople: boolean;
  /** A phone or name to start the search with (the "Open the conversation" link of an order or customer). It also shows every conversation, not only the unanswered. */
  initialSearch?: string;
}

/** Conversations (F-454): list on the left, thread on the right. The API scopes the list: a rep sees only theirs. */
export function ConversationsTab({ meId, canWrite, canPickPeople, initialSearch = '' }: Props) {
  const [filter, setFilter] = useState<Filter>(initialSearch ? 'all' : 'unanswered');
  const [search, setSearch] = useState(initialSearch);
  const [q, setQ] = useState(initialSearch.trim());
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // The open conversation is kept apart from the list: a reply can move it out of the filter (answered), and it stays open
  const [open, setOpen] = useState<ConversationRow | null>(null);
  const request = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async (more: string | null) => {
    const id = ++request.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await messagesService.listConversations({ ...queryFor(filter, q), ...(more ? { cursor: more } : {}) });
      if (id !== request.current) return;
      setRows((old) => (more && old ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch {
      if (id === request.current) setFailed(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [filter, q]);

  useEffect(() => { void load(null); }, [load]);

  // A reloaded list brings the fresh row of the open conversation
  useEffect(() => {
    setOpen((o) => (o && rows?.find((r) => r.id === o.id)) || o);
  }, [rows]);

  return (
    <div className="inbox" role="tabpanel" aria-label="Conversations">
      <div className="pane">
        <div className="lhead">
          <div className="seg" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={f.id === filter ? 'on' : undefined} aria-pressed={f.id === filter} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          <label className="srch">
            <Search />
            <input type="search" aria-label="Search conversations" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        <div className="threads" aria-busy={loading}>
          {rows === null && loading && <div className="pad"><Skeleton height={64} /></div>}
          {failed && rows === null && (
            <EmptyState icon={<Inbox />} title="Conversations did not load" action={<Button onClick={() => void load(null)}>Try again</Button>} />
          )}
          {rows?.length === 0 && (
            <EmptyState
              icon={<Inbox />} title={q ? 'No conversation matches' : filter === 'unanswered' ? 'Nobody is waiting for an answer' : 'No conversations yet'}
              text={q ? undefined : 'When a customer writes back, the conversation shows here.'}
            />
          )}
          {rows?.map((r) => (
            <button key={r.id} type="button" className={clsx('th', r.id === open?.id && 'on', r.unanswered && 'un')} aria-current={r.id === open?.id ? 'true' : undefined} onClick={() => setOpen(r)}>
              <div className="a avatar-dot">{initials(r.displayName)}</div>
              <div className="tx">
                <div className="r1"><b>{r.displayName}{r.unanswered && <i className="udot" role="img" aria-label="Not answered" />}</b><small>{formatRelativeTime(r.lastMessageAt)}</small></div>
                <p>{r.lastMessageDirection === 'outbound' ? 'You: ' : ''}{r.lastMessagePreview ?? 'No messages'}</p>
                <div className="r3">
                  <span>{CHANNEL_LABEL[r.channel]}</span>
                  <span>{r.assignedTo ? r.assignedTo.name : 'Unassigned'}</span>
                  {r.status === 'done' && <Tag tone="n">Done</Tag>}
                </div>
              </div>
            </button>
          ))}
          {cursor && <div className="pad"><Button disabled={loading} onClick={() => void load(cursor)}>Load more</Button></div>}
        </div>
      </div>
      <div className="pane" aria-label="Thread">
        {open ? (
          <Thread key={open.id} row={open} meId={meId} canWrite={canWrite} canPickPeople={canPickPeople} onChanged={(patch) => { setOpen((o) => (o ? { ...o, ...patch } : o)); void load(null); }} />
        ) : (
          <EmptyState icon={<Inbox />} title="Pick a conversation" text="Its messages show here." />
        )}
      </div>
    </div>
  );
}
