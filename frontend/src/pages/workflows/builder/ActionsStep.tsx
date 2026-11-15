import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, Globe, Mail, MessageCircle, MessageSquare, Phone, RefreshCw, Timer, Trash2, UserCheck, type LucideIcon } from 'lucide-react';
import { Input, Select } from '../../../components/ui-v2';
import { ORDER_STATUS_LABELS } from '../../../utils/orderStatus';
import type { Option } from '../../orders/useFilterOptions';
import { ACTIONS, actionChoice, newAction, PRIORITIES, summariseAction, WAIT_UNITS, WHATSAPP_TEMPLATES, type ActionDraft, type ActionType, type Form } from '../model';
import { Area } from './Area';
import { AssignEditor } from './AssignEditor';

const ICONS: Record<ActionType, LucideIcon> = {
  assign_to: UserCheck, send_sms: MessageSquare, send_whatsapp: MessageCircle, send_email: Mail,
  send_auto_confirm: Phone, update_order: RefreshCw, wait: Timer, http_request: Globe,
};

interface ActionsStepProps {
  form: Form;
  set: (patch: Partial<Form>) => void;
  /** Action index (from 0) to the message the API gave for it. */
  errors: Record<number, string>;
  reps: Option[];
  agents: Option[];
  nameOf: (id: number) => string;
  /** The catch-up switch, drawn under the first "Assign to" action. */
  catchUp?: React.ReactNode;
}

function Editor({ action, onChange, ...people }: { action: ActionDraft; onChange: (c: Record<string, any>) => void } & Pick<ActionsStepProps, 'reps' | 'agents' | 'nameOf'>) {
  const c = action.config;
  const put = (patch: Record<string, any>) => onChange({ ...c, ...patch });
  switch (action.type) {
    case 'assign_to': return <AssignEditor config={c} onChange={onChange} {...people} />;
    case 'send_sms':
      return (
        <div className="stack">
          <Input label="Phone number" value={c.phoneNumber ?? ''} placeholder="+233201234567" onChange={(e) => put({ phoneNumber: e.target.value })} />
          <Area label="Message" value={c.message ?? ''} onChange={(e) => put({ message: e.target.value })} />
        </div>
      );
    case 'send_whatsapp':
      return (
        <Select label="Template" value={c.templateKey} hint="Sent to the order's customer." onChange={(e) => put({ templateKey: e.target.value })}>
          {WHATSAPP_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </Select>
      );
    case 'send_email':
      return (
        <div className="stack">
          <Input label="Send to" optional value={c.to ?? ''} hint="Leave empty to email the order's customer." onChange={(e) => put({ to: e.target.value })} />
          <Input label="Subject" value={c.subject ?? ''} onChange={(e) => put({ subject: e.target.value })} />
          <Area label="Message" value={c.body ?? ''} onChange={(e) => put({ body: e.target.value })} />
        </div>
      );
    case 'send_auto_confirm':
      return (
        <Select label="Channel" value={c.channel ?? 'whatsapp'} hint="Sends the confirm request with Confirm, Change and Cancel buttons. Each order gets it once. SMS asks the customer to reply YES or NO." onChange={(e) => put({ channel: e.target.value })}>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
        </Select>
      );
    case 'update_order':
      return (
        <div className="stack">
          <Select label="Set the status to" value={c.status ?? ''} onChange={(e) => put({ status: e.target.value })}>
            <option value="">No change</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
          <Select label="Priority" value={c.priority ?? ''} onChange={(e) => put({ priority: e.target.value })}>
            {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
          <Area label="Add a note" value={c.notes ?? ''} hint="Added to the staff notes of the order." onChange={(e) => put({ notes: e.target.value })} />
        </div>
      );
    case 'wait': {
      const secs = Number(c.duration) || 0;
      const unit = [...WAIT_UNITS].reverse().find((u) => secs >= u.id && secs % u.id === 0) ?? WAIT_UNITS[0];
      return (
        <div className="row2">
          <Input label="Wait for" type="number" min={1} value={secs ? secs / unit.id : ''} onChange={(e) => put({ duration: (Number(e.target.value) || 0) * unit.id })} />
          <Select label="Unit" value={unit.id} onChange={(e) => put({ duration: (secs / unit.id) * Number(e.target.value) })}>
            {WAIT_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </Select>
        </div>
      );
    }
    case 'http_request':
      return (
        <div className="stack">
          <div className="row2">
            <Select label="Method" value={c.method ?? 'POST'} onChange={(e) => put({ method: e.target.value })}>
              {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
            </Select>
            <Input label="Address" value={c.url ?? ''} placeholder="https://" onChange={(e) => put({ url: e.target.value })} />
          </div>
          <Area label="Body" value={c.body ?? ''} hint="Sent as it is. Leave empty for none." onChange={(e) => put({ body: e.target.value })} />
        </div>
      );
  }
}

/** Step 4: the actions, run in order from the top. */
export function ActionsStep({ form, set, errors, reps, agents, nameOf, catchUp }: ActionsStepProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(form.actions.length === 1 ? [form.actions[0].key] : []));
  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const firstAssign = form.actions.findIndex((a) => a.type === 'assign_to');

  const add = (type: ActionType) => {
    const a = newAction(type);
    set({ actions: [...form.actions, a] });
    setOpen((s) => new Set(s).add(a.key));
  };
  const change = (key: string, config: Record<string, any>) => set({ actions: form.actions.map((a) => (a.key === key ? { ...a, config } : a)) });

  return (
    <>
      <h2>Actions</h2>
      <p>These run in order, top to bottom.</p>
      {form.actions.length === 0 && <p className="hint" style={{ marginBottom: 12 }}>No actions yet. Add one below.</p>}
      <div className="seq">
        {form.actions.map((a, i) => {
          const choice = actionChoice(a.type)!;
          const Icon = ICONS[a.type];
          const isOpen = open.has(a.key) || !!errors[i];
          return (
            <div key={a.key}>
              {i > 0 && <div className="lnk" />}
              <div className={clsx('actn', errors[i] && 'bad')}>
                <div className="ah">
                  <span className="num2">{i + 1}</span>
                  <div className={clsx('icn', choice.tone)}><Icon /></div>
                  <div className="tx"><b>{choice.label}</b><small>{summariseAction(a, nameOf)}</small></div>
                  <button type="button" className="iconbtn" aria-expanded={isOpen} aria-label={`${isOpen ? 'Close' : 'Open'} action ${i + 1}`} onClick={() => toggle(a.key)}>
                    <ChevronDown style={{ transform: isOpen ? 'rotate(180deg)' : undefined }} />
                  </button>
                  <button type="button" className="iconbtn dng" aria-label={`Remove action ${i + 1}`} onClick={() => set({ actions: form.actions.filter((x) => x.key !== a.key) })}><Trash2 /></button>
                </div>
                {isOpen && (
                  <div className="ab">
                    {errors[i] && <p className="ferr" role="alert" style={{ marginTop: 0, marginBottom: 10 }}>{errors[i]}</p>}
                    <Editor action={a} onChange={(config) => change(a.key, config)} reps={reps} agents={agents} nameOf={nameOf} />
                    {i === firstAssign && catchUp}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 16, marginBottom: 6, fontWeight: 600 }}>Add an action</div>
      <div className="addact">
        {ACTIONS.map((a) => {
          const Icon = ICONS[a.type];
          return <button key={a.type} type="button" title={a.hint} onClick={() => add(a.type)}><Icon />{a.label}</button>;
        })}
      </div>
    </>
  );
}
