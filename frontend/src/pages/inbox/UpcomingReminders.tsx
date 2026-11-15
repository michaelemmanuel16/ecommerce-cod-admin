import { useCallback, useEffect, useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { Button, Tag, useToast } from '../../components/ui-v2';
import { inboxService, type Reminder } from '../../services/inbox.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatDateTime } from '../../utils/format';
import { isNoteSubject, subjectLabel } from './model';

/** Reminders you set that are not due yet, with Cancel. `version` goes up when a reminder was just created. */
export function UpcomingReminders({ version }: { version: number }) {
  const say = useToast();
  const [rows, setRows] = useState<Reminder[] | null>(null);

  const load = useCallback(() => {
    inboxService.listReminders('pending').then(setRows).catch(() => setRows((r) => r ?? []));
  }, []);
  useEffect(load, [load, version]);

  const cancel = async (r: Reminder) => {
    try {
      await inboxService.cancelReminder(r.id);
      setRows((prev) => (prev ?? []).filter((x) => x.id !== r.id));
      say('Reminder cancelled');
    } catch (e) {
      say(apiErrorMessage(e, 'The reminder was not cancelled'));
    }
  };

  if (!rows || rows.length === 0) return null;
  return (
    <div className="card" aria-label="Upcoming reminders">
      <div className="sub"><h3>Upcoming</h3><Tag tone="n">{rows.length}</Tag></div>
      {rows.map((r) => {
        const subject = r.subjectType && r.subjectId ? { type: r.subjectType, id: r.subjectId } : null;
        return (
          <div key={r.id} className="rrow">
            <AlarmClock className="rico" aria-hidden="true" />
            <div className="nbody">
              <b>{r.note}</b>
              <div className="meta">
                <span>Due {formatDateTime(r.dueAt)}</span>
                {isNoteSubject(subject) && <span className="lnk off">{subjectLabel(subject)}</span>}
              </div>
            </div>
            <Button size="mini" onClick={() => cancel(r)} aria-label={`Cancel reminder: ${r.note}`}>Cancel</Button>
          </div>
        );
      })}
    </div>
  );
}
