import { useState } from 'react';
import { BellRing, CheckCheck, CheckCircle2, Inbox as InboxIcon, Moon } from 'lucide-react';
import clsx from 'clsx';
import { Button, EmptyState, Skeleton, Tag, useToast } from '../../components/ui-v2';
import { inboxService, type InboxItem, type InboxStatus, type InboxSubject, type InboxView as ViewId } from '../../services/inbox.service';
import { useAuthStore } from '../../stores/authStore';
import { useInboxStore } from '../../stores/inboxStore';
import { apiErrorMessage } from '../../utils/apiError';
import { formatDateTime } from '../../utils/format';
import { InboxRow } from './InboxRow';
import { ReminderDialog } from './ReminderDialog';
import { ThreadDrawer } from './ThreadDrawer';
import { UpcomingReminders } from './UpcomingReminders';
import { STATUS_EMPTY, VIEWS, isNoteSubject } from './model';
import { useInboxFeed } from './useInboxFeed';

interface Props {
  title: string;
  subtitle: string;
  /** The views offered, in order. The API serves them all. */
  views: ViewId[];
  /** Where "Open" goes for a subject in this app. */
  linkFor: (s: InboxSubject) => string | null;
  /** The rep app lays the views out as a strip above the list. */
  compact?: boolean;
}

type Pick = ViewId | 'snoozed' | 'done';
const OWNER_ROLES = ['admin', 'super_admin'];

/** The Inbox (M9-T37) for the admin app and the rep app: the same feed API, the same rows, the same actions. */
export function InboxView({ title, subtitle, views, linkFor, compact }: Props) {
  const say = useToast();
  const role = useAuthStore((s) => s.user?.role ?? '');
  const counts = useInboxStore((s) => s.counts);
  const [pick, setPick] = useState<Pick>('all');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [remind, setRemind] = useState<{ subject: InboxSubject | null; note: string } | null>(null);
  const [reminderVersion, setReminderVersion] = useState(0);
  const [thread, setThread] = useState<InboxSubject | null>(null);

  const status: InboxStatus = pick === 'snoozed' ? 'snoozed' : pick === 'done' ? 'done' : 'open';
  const view: ViewId = pick === 'snoozed' || pick === 'done' ? 'all' : pick;
  const isOwner = OWNER_ROLES.includes(role);
  const effectiveScope = isOwner ? scope : 'mine';
  const writable = effectiveScope === 'mine';
  const feed = useInboxFeed({ view, status, scope: effectiveScope });
  const defs = VIEWS.filter((v) => views.includes(v.id));
  const empty = status === 'open' ? defs.find((v) => v.id === view)?.empty ?? '' : STATUS_EMPTY[status];

  const applyCounts = (c: typeof counts) => { if (c) useInboxStore.setState({ counts: c }); };
  const fail = (e: unknown, fallback: string) => say(apiErrorMessage(e, fallback));

  const onRead = async (item: InboxItem) => {
    try {
      const r = await inboxService.patch(item.id, { read: true });
      feed.replace(r.item);
      applyCounts(r.counts);
    } catch (e) { fail(e, 'Could not mark it read'); }
  };
  const onDone = async (item: InboxItem, done: boolean) => {
    try {
      const r = await inboxService.patch(item.id, { done });
      feed.remove(item.id);
      applyCounts(r.counts);
      say(done ? 'Marked done' : 'Back in your inbox');
    } catch (e) { fail(e, 'Could not update it'); }
  };
  const onSnooze = async (item: InboxItem, at: Date | null) => {
    try {
      const r = await inboxService.patch(item.id, { snoozedUntil: at ? at.toISOString() : null });
      feed.remove(item.id);
      applyCounts(r.counts);
      say(at ? `Snoozed until ${formatDateTime(at)}` : 'Snooze stopped');
    } catch (e) { fail(e, 'Could not snooze it'); }
  };
  const onThread = (item: InboxItem) => {
    if (!item.subject || !isNoteSubject(item.subject)) return;
    setThread(item.subject);
    if (!item.isRead) void onRead(item);
  };
  const onMarkAll = async () => {
    try {
      const r = await inboxService.markAll(view);
      applyCounts(r.counts);
      await feed.reload();
      say(r.updated > 0 ? `Marked ${r.updated} as read` : 'Nothing was unread');
    } catch (e) { fail(e, 'Could not mark them read'); }
  };

  const unreadHere = counts ? counts[view] : 0;
  const railCount = (id: ViewId) => (counts && counts[id] > 0 ? counts[id] : null);

  return (
    <section className={clsx('inbx', compact && 'compact')} aria-label={title}>
      <div className="head">
        <div><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="hd-actions">
          {isOwner && (
            <div className="seg" role="group" aria-label="Whose rows">
              <button type="button" className={scope === 'mine' ? 'on' : ''} aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>Mine</button>
              <button type="button" className={scope === 'all' ? 'on' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Everyone</button>
            </div>
          )}
          {writable && <Button onClick={onMarkAll} disabled={status !== 'open' || unreadHere === 0}><CheckCheck /> Mark all read</Button>}
          {writable && <Button onClick={() => setRemind({ subject: null, note: '' })}><BellRing /> New reminder</Button>}
        </div>
      </div>

      <div className="inbox">
        <nav className="card rail" aria-label="Inbox views">
          {defs.map((v) => (
            <button key={v.id} type="button" className={pick === v.id ? 'on' : ''} aria-current={pick === v.id ? 'true' : undefined} onClick={() => setPick(v.id)}>
              <v.icon /><span>{v.label}</span>
              {railCount(v.id) !== null && <span className={clsx('cnt', (v.id === 'all' || v.id === 'reminders') && 'hot')}>{railCount(v.id)}</span>}
            </button>
          ))}
          <hr />
          <button type="button" className={pick === 'snoozed' ? 'on' : ''} aria-current={pick === 'snoozed' ? 'true' : undefined} onClick={() => setPick('snoozed')}><Moon /><span>Snoozed</span></button>
          <button type="button" className={pick === 'done' ? 'on' : ''} aria-current={pick === 'done' ? 'true' : undefined} onClick={() => setPick('done')}><CheckCircle2 /><span>Done</span></button>
        </nav>

        <div className="istack">
          {writable && pick === 'reminders' && <UpcomingReminders version={reminderVersion} />}
          <div className="card">
            <div className="sub">
              <h3>{pick === 'snoozed' ? 'Snoozed' : pick === 'done' ? 'Done' : defs.find((v) => v.id === pick)?.label}</h3>
              {feed.state === 'ready' && <Tag tone="n">{feed.items.length}{feed.hasMore ? '+' : ''}</Tag>}
            </div>
            {feed.state === 'loading' ? (
              <div aria-busy="true" aria-label="Loading"><Skeleton height={64} /><Skeleton height={64} /><Skeleton height={64} /></div>
            ) : feed.state === 'failed' ? (
              <EmptyState title="The Inbox did not load" text="Check your connection and try again." action={<Button onClick={() => void feed.reload()}>Try again</Button>} />
            ) : feed.items.length === 0 ? (
              <EmptyState icon={<InboxIcon />} title={empty} />
            ) : (
              <>
                {feed.items.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    status={status}
                    writable={writable}
                    linkFor={linkFor}
                    onRead={onRead}
                    onDone={onDone}
                    onSnooze={onSnooze}
                    onRemind={(i) => setRemind({ subject: i.subject, note: i.title })}
                    onThread={onThread}
                  />
                ))}
                {feed.hasMore && (
                  <div className="more"><Button onClick={() => void feed.loadMore()} disabled={feed.loadingMore}>{feed.loadingMore ? 'Loading' : 'Show older'}</Button></div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <ReminderDialog
        open={remind !== null}
        onClose={() => setRemind(null)}
        subject={remind?.subject ?? null}
        note={remind?.note ?? ''}
        onSaved={() => setReminderVersion((v) => v + 1)}
      />
      <ThreadDrawer subject={thread} onClose={() => setThread(null)} />
    </section>
  );
}
