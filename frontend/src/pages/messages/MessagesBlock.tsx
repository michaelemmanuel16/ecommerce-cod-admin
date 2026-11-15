import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, Tag, type TagTone } from '../../components/ui-v2';
import { messagesService } from '../../services/messages.service';
import { formatRelativeTime } from '../../utils/format';
import { CHANNEL_LABEL, STATUS_LABEL, stamp } from './format';
import type { MessageStatus, TrackedMessages } from './types';

const STATUS_TONE: Record<MessageStatus, TagTone> = { pending: 'n', sent: 'n', delivered: 'ok', read: 'ok', failed: 'bad', replied: 'v', skipped: 'warn' };

interface Props {
  type: 'order' | 'customer';
  id: number;
  /** The customer's phone. With it, the block links to their conversation (when the person may open Messages). */
  phone?: string;
  /** May open the Messages page. */
  canOpenConversation: boolean;
  /** Words for the empty state. */
  emptyText: string;
}

/**
 * The messages sent about one order or to one customer (M9-T36, F-464): channel, status and time, newest first.
 * Everything comes from `GET /api/{orders|customers}/:id/messages`; the block shows it and calculates nothing.
 */
export function MessagesBlock({ type, id, phone, canOpenConversation, emptyText }: Props) {
  const [data, setData] = useState<TrackedMessages | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    messagesService.forSubject(type, id).then((d) => { if (live) setData(d); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [type, id]);

  if (failed) return <p className="hint">The messages did not load.</p>;
  if (!data) return <Skeleton height={56} />;
  if (data.items.length === 0) return <p className="hint">{emptyText}</p>;

  const optedOut = data.optOut ? (Object.entries(data.optOut) as Array<[keyof typeof CHANNEL_LABEL, boolean]>).filter(([, off]) => off).map(([ch]) => CHANNEL_LABEL[ch]) : [];

  return (
    <div className="mtrk">
      {optedOut.length > 0 && <p className="hint">Opted out of: {optedOut.join(', ')}.</p>}
      <ul>
        {data.items.map((m) => (
          <li key={m.id} className={m.direction === 'inbound' ? 'in' : undefined}>
            <div className="r1">
              <b>{CHANNEL_LABEL[m.channel]}{m.direction === 'inbound' ? ' reply' : ''}</b>
              <Tag tone={STATUS_TONE[m.status] ?? 'n'}>{STATUS_LABEL[m.status] ?? m.status}</Tag>
              <time dateTime={m.at} title={stamp(m.at)}>{formatRelativeTime(m.at)}</time>
            </div>
            <p>{m.bodyPreview}</p>
            {m.status === 'failed' && m.errorMessage && <small>{m.errorMessage}</small>}
          </li>
        ))}
      </ul>
      {canOpenConversation && phone && (
        <Link className="lnk" to={`/messages?tab=conversations&q=${encodeURIComponent(phone)}`}>Open the conversation</Link>
      )}
    </div>
  );
}
