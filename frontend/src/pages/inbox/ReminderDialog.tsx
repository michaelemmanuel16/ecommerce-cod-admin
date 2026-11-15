import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '../../components/ui-v2';
import { inboxService, type InboxSubject } from '../../services/inbox.service';
import { apiErrorMessage } from '../../utils/apiError';
import { dueAtOf, hm, isNoteSubject, subjectLabel, ymd } from './model';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The item the reminder is about. Only orders, customers, payouts and products can be linked. */
  subject: InboxSubject | null;
  /** Text to start with, for example the title of the row. */
  note?: string;
  onSaved: () => void;
}

const tomorrowNine = (): Date => {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(9, 0, 0, 0);
  return d;
};

/** New reminder (M9-T37). A time in the past is blocked in the picker (`min`) and by the message; the API refuses it too. */
export function ReminderDialog({ open, onClose, subject, note = '', onSaved }: Props) {
  const say = useToast();
  const [what, setWhat] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const link = isNoteSubject(subject) ? subject : null;

  useEffect(() => {
    if (!open) return;
    const d = tomorrowNine();
    setWhat(note);
    setDate(ymd(d));
    setTime(hm(d));
  }, [open, note]);

  const due = dueAtOf(date, time);
  const past = due !== null && due.getTime() <= Date.now();
  const valid = what.trim().length > 0 && due !== null && !past;

  const save = async () => {
    if (!valid || !due || saving) return;
    setSaving(true);
    try {
      await inboxService.createReminder({
        note: what.trim(),
        dueAt: due.toISOString(),
        ...(link ? { subjectType: link.type, subjectId: link.id } : {}),
      });
      say('Reminder set');
      onSaved();
      onClose();
    } catch (e) {
      say(apiErrorMessage(e, 'The reminder was not saved'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New reminder"
      description="You get a notice in your Inbox when it is due."
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || saving} onClick={save}>Create reminder</Button>
        </>
      )}
    >
      <Input label="What" value={what} maxLength={1000} onChange={(e) => setWhat(e.target.value)} placeholder="Collect the cash from the agent" />
      {link && <p className="rlink">Linked to <b>{subjectLabel(link)}</b></p>}
      <div className="f2">
        <Input label="Due date" type="date" value={date} min={ymd(new Date())} onChange={(e) => setDate(e.target.value)} />
        <Input label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} error={past ? 'Pick a time that has not passed yet' : undefined} />
      </div>
    </Modal>
  );
}
