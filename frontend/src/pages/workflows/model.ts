import { Banknote, Clock, GitBranch, MousePointerClick, PlusCircle, Webhook, type LucideIcon } from 'lucide-react';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import type { OrderStatus } from '../../types';
import type { TriggerType, Workflow, WorkflowBody, WorkflowTemplate } from '../../services/workflows.service';

/** Words and shapes shared by the Workflows list, the builder and the run history (M9-T41 to T43). */

export type Tone = 'pine' | 'mint' | 'coral' | 'gold' | 'violet' | 'neutral';

export interface TriggerChoice {
  type: TriggerType;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: Tone;
}

/** The six triggers the backend accepts. The schedule is stored as `time_based`. */
export const TRIGGERS: TriggerChoice[] = [
  { type: 'order_created', label: 'Order created', hint: 'A new order arrives', icon: PlusCircle, tone: 'mint' },
  { type: 'status_change', label: 'Status change', hint: 'An order moves to a status', icon: GitBranch, tone: 'pine' },
  { type: 'payment_received', label: 'Payment received', hint: 'Paystack or manual payment', icon: Banknote, tone: 'gold' },
  { type: 'time_based', label: 'Schedule', hint: 'Time based, daily or weekly', icon: Clock, tone: 'violet' },
  { type: 'manual', label: 'Manual', hint: 'You run it from an order', icon: MousePointerClick, tone: 'neutral' },
  { type: 'webhook', label: 'Webhook', hint: 'Another app calls CodAdmin', icon: Webhook, tone: 'coral' },
];

export const triggerChoice = (type: string): TriggerChoice => TRIGGERS.find((t) => t.type === type) ?? TRIGGERS[4];

/* ---------- schedule ---------- */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type ScheduleDraft =
  | { mode: 'daily'; time: string }
  | { mode: 'weekly'; time: string; day: number }
  | { mode: 'custom'; cron: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** "0 9 * * *" is every day at 09:00 and "0 9 * * 1" every Monday; any other cron is kept as typed. */
export function parseCron(cron: string | undefined): ScheduleDraft {
  const text = (cron ?? '').trim();
  if (!text) return { mode: 'daily', time: '09:00' };
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$/.exec(text);
  if (m && Number(m[1]) < 60 && Number(m[2]) < 24) {
    const time = `${pad(Number(m[2]))}:${pad(Number(m[1]))}`;
    return m[3] === '*' ? { mode: 'daily', time } : { mode: 'weekly', time, day: Number(m[3]) };
  }
  return { mode: 'custom', cron: text };
}

export function buildCron(s: ScheduleDraft): string {
  if (s.mode === 'custom') return s.cron.trim();
  const [h, m] = s.time.split(':').map((n) => Number(n) || 0);
  return `${m} ${h} * * ${s.mode === 'weekly' ? s.day : '*'}`;
}

function describeSchedule(cron: string | undefined): string {
  const s = parseCron(cron);
  if (s.mode === 'daily') return `Every day at ${s.time}`;
  if (s.mode === 'weekly') return `Every ${WEEKDAYS[s.day]} at ${s.time}`;
  return `Schedule: ${s.cron}`;
}

/* ---------- trigger ---------- */

export const statusLabel = (status: string): string => ORDER_STATUS_LABELS[status as OrderStatus] ?? status;

/** The trigger in words, for a list row and the review. */
export function describeTrigger(w: Pick<Workflow, 'triggerType' | 'triggerData'>): string {
  const data = w.triggerData ?? {};
  switch (w.triggerType) {
    case 'status_change': {
      const status = data.status ?? data.targetStatus;
      return status ? `Status changes to ${statusLabel(status)}` : 'Status change';
    }
    case 'time_based': return describeSchedule(data.cron);
    default: return triggerChoice(w.triggerType).label;
  }
}

/* ---------- conditions ---------- */

export type FieldKind = 'number' | 'text' | 'status' | 'paymentStatus' | 'region';

export interface FieldChoice { field: string; label: string; kind: FieldKind }

/** Fields the backend validation accepts and the order context holds. */
export const CONDITION_FIELDS: FieldChoice[] = [
  { field: 'totalAmount', label: 'Order total', kind: 'number' },
  { field: 'productName', label: 'Product', kind: 'text' },
  { field: 'status', label: 'Order status', kind: 'status' },
  { field: 'paymentStatus', label: 'Payment status', kind: 'paymentStatus' },
  { field: 'paymentMethod', label: 'Payment method', kind: 'text' },
  { field: 'region', label: 'Region', kind: 'region' },
];

export const PAYMENT_STATUSES = ['pending', 'paid', 'collected', 'deposited', 'reconciled'];

export const fieldKind = (field: string): FieldKind => CONDITION_FIELDS.find((f) => f.field === field)?.kind ?? 'text';

export const OPERATORS: Record<FieldKind, Array<{ id: string; label: string }>> = {
  number: [
    { id: 'equals', label: 'is' },
    { id: 'not_equals', label: 'is not' },
    { id: 'greater_than', label: 'is more than' },
    { id: 'less_than', label: 'is less than' },
    { id: 'greater_than_or_equal', label: 'is at least' },
    { id: 'less_than_or_equal', label: 'is at most' },
  ],
  text: [
    { id: 'equals', label: 'is' },
    { id: 'not_equals', label: 'is not' },
    { id: 'contains', label: 'contains' },
    { id: 'not_contains', label: 'does not contain' },
    { id: 'starts_with', label: 'starts with' },
    { id: 'ends_with', label: 'ends with' },
    { id: 'is_empty', label: 'is empty' },
    { id: 'is_not_empty', label: 'is not empty' },
  ],
  status: [{ id: 'equals', label: 'is' }, { id: 'not_equals', label: 'is not' }],
  paymentStatus: [{ id: 'equals', label: 'is' }, { id: 'not_equals', label: 'is not' }],
  region: [{ id: 'is', label: 'is' }, { id: 'is_not', label: 'is not' }],
};

export const NO_VALUE_OPERATORS = ['is_empty', 'is_not_empty'];

export interface CondRow { key: string; field: string; operator: string; value: string }

let counter = 0;
const newKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${counter++}`;

export const newCondition = (): CondRow => ({ key: newKey('c'), field: 'totalAmount', operator: 'greater_than', value: '' });

/* ---------- actions ---------- */

export type ActionType = 'assign_to' | 'send_sms' | 'send_whatsapp' | 'send_email' | 'send_auto_confirm' | 'update_order' | 'wait' | 'http_request';

export interface ActionDraft { key: string; type: ActionType; config: Record<string, any> }

/** The actions the editor offers. `assign_agent`, `add_tag` and the old `assign_user` are not here. */
export const ACTIONS: Array<{ type: ActionType; label: string; hint: string; tone: Tone }> = [
  { type: 'assign_to', label: 'Assign to', hint: 'Give the order to call reps or delivery agents', tone: 'pine' },
  { type: 'send_sms', label: 'Send SMS', hint: 'Text a phone number', tone: 'violet' },
  { type: 'send_whatsapp', label: 'Send WhatsApp', hint: 'Send a WhatsApp template to the customer', tone: 'mint' },
  { type: 'send_email', label: 'Send email', hint: 'Email the customer or an address', tone: 'gold' },
  { type: 'send_auto_confirm', label: 'Send auto-confirm', hint: 'Ask the customer to confirm, change or cancel', tone: 'mint' },
  { type: 'update_order', label: 'Change order', hint: 'Set the status, priority or a note', tone: 'gold' },
  { type: 'wait', label: 'Wait', hint: 'Pause before the next step', tone: 'neutral' },
  { type: 'http_request', label: 'HTTP request', hint: 'Call another system', tone: 'coral' },
];

export const actionChoice = (type: string) => ACTIONS.find((a) => a.type === type);

export const WHATSAPP_TEMPLATES: Array<{ key: string; label: string }> = [
  { key: 'order_created', label: 'Order received' },
  { key: 'confirmed', label: 'Order confirmed' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed_delivery', label: 'Delivery failed' },
];

export const PRIORITIES = [
  { id: '', label: 'No change' },
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
];

export const WAIT_UNITS = [
  { id: 60, label: 'minutes' },
  { id: 3600, label: 'hours' },
  { id: 86400, label: 'days' },
];

const defaultConfig = (type: ActionType): Record<string, any> => {
  switch (type) {
    case 'assign_to': return { role: 'delivery_agent', userIds: [], split: 'even' };
    case 'send_sms': return { phoneNumber: '', message: '' };
    case 'send_whatsapp': return { templateKey: 'confirmed' };
    case 'send_email': return { to: '', subject: '', body: '' };
    case 'send_auto_confirm': return { channel: 'whatsapp' };
    case 'update_order': return { status: '', priority: '', notes: '' };
    case 'wait': return { duration: 3600 };
    case 'http_request': return { method: 'POST', url: '', body: '' };
  }
};

export const newAction = (type: ActionType): ActionDraft => ({ key: newKey('a'), type, config: defaultConfig(type) });

/** One line under an action's name: what it is set to. */
export function summariseAction(a: ActionDraft, nameOf: (id: number) => string): string {
  const c = a.config;
  switch (a.type) {
    case 'assign_to': {
      const ids: number[] = c.userIds ?? [];
      const who = ids.length === 0 ? 'nobody picked' : ids.map(nameOf).join(', ');
      return `${c.role === 'sales_rep' ? 'Call rep' : 'Delivery agent'}: ${who}${ids.length > 1 ? (c.split === 'weighted' ? ', weighted' : ', evenly') : ''}`;
    }
    case 'send_sms': return c.phoneNumber ? `To ${c.phoneNumber}` : 'No number yet';
    case 'send_whatsapp': return WHATSAPP_TEMPLATES.find((t) => t.key === c.templateKey)?.label ?? String(c.templateKey ?? '');
    case 'send_email': return c.subject ? `Subject: ${c.subject}` : 'No subject yet';
    case 'send_auto_confirm': return `Channel: ${c.channel === 'sms' ? 'SMS' : 'WhatsApp'}`;
    case 'update_order': {
      const parts = [c.status && `status ${statusLabel(c.status)}`, c.priority && `priority ${c.priority}`, c.notes && 'adds a note'].filter(Boolean);
      return parts.length ? `Sets ${parts.join(', ')}` : 'Nothing set yet';
    }
    case 'wait': {
      const secs = Number(c.duration) || 0;
      const unit = [...WAIT_UNITS].reverse().find((u) => secs >= u.id && secs % u.id === 0) ?? WAIT_UNITS[0];
      return secs > 0 ? `${secs / unit.id} ${unit.label}` : 'No time set';
    }
    case 'http_request': return c.url ? `${c.method ?? 'POST'} ${c.url}` : 'No address yet';
  }
}

/* ---------- the form ---------- */

export interface Form {
  name: string;
  description: string;
  isActive: boolean;
  triggerType: TriggerType;
  triggerData: Record<string, any>;
  logic: 'AND' | 'OR';
  conds: CondRow[];
  /** Conditions the editor cannot draw (groups inside groups): kept as they are. */
  rawConditions: any;
  actions: ActionDraft[];
  catchUp: boolean;
}

export const emptyForm = (): Form => ({
  name: '', description: '', isActive: true,
  triggerType: 'order_created', triggerData: {},
  logic: 'AND', conds: [], rawConditions: null, actions: [], catchUp: false,
});

const KNOWN_ACTIONS = ACTIONS.map((a) => a.type) as string[];

/** An action from a saved workflow or a template, as the editor draws it. Flat template keys move into `config`; the old `assign_user` becomes "Assign to". */
function actionFromApi(raw: any): ActionDraft | null {
  if (!raw || typeof raw.type !== 'string') return null;
  const { type, config, conditions: _c, elseBranch: _e, ...flat } = raw;
  const merged: Record<string, any> = { ...flat, ...(config ?? {}) };
  if (type === 'assign_user') {
    const role = merged.userType ?? merged.userRole;
    return { key: newKey('a'), type: 'assign_to', config: { role: role === 'sales_rep' ? 'sales_rep' : 'delivery_agent', userIds: [], split: 'even' } };
  }
  if (!KNOWN_ACTIONS.includes(type)) return null;
  const base = defaultConfig(type as ActionType);
  if (type === 'send_sms') return { key: newKey('a'), type, config: { ...base, phoneNumber: merged.phoneNumber ?? merged.to ?? '', message: merged.message ?? '' } };
  if (type === 'send_email') return { key: newKey('a'), type, config: { ...base, to: merged.to ?? merged.email ?? '', subject: merged.subject ?? '', body: merged.body ?? merged.message ?? '' } };
  if (type === 'send_whatsapp') {
    const key = WHATSAPP_TEMPLATES.some((t) => t.key === merged.templateKey) ? merged.templateKey : base.templateKey;
    return { key: newKey('a'), type, config: { templateKey: key } };
  }
  if (type === 'update_order') {
    const priority = merged.priority ?? merged.updates?.priority;
    return { key: newKey('a'), type, config: {
      status: merged.status ?? merged.updates?.status ?? '',
      priority: priority === undefined || priority === null ? '' : String(priority),
      notes: merged.notes ?? '',
    } };
  }
  if (type === 'wait') return { key: newKey('a'), type, config: { duration: Number(merged.duration) || base.duration } };
  if (type === 'http_request') return { key: newKey('a'), type, config: { method: String(merged.method ?? 'POST').toUpperCase(), url: merged.url ?? '', body: typeof merged.body === 'string' ? merged.body : merged.body ? JSON.stringify(merged.body) : '' } };
  if (type === 'assign_to') return { key: newKey('a'), type, config: { ...base, ...merged } };
  return { key: newKey('a'), type: type as ActionType, config: { ...base, ...merged } };
}

function condsFromApi(raw: any): Pick<Form, 'logic' | 'conds' | 'rawConditions'> {
  const none = { logic: 'AND' as const, conds: [], rawConditions: null };
  if (!raw || typeof raw !== 'object') return none;
  const logic = raw.logic === 'OR' ? 'OR' : 'AND';
  if (Array.isArray(raw.rules)) {
    if (raw.rules.some((r: any) => r && Array.isArray(r.rules))) return { ...none, logic, rawConditions: raw };
    return {
      logic,
      rawConditions: null,
      conds: raw.rules.map((r: any) => ({
        key: newKey('c'), field: String(r.field ?? ''), operator: String(r.operator ?? 'equals'),
        value: Array.isArray(r.value) ? r.value.join(', ') : r.value === undefined || r.value === null ? '' : String(r.value),
      })),
    };
  }
  // the old key-value shape: every key must equal its value
  const entries = Object.entries(raw).filter(([k]) => k !== 'id' && k !== 'logic');
  return { ...none, conds: entries.map(([field, value]) => ({ key: newKey('c'), field, operator: 'equals', value: String(value) })) };
}

export function formFromWorkflow(w: Workflow): Form {
  return {
    name: w.name, description: w.description ?? '', isActive: w.isActive,
    triggerType: w.triggerType, triggerData: { ...(w.triggerData ?? {}) },
    ...condsFromApi(w.conditions),
    actions: (Array.isArray(w.actions) ? w.actions : []).map(actionFromApi).filter((a): a is ActionDraft => a !== null),
    catchUp: false,
  };
}

export function formFromTemplate(t: WorkflowTemplate): Form {
  return {
    name: t.name, description: t.description, isActive: true,
    triggerType: t.triggerType, triggerData: { ...(t.triggerData ?? {}) },
    ...condsFromApi(t.conditions),
    actions: (t.actions ?? []).map(actionFromApi).filter((a): a is ActionDraft => a !== null),
    catchUp: false,
  };
}

const num = (v: string) => (v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v);

function actionToApi(a: ActionDraft): { type: ActionType; config: Record<string, any> } {
  const c = a.config;
  switch (a.type) {
    case 'send_sms': return { type: a.type, config: { phoneNumber: c.phoneNumber, message: c.message } };
    case 'send_email': return { type: a.type, config: { ...(c.to ? { to: c.to } : {}), subject: c.subject, body: c.body } };
    case 'update_order': return { type: a.type, config: {
      ...(c.status ? { status: c.status } : {}), ...(c.priority ? { priority: c.priority } : {}), ...(c.notes ? { notes: c.notes } : {}),
    } };
    case 'http_request': return { type: a.type, config: { method: c.method, url: c.url, ...(c.body ? { body: c.body } : {}) } };
    case 'assign_to': return { type: a.type, config: {
      role: c.role, userIds: c.userIds, split: c.split,
      ...(c.split === 'weighted' ? { weights: Object.fromEntries((c.userIds as number[]).map((id) => [id, Number(c.weights?.[id]) || 0])) } : {}),
    } };
    default: return { type: a.type, config: { ...c } };
  }
}

/** The body of POST and PUT /api/workflows. A schedule has no conditions: it runs with no order. */
export function toBody(f: Form, overrides: Partial<WorkflowBody> = {}): WorkflowBody {
  const rules = f.conds.map((c) => ({
    field: c.field, operator: c.operator,
    ...(NO_VALUE_OPERATORS.includes(c.operator) ? {} : { value: fieldKind(c.field) === 'number' ? num(c.value) : c.value }),
  }));
  const noOrder = f.triggerType === 'time_based';
  const conditions = noOrder ? {} : f.rawConditions ?? (rules.length ? { logic: f.logic, rules } : {});
  return {
    name: f.name.trim(),
    description: f.description.trim() || undefined,
    triggerType: f.triggerType,
    triggerData: f.triggerData,
    conditions,
    actions: f.actions.map(actionToApi),
    isActive: f.isActive,
    ...overrides,
  };
}

/* ---------- the API's validation messages ---------- */

export interface FieldErrors {
  name?: string;
  trigger?: string;
  conditions: Record<number, string>;
  actions: Record<number, string>;
  /** Messages that name no field. */
  general: string[];
}

export const noErrors = (): FieldErrors => ({ conditions: {}, actions: {}, general: [] });

/**
 * The 400 answer lists `errors: string[]` ("Condition 2: pick a field", "Action 1: ..."); other refusals are one sentence.
 * Each message goes to the row or card it names; the rest stay in `general`.
 */
export function sortErrors(messages: string[], assignIndexes: number[] = []): FieldErrors {
  const out = noErrors();
  const add = (map: Record<number, string>, i: number, msg: string) => { map[i] = map[i] ? `${map[i]}. ${msg}` : msg; };
  for (const message of messages) {
    const cond = /^Condition (\d+)(?:\.\d+)*: (.*)$/.exec(message);
    const act = /^Action (\d+): (.*)$/.exec(message);
    if (cond) add(out.conditions, Number(cond[1]) - 1, cond[2]);
    else if (act) add(out.actions, Number(act[1]) - 1, act[2]);
    else if (/cron|schedule|time zone/i.test(message)) out.trigger = out.trigger ? `${out.trigger}. ${message}` : message;
    else if (/assign_to|weight/i.test(message) && assignIndexes.length > 0) add(out.actions, assignIndexes[0], message);
    else if (/name/i.test(message) && !/action/i.test(message)) out.name = message;
    else out.general.push(message);
  }
  return out;
}

/** The step (1 to 5) that holds the first error, so the builder can open it. */
export function firstErrorStep(e: FieldErrors): number | null {
  if (e.name) return 1;
  if (e.trigger) return 2;
  if (Object.keys(e.conditions).length) return 3;
  if (Object.keys(e.actions).length || e.general.length) return 4;
  return null;
}
