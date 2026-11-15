import { useCallback, useEffect, useMemo, useState } from 'react';
import { AtSign, Send } from 'lucide-react';
import { Button, Skeleton, useToast } from '../../components/ui-v2';
import { inboxService, type InboxSubject, type Mentionable, type NoteThread, type ThreadComment } from '../../services/inbox.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatRelativeTime } from '../../utils/format';
import { initials } from '../../utils/people';

interface Props {
  subject: InboxSubject | null;
  /** The thread was opened or written to: the row may now be read. */
  onTouched?: () => void;
}

/** The trailing `@word` the person is typing, which opens the picker. */
const TRAILING_MENTION = /(?:^|\s)@(\S*)$/;

/**
 * A team note thread (M9-T37): the notes, the reply and the composer. Comments are plain text, rendered as text.
 * The mention picker lists only what `GET .../mentionable` returns: active people of this business who can open
 * the item. The Inbox shows it in a drawer (ThreadDrawer); the order drawer and the customer page show it inline (M9-T36).
 */
export function ThreadPanel({ subject, onTouched }: Props) {
  const say = useToast();
  const [thread, setThread] = useState<NoteThread | null>(null);
  const [failed, setFailed] = useState(false);
  const [people, setPeople] = useState<Mentionable[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<ThreadComment | null>(null);
  const [picker, setPicker] = useState(false);
  const [sending, setSending] = useState(false);

  const type = subject?.type;
  const id = subject?.id;

  const read = useCallback(async () => {
    if (!type || id === undefined) return;
    try {
      setThread(await inboxService.getThread(type, id));
      setFailed(false);
      onTouched?.();
    } catch {
      setFailed(true);
    }
  }, [type, id, onTouched]);

  useEffect(() => {
    setThread(null);
    setFailed(false);
    setBody('');
    setReplyTo(null);
    setPicker(false);
    setPeople([]);
    if (!type || id === undefined) return;
    void read();
    inboxService.mentionable(type, id).then(setPeople).catch(() => setPeople([]));
  }, [type, id, read]);

  const partial = TRAILING_MENTION.exec(body)?.[1];
  const options = useMemo(() => {
    const q = (partial ?? '').toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(q));
  }, [people, partial]);
  const showPicker = picker || partial !== undefined;

  const pick = (p: Mentionable) => {
    setBody((b) => (TRAILING_MENTION.test(b) ? b.replace(/@\S*$/, `@${p.name} `) : `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${p.name} `));
    setPicker(false);
  };

  const send = async () => {
    if (!type || id === undefined || !body.trim() || sending) return;
    setSending(true);
    // Only people whose @Name is still in the text are mentioned
    const mentionIds = people.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    try {
      await inboxService.addComment(type, id, { body, ...(replyTo ? { parentId: replyTo.id } : {}), ...(mentionIds.length ? { mentionIds } : {}) });
      setBody('');
      setReplyTo(null);
      await read();
    } catch (e) {
      say(apiErrorMessage(e, 'The note was not sent'));
    } finally {
      setSending(false);
    }
  };

  const comment = (c: ThreadComment, reply = false) => (
    <div key={c.id} className={reply ? 'm re' : 'm'}>
      <div className="a" aria-hidden="true">{initials(c.authorName)}</div>
      <div className="bub">
        <div className="nm">{c.authorName}<small>{formatRelativeTime(c.createdAt)}{c.edited ? ', edited' : ''}</small></div>
        <div className={c.deleted ? 'tx gone' : 'tx'}>{c.body}</div>
        {!reply && !c.deleted && !thread?.archived && (
          <button type="button" className="mini" onClick={() => setReplyTo(c)}>Reply</button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="thr-body">
        {failed ? (
          <p className="thr-msg">The thread did not load. <button type="button" className="mini" onClick={() => void read()}>Try again</button></p>
        ) : !thread ? (
          <Skeleton height={80} />
        ) : thread.comments.length === 0 ? (
          <p className="thr-msg">No notes yet. Start the thread below.</p>
        ) : (
          <div className="tmsgs">
            {thread.comments.map((c) => (
              <div key={c.id}>
                {comment(c)}
                {(c.replies ?? []).map((r) => comment(r, true))}
              </div>
            ))}
          </div>
        )}
      </div>

      {thread?.archived ? (
        <p className="thr-msg">This thread is closed because the item was deleted.</p>
      ) : thread && (
        <div className="comp">
          {replyTo && <p className="thr-reply">Replying to {replyTo.authorName} <button type="button" className="mini" onClick={() => setReplyTo(null)}>Cancel reply</button></p>}
          {showPicker && options.length > 0 && (
            <div className="mnl" role="listbox" aria-label="People you can mention">
              {options.map((p) => (
                <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => pick(p)}>{p.name}<small>{p.role.replace('_', ' ')}</small></button>
              ))}
            </div>
          )}
          <textarea value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="Write a note. Type @ to mention a teammate." aria-label="Team note" />
          <div className="crow">
            <Button size="mini" onClick={() => setPicker((p) => !p)} aria-label="Mention a teammate"><AtSign size={13} /> Mention</Button>
            <span className="sp" />
            <Button variant="primary" disabled={!body.trim() || sending} onClick={send}><Send /> Send</Button>
          </div>
        </div>
      )}
    </>
  );
}
