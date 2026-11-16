import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCheck, CornerUpLeft, Clock, MessageCircle, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Select, Skeleton, Tag, useToast } from '../../components/ui-v2';
import { messagesService } from '../../services/messages.service';
import { apiMessage } from '../orders/importText';
import { formatStamp } from '../../utils/format';
import { CHANNEL_LABEL, STATUS_LABEL, initials } from './format';
import { ReplyBox } from './ReplyBox';
import { renderWhatsAppText } from './whatsappText';
import { useLoad } from './useLoad';
import type { Assignee, ConversationRow, MessageStatus, ThreadMessage } from './types';

const STATUS_ICON: Record<MessageStatus, typeof Check> = {
  pending: Clock, sent: Check, delivered: CheckCheck, read: Eye, failed: AlertCircle, replied: CornerUpLeft, skipped: AlertCircle,
};

interface Props {
  row: ConversationRow;
  meId: number | null;
  canWrite: boolean;
  /** A rep may hand a conversation only to themselves, so they get no list of people. */
  canPickPeople: boolean;
  /** The list reloads after a write (reply, assign, done). */
  onChanged: (patch?: Partial<ConversationRow>) => void;
}

function Bubble({ m, quoted }: { m: ThreadMessage; quoted: ThreadMessage | undefined }) {
  const out = m.direction === 'outbound';
  const Icon = STATUS_ICON[m.status];
  return (
    <div className={out ? 'b out' : 'b in'}>
      {quoted && <div className="quote"><CornerUpLeft />Replying to: {quoted.messageBody.slice(0, 80)}</div>}
      <div className="bub">{renderWhatsAppText(m.messageBody)}</div>
      <div className="mst-row">
        <span className="mst-time">{formatStamp(m.createdAt)}</span>
        {out && <span className={`mst ${m.status}`}><Icon />{STATUS_LABEL[m.status]}</span>}
        {m.orderId && <Link className="lnk" to={`/orders/${m.orderId}`}>Order #{m.orderId}</Link>}
      </div>
      {out && m.status === 'failed' && m.errorMessage && <div className="failnote"><AlertCircle />{m.errorMessage}</div>}
    </div>
  );
}

/** The right pane: header with Assign and Mark done, the messages in order, and the reply box. */
export function Thread({ row, meId, canWrite, canPickPeople, onChanged }: Props) {
  const say = useToast();
  const thread = useLoad(() => messagesService.getThread(row.id), String(row.id));
  const people = useLoad(() => messagesService.assignees(), 'people', canWrite && canPickPeople);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const messages = thread.data?.messages;
  // Scroll the message box itself: scrollIntoView would scroll the whole page
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [messages?.length, row.id]);

  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);

  const options = useMemo<Assignee[]>(() => {
    const base: Assignee[] = canPickPeople ? (people.data ?? []) : meId !== null ? [{ id: meId, name: 'Me' }] : [];
    // The person on the conversation may not be in the list (left the store): keep them selectable so the select shows them
    const a = row.assignedTo;
    return a && !base.some((o) => o.id === a.id) ? [...base, { id: a.id, name: a.name ?? 'Unknown' }] : base;
  }, [canPickPeople, people.data, meId, row.assignedTo]);

  const write = async (work: () => Promise<void>, done: string, patch: Partial<ConversationRow>) => {
    setSaving(true);
    try {
      await work();
      say(done);
      onChanged(patch);
      await thread.reload();
    } catch (err) {
      say(await apiMessage(err, 'The change was not saved'));
    } finally {
      setSaving(false);
    }
  };

  const isDone = row.status === 'done';
  return (
    <>
      <div className="thhead">
        <div className="a avatar-dot">{initials(row.displayName)}</div>
        <div>
          <b>{row.displayName}</b>
          <small>{row.phone} · {CHANNEL_LABEL[row.channel]}</small>
        </div>
        <div className="rt">
          {isDone && <Tag tone="n">Done</Tag>}
          {canWrite && (
            <>
              <Select
                compact label="Assign to" value={row.assignedTo ? String(row.assignedTo.id) : ''} disabled={saving}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const person = options.find((o) => o.id === id);
                  void write(() => messagesService.update(row.id, { assignedToId: id }), id ? 'Conversation assigned' : 'Conversation unassigned', { assignedTo: id && person ? { id, name: person.name === 'Me' ? 'You' : person.name } : null });
                }}
              >
                <option value="">Unassigned</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.id === meId && o.name !== 'Me' ? `${o.name} (me)` : o.name}</option>)}
              </Select>
              <Button disabled={saving} onClick={() => void write(() => messagesService.update(row.id, { status: isDone ? 'open' : 'done' }), isDone ? 'Conversation reopened' : 'Marked as done', { status: isDone ? 'open' : 'done' })}>
                <Check style={{ width: 15, height: 15 }} />{isDone ? 'Reopen' : 'Mark done'}
              </Button>
            </>
          )}
          {!canWrite && row.assignedTo && <Tag tone="n">With {row.assignedTo.name}</Tag>}
        </div>
      </div>

      <div className="msgs" ref={box} aria-label="Conversation messages" aria-busy={thread.loading}>
        {thread.data === null && thread.loading && <Skeleton height={120} />}
        {thread.failed && thread.data === null && (
          <EmptyState icon={<MessageCircle />} title="The messages did not load" action={<Button onClick={() => void thread.reload()}>Try again</Button>} />
        )}
        {messages?.length === 0 && <EmptyState icon={<MessageCircle />} title="No messages in this conversation" />}
        {messages?.map((m) => <Bubble key={m.id} m={m} quoted={m.inReplyToId ? byId.get(m.inReplyToId) : undefined} />)}
      </div>

      {canWrite && row.channel === 'whatsapp' && thread.data && (
        <ReplyBox
          conversationId={row.id} windowOpen={thread.data.conversation.windowOpen}
          onSent={() => { onChanged({ unanswered: false }); void thread.reload(); }}
        />
      )}
      {canWrite && row.channel !== 'whatsapp' && <p className="compose hint">Only WhatsApp conversations can be answered here.</p>}
    </>
  );
}
