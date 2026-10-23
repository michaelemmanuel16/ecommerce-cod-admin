import { useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { Button, Tag } from '../../../components/ui-v2';
import type { OrderDetail } from '../../../services/orders.service';
import { personName } from '../../../utils/people';
import { accraTime, CALL_OUTCOMES, outcomeLabel, outcomeTone } from './model';

interface CallsProps {
  calls: OrderDetail['calls'];
  /** Absent: the person may not log calls, so the button is left out. */
  onLog?: (call: { outcome: string; notes: string }) => Promise<boolean>;
  /** Name shown in "Called by": the calls API records the signed-in person. */
  me: string;
}

/** Call history with the inline Log call form (mockup #logForm). Empty state: "No calls yet. Log the first one." */
export function CallsBlock({ calls, onLog, me }: CallsProps) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('confirmed');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!onLog) return;
    setBusy(true);
    const ok = await onLog({ outcome, notes: notes.trim() });
    setBusy(false);
    if (ok) {
      setNotes('');
      setOpen(false);
    }
  };

  return (
    <div className="sec">
      <h4>
        Call history
        {onLog && (
          <Button size="mini" aria-expanded={open} onClick={() => setOpen(!open)}>
            <PhoneCall aria-hidden="true" style={{ width: 13, height: 13, verticalAlign: -2 }} /> Log call
          </Button>
        )}
      </h4>
      {open && (
        <div className="hl" style={{ marginBottom: 10 }}>
          <div className="fg">
            <div className="fl">
              <label htmlFor="lg-o">Outcome</label>
              <select id="lg-o" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {CALL_OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fl">
              <label htmlFor="lg-w">Called by</label>
              <select id="lg-w" disabled value="me">
                <option value="me">{me}</option>
              </select>
            </div>
            <div className="fl full">
              <label htmlFor="lg-n">Note</label>
              <textarea id="lg-n" value={notes} maxLength={500} placeholder="What did the customer say?" onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy}>Save call</Button>
          </div>
        </div>
      )}
      <div>
        {calls.length === 0 ? (
          <p className="hint">No calls yet. Log the first one.</p>
        ) : (
          calls.map((c) => (
            <div className="call" key={c.id}>
              <div>
                <Tag tone={outcomeTone(c.outcome)}>{outcomeLabel(c.outcome)}</Tag>
                <b style={{ marginLeft: 6 }}>{personName(c.salesRep)}</b>
              </div>
              <small>{accraTime(c.createdAt)}</small>
              {c.notes && <p>{c.notes}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
