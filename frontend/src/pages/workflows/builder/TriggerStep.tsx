import { useState } from 'react';
import clsx from 'clsx';
import { Copy, RefreshCw } from 'lucide-react';
import { Button, Input, Select, useToast } from '../../../components/ui-v2';
import { API_URL } from '../../../services/tokenRefresh';
import { ORDER_STATUS_LABELS } from '../../../utils/orderStatus';
import { buildCron, parseCron, TRIGGERS, WEEKDAYS, type Form, type ScheduleDraft } from '../model';
import type { TriggerType } from '../../../services/workflows.service';

interface TriggerStepProps {
  form: Form;
  set: (patch: Partial<Form>) => void;
  error?: string;
  /** The token of a webhook workflow, known only right after it was made or regenerated. */
  token: string | null;
  /** The saved workflow already has a token (it is not shown again). */
  hasToken: boolean;
  saved: boolean;
  canRegenerate: boolean;
  onRegenerate: () => Promise<void>;
}

const webhookUrl = (token: string) => `${API_URL || window.location.origin}/api/workflows/hooks/${token}`;

const DEFAULT_DATA: Partial<Record<TriggerType, Record<string, unknown>>> = {
  status_change: { status: 'confirmed' },
  time_based: { cron: '0 9 * * *' },
};

/** Step 2: the event that starts the workflow, and what each event needs. */
export function TriggerStep({ form, set, error, token, hasToken, saved, canRegenerate, onRegenerate }: TriggerStepProps) {
  const say = useToast();
  const [busy, setBusy] = useState(false);
  const schedule = parseCron(form.triggerData.cron);
  const setSchedule = (s: ScheduleDraft) => set({ triggerData: { ...form.triggerData, cron: buildCron(s) } });

  const pick = (type: TriggerType) => {
    if (type !== form.triggerType) set({ triggerType: type, triggerData: { ...(DEFAULT_DATA[type] ?? {}) } });
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); say('Copied'); } catch { say('Copy it by hand'); }
  };
  const regenerate = async () => {
    setBusy(true);
    try { await onRegenerate(); } finally { setBusy(false); }
  };

  return (
    <>
      <h2>Trigger</h2>
      <p>Pick the event that starts this workflow.</p>
      <div className="trg" role="group" aria-label="Trigger">
        {TRIGGERS.map((t) => (
          <button key={t.type} type="button" aria-pressed={form.triggerType === t.type} className={clsx(form.triggerType === t.type && 'on')} onClick={() => pick(t.type)}>
            <div className={clsx('icn', t.tone)}><t.icon /></div>
            <div><b>{t.label}</b><small>{t.hint}</small></div>
          </button>
        ))}
      </div>

      <div className="cfg">
        {form.triggerType === 'status_change' && (
          <Select label="When the order moves to" value={form.triggerData.status ?? ''} onChange={(e) => set({ triggerData: { status: e.target.value } })}>
            {Object.entries(ORDER_STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
        )}
        {form.triggerType === 'order_created' && <p>Runs when a new order arrives, from the checkout form, an import or a person.</p>}
        {form.triggerType === 'payment_received' && <p>Runs when an online payment settles on an order. Conditions can check the payment.</p>}
        {form.triggerType === 'manual' && <p>Runs only when you start it: from the Workflows list, the order drawer or the Orders bulk bar.</p>}
        {form.triggerType === 'time_based' && (
          <div className="stack">
            <div>
              <span className="lbl">How often</span>
              <div className="seg" role="group" aria-label="How often">
                {(['daily', 'weekly', 'custom'] as const).map((m) => (
                  <button key={m} type="button" className={clsx(schedule.mode === m && 'on')} aria-pressed={schedule.mode === m}
                    onClick={() => setSchedule(m === 'daily' ? { mode: 'daily', time: '09:00' } : m === 'weekly' ? { mode: 'weekly', time: '09:00', day: 1 } : { mode: 'custom', cron: buildCron(schedule) })}>
                    {m === 'daily' ? 'Every day' : m === 'weekly' ? 'Every week' : 'Custom'}
                  </button>
                ))}
              </div>
            </div>
            {schedule.mode !== 'custom' ? (
              <div className="row2">
                {schedule.mode === 'weekly' && (
                  <Select label="On" value={schedule.day} onChange={(e) => setSchedule({ ...schedule, day: Number(e.target.value) })}>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </Select>
                )}
                <Input label="At" type="time" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value || '09:00' })} />
              </div>
            ) : (
              <Input label="Cron expression" value={schedule.cron} hint="Five parts: minute, hour, day, month, weekday. For example 0 9 * * 1-5." onChange={(e) => setSchedule({ mode: 'custom', cron: e.target.value })} />
            )}
            <p className="hint">Runs in your store's time zone. A schedule runs with no order, so it has no conditions.</p>
          </div>
        )}
        {form.triggerType === 'webhook' && (
          <div className="stack">
            <p>Another app starts this workflow by sending a POST request to its address. The address holds a secret token.</p>
            {token ? (
              <>
                <div className="urlbox">
                  <code aria-label="Webhook address">{webhookUrl(token)}</code>
                  <Button onClick={() => void copy(webhookUrl(token))}><Copy />Copy</Button>
                </div>
                <p className="hint">Copy it now. For safety the token is shown once, and only a regenerate makes a new one.</p>
              </>
            ) : hasToken ? (
              <p className="hint">This workflow has a token. It is not shown again. Regenerate it for a new address; the old address then stops working.</p>
            ) : (
              <p className="hint">The address appears when the workflow is saved.</p>
            )}
            {saved && canRegenerate && (
              <div><Button disabled={busy} onClick={() => void regenerate()}><RefreshCw />Regenerate token</Button></div>
            )}
          </div>
        )}
        {error && <p className="ferr" role="alert">{error}</p>}
      </div>
    </>
  );
}
