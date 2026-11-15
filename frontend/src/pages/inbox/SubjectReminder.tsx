import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button, useToast } from '../../components/ui-v2';
import { inboxService, type InboxSubject, type Reminder } from '../../services/inbox.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatDateTime } from '../../utils/format';
import { ReminderDialog } from './ReminderDialog';

interface Props {
  subject: InboxSubject;
  /** Text the reminder starts with. */
  note: string;
}

/**
 * "Set reminder" for one item (M9-T36, F-325): the person's pending reminders on it, a button for a new one, and a way
 * to cancel. The date picker blocks the past (ReminderDialog); the API refuses it too.
 */
export function SubjectReminder({ subject, note }: Props) {
  const say = useToast();
  const [mine, setMine] = useState<Reminder[]>([]);
  const [open, setOpen] = useState(false);
  const { type, id } = subject;

  const load = useCallback(async () => {
    try {
      const all = await inboxService.listReminders('pending');
      setMine(all.filter((r) => r.subjectType === type && r.subjectId === id));
    } catch {
      setMine([]);
    }
  }, [type, id]);

  useEffect(() => { setMine([]); void load(); }, [load]);

  const cancel = async (r: Reminder) => {
    try {
      await inboxService.cancelReminder(r.id);
      say('Reminder cancelled');
      await load();
    } catch (e) {
      say(apiErrorMessage(e, 'The reminder was not cancelled'));
    }
  };

  return (
    <div className="fl">
      <label>Follow up</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button onClick={() => setOpen(true)}><Bell aria-hidden="true" /> Set reminder</Button>
        {mine.length === 0 && <span className="hint" style={{ marginTop: 0 }}>No reminder set.</span>}
      </div>
      {mine.map((r) => (
        <p key={r.id} className="hint">
          Reminder on {formatDateTime(r.dueAt)}: {r.note}{' '}
          <button type="button" className="mini" onClick={() => void cancel(r)}>Cancel reminder</button>
        </p>
      ))}
      <ReminderDialog open={open} onClose={() => setOpen(false)} subject={subject} note={note} onSaved={() => void load()} />
    </div>
  );
}
