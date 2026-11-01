import type { TagTone } from '../../components/ui-v2';
import { positive } from '../../utils/urlState';
import { formatCurrency } from '../../utils/format';
import type { PayMethod, StaffKind, StaffRow, StaffStatus } from '../../services/staff.service';

/** The team table of the Staff page (M6-T20, F-1157 to F-1161): its view state, its texts and its form rules. Pure, so the tests need no screen. */

export type TabId = 'all' | StaffStatus;
export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'invited', label: 'Invited' },
  { id: 'deactivated', label: 'Deactivated' }, { id: 'deleted', label: 'Deleted' },
];
const isTab = (v: string | null): v is TabId => TABS.some((t) => t.id === v);

/** What the table depends on. It lives in the URL, so a copied link opens the same tab, filter and search. */
export interface StaffView {
  tab: TabId;
  /** A role id of the tenant, or '' for every role. */
  role: string;
  q: string;
  /** The invite modal is open (`?invite=1`: the North Star wizard links here). */
  invite: boolean;
}
export const DEFAULT_VIEW: StaffView = { tab: 'all', role: '', q: '', invite: false };

export function parseView(search: URLSearchParams): StaffView {
  const tab = search.get('tab');
  const role = positive(search.get('role'));
  return { tab: isTab(tab) ? tab : 'all', role: role === null ? '' : String(role), q: search.get('q') ?? '', invite: search.get('invite') === '1' };
}

/** Values equal to the default are left out, so the plain page keeps a plain URL. */
export function writeView(view: StaffView): URLSearchParams {
  const out = new URLSearchParams();
  if (view.tab !== 'all') out.set('tab', view.tab);
  if (view.role) out.set('role', view.role);
  if (view.q) out.set('q', view.q);
  if (view.invite) out.set('invite', '1');
  return out;
}

type Counts = Record<StaffStatus, number>;

/** "10 on the team, 1 invited, 1 deactivated": every number from the counts. A part with none is left out. */
export function headerText(counts: Counts): string {
  const parts = [`${counts.active} on the team`];
  if (counts.invited > 0) parts.push(`${counts.invited} invited`);
  if (counts.deactivated > 0) parts.push(`${counts.deactivated} deactivated`);
  if (counts.deleted > 0) parts.push(`${counts.deleted} deleted`);
  return parts.join(' · ');
}

/** The count on a tab: All is every tab but Deleted (the list without a status hides deleted people). */
export const tabCount = (counts: Counts, id: TabId): number =>
  id === 'all' ? counts.active + counts.invited + counts.deactivated : counts[id];

export const TYPE_LABEL: Record<StaffKind, string> = { person: 'Human', company: 'Company', ai_agent: 'AI agent', system: 'System' };
export const TYPE_TONE: Record<StaffKind, TagTone> = { person: 'n', company: 'warn', ai_agent: 'v', system: 'n' };

export const STATUS_LABEL: Record<StaffStatus, string> = { active: 'Active', invited: 'Invited', deactivated: 'Deactivated', deleted: 'Deleted' };
export const STATUS_TONE: Record<StaffStatus, TagTone> = { active: 'ok', invited: 'warn', deactivated: 'n', deleted: 'bad' };

/** The pay text of a row (F-1157). `company` is the Rewards settings rule: GH₵8 per delivered order and the upsell share. */
export function payText(row: StaffRow, company: { baseCommission: number; upsellPercent: number } | null, currency: string): string {
  if (row.kind === 'ai_agent' || row.kind === 'company') return 'No payout';
  if (row.feeRule) {
    const fee = row.feeRule.delivered;
    if (!fee) return 'No fee rule set';
    return `Fee rule ${fee.basis === 'percent' ? `${fee.amount}%` : formatCurrency(fee.amount, currency)} per delivered, kept from the cash they collect`;
  }
  if (row.payMethod === 'per_order' || (row.payMethod === null && row.role === 'sales_rep')) {
    const own = row.commissionAmount ?? 0;
    const base = own > 0 ? own : company?.baseCommission ?? 0;
    const upsell = company ? ` + ${company.upsellPercent}% upsell` : ' + upsell';
    return base > 0 ? `${formatCurrency(base, currency)} per order confirmed by call and delivered${upsell}` : 'Per order confirmed by call and delivered';
  }
  return 'No pay through the app';
}

/** "12 min ago" style text for the last sign-in (an AI agent: the last use of its key), "Never signed in" for a person who has not, "Invite sent 15 Oct" for an invited one. */
export function lastActiveText(row: StaffRow, now: Date = new Date()): string {
  if (row.status === 'invited') return row.invitedAt ? `Invite sent ${new Date(row.invitedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Invite pending';
  if (!row.lastActiveAt) return row.kind === 'ai_agent' || row.kind === 'company' ? '—' : 'Never signed in';
  const mins = Math.max(0, Math.round((now.getTime() - new Date(row.lastActiveAt).getTime()) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

/** Contact line under the name: the email, or the phone for a person who has no email worth showing (a company id). */
export const contactOf = (row: StaffRow): string => (row.email.endsWith('.codadmin.internal') ? row.phoneNumber ?? '' : row.email);

export const VEHICLES = ['Motorbike', 'Car', 'Tricycle', 'Bicycle', 'On foot'] as const;

/** A role is the delivery role when its base role says so. */
export const isDeliveryRole = (presetRole: string | null | undefined): boolean => presetRole === 'delivery_agent';

export interface PersonForm {
  name: string;
  email: string;
  phone: string;
  roleId: string;
  payMethod: PayMethod;
  /** Per order, as typed. */
  amount: string;
  /** Edit: a custom amount instead of the company rule. */
  custom: boolean;
  vehicleType: string;
  vehicleId: string;
  city: string;
  channel: 'email' | 'sms' | 'whatsapp';
}

export const blankForm = (): PersonForm => ({
  name: '', email: '', phone: '', roleId: '', payMethod: 'per_order', amount: '', custom: false, vehicleType: VEHICLES[0], vehicleId: '', city: '', channel: 'email',
});

/** The pay choices of a role: a delivery role is paid by its fee rule (no amount here); anyone else by amount per order or not at all. */
export const payChoices = (delivery: boolean): PayMethod[] => (delivery ? ['fee_rule', 'none'] : ['per_order', 'none']);

export type FormErrors = Partial<Record<keyof PersonForm, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The field errors of the invite and edit forms. `invite` adds the channel rule: SMS and WhatsApp need a phone. */
export function validatePerson(form: PersonForm, opts: { invite: boolean; delivery: boolean }): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Enter a name';
  if (!EMAIL.test(form.email.trim())) errors.email = 'Enter a valid email address';
  if (!form.roleId) errors.roleId = 'Pick a role';
  if (opts.invite && form.channel !== 'email' && !form.phone.trim()) errors.phone = 'A phone number is needed to send the invite by SMS or WhatsApp';
  if (!opts.delivery && form.payMethod === 'per_order' && form.amount.trim() !== '' && !(Number(form.amount) >= 0)) errors.amount = 'Enter an amount of 0 or more';
  return errors;
}
