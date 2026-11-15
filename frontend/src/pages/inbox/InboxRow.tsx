import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, AlarmClockPlus, BellOff, Check, CheckCheck, ExternalLink, MessagesSquare, Undo2 } from 'lucide-react';
import { Tag } from '../../components/ui-v2';
import { notificationText } from '../../components/shell/notificationText';
import type { InboxItem, InboxStatus } from '../../services/inbox.service';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { isNoteSubject, kindIcon, kindLabel, snoozeChoices, subjectLabel } from './model';

export interface RowActions {
  onRead: (item: InboxItem) => void;
  onDone: (item: InboxItem, done: boolean) => void;
  onSnooze: (item: InboxItem, at: Date | null) => void;
  onRemind: (item: InboxItem) => void;
  onThread: (item: InboxItem) => void;
}

interface Props extends RowActions {
  item: InboxItem;
  status: InboxStatus;
  /** false when the owner reads everyone's rows: they are not theirs to change. */
  writable: boolean;
  /** Where "Open" goes for this subject; null when this app has no screen for it. */
  linkFor: (s: NonNullable<InboxItem['subject']>) => string | null;
}

/** One row of the feed (M9-T37): type, title, who, link, time, unread mark and the row actions. */
export function InboxRow({ item, status, writable, linkFor, onRead, onDone, onSnooze, onRemind, onThread }: Props) {
  const { icon: Icon, tone } = kindIcon(item.kind);
  const text = notificationText({ title: item.title, message: item.message, data: item.data, type: item.event });
  const subject = item.subject;
  const href = subject && item.subjectAccessible ? linkFor(subject) : null;
  const canThread = !!subject && isNoteSubject(subject) && item.subjectAccessible && (item.kind === 'mention' || item.kind === 'note');
  const unread = !item.isRead;
  const [snoozing, setSnoozing] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!snoozing) return;
    const away = (e: MouseEvent) => { if (!snoozeRef.current?.contains(e.target as Node)) setSnoozing(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSnoozing(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [snoozing]);

  const lnkText = subject ? subjectLabel(subject) : '';
  return (
    <div className={unread ? 'nrow unread' : 'nrow'} data-testid="inbox-row">
      <span className="ud" aria-hidden="true" />
      <div className={`nic t-${tone}`} aria-hidden="true"><Icon /></div>
      <div className="nbody">
        <b>{text.title}</b>
        {text.message && text.message !== text.title && <p className="nmsg">{text.message}</p>}
        <div className="meta">
          <Tag tone="n">{kindLabel(item.kind)}</Tag>
          <span>{item.actorName ?? 'System'}</span>
          {item.recipientName && <Tag tone="n">For {item.recipientName}</Tag>}
          <span aria-hidden="true">·</span>
          <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>{formatRelativeTime(item.createdAt)}</time>
          {item.snoozedUntil && !item.doneAt && <Tag tone="warn">Snoozed until {formatDateTime(item.snoozedUntil)}</Tag>}
          {item.doneAt && <Tag tone="ok">Done</Tag>}
          {unread && <span className="sr-only">Unread</span>}
        </div>
        {subject && (href ? (
          <Link className="lnk" to={href} onClick={() => writable && unread && onRead(item)}>{lnkText}</Link>
        ) : (
          <span className="lnk off">{lnkText}{item.subjectDeleted ? ', deleted' : !item.subjectAccessible ? ', not yours any more' : ''}</span>
        ))}
      </div>

      {writable && (
        <div className="qa">
          {canThread && subject && (
            <button type="button" aria-label="Open thread" title="Open thread" onClick={() => onThread(item)}><MessagesSquare /></button>
          )}
          {href && (
            <Link to={href} aria-label="Open" title="Open" onClick={() => unread && onRead(item)}><ExternalLink /></Link>
          )}
          {unread && <button type="button" aria-label="Mark read" title="Mark read" onClick={() => onRead(item)}><CheckCheck /></button>}
          {status === 'open' && (
            <>
              <button type="button" aria-label="Mark done" title="Mark done" onClick={() => onDone(item, true)}><Check /></button>
              <div className="snwrap" ref={snoozeRef}>
                <button type="button" aria-label="Snooze" title="Snooze" aria-haspopup="menu" aria-expanded={snoozing} onClick={() => setSnoozing((s) => !s)}><BellOff /></button>
                {snoozing && (
                  <div className="sn on" role="menu">
                    {snoozeChoices().map((c) => (
                      <button key={c.label} type="button" role="menuitem" onClick={() => { setSnoozing(false); onSnooze(item, c.at); }}>{c.label}</button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {status === 'snoozed' && <button type="button" aria-label="Stop snooze" title="Stop snooze" onClick={() => onSnooze(item, null)}><AlarmClock /></button>}
          {status === 'done' && <button type="button" aria-label="Reopen" title="Reopen" onClick={() => onDone(item, false)}><Undo2 /></button>}
          <button type="button" aria-label="Set reminder" title="Set reminder" onClick={() => onRemind(item)}><AlarmClockPlus /></button>
        </div>
      )}
    </div>
  );
}
