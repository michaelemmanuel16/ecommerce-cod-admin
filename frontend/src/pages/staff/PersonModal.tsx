import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Modal, Select, useToast } from '../../components/ui-v2';
import { staffService, type InviteResult, type PayMethod, type StaffRole, type StaffRow } from '../../services/staff.service';
import { formatCurrency } from '../../utils/format';
import { apiMessage } from '../orders/importText';
import { blankForm, isDeliveryRole, payChoices, validatePerson, VEHICLES, type PersonForm } from './model';

interface PersonModalProps {
  /** The person being edited; none means an invite. */
  row?: StaffRow;
  roles: StaffRole[];
  /** An invite starts on this role (the Assign menu of a role card). */
  roleId?: number;
  /** The company rep rule of Settings, Rewards. */
  company: { baseCommission: number; upsellPercent: number } | null;
  currency: string;
  onClose: () => void;
  onInvited: (result: InviteResult) => void;
  onSaved: (row: StaffRow) => void;
}

const PAY_LABEL = (company: PersonModalProps['company'], currency: string): Record<PayMethod, string> => ({
  per_order: `${formatCurrency(company?.baseCommission ?? 8, currency)} per delivered confirmed order + upsell reward`,
  fee_rule: 'Delivery fee rule',
  none: 'No pay through the app',
});

/** The role an invite starts on: a call rep, else any role but Owner. Never Owner by accident. */
const firstChoice = (roles: StaffRole[]): StaffRole =>
  roles.find((r) => r.presetRole === 'sales_rep') ?? roles.find((r) => r.presetRole !== 'super_admin') ?? roles[0];

const CHANNELS = [{ id: 'email', label: 'Email' }, { id: 'sms', label: 'SMS' }, { id: 'whatsapp', label: 'WhatsApp' }] as const;

/** The form of a row to edit: the role is the one whose base role matches the person's. */
function formOf(row: StaffRow, roles: StaffRole[], company: PersonModalProps['company']): PersonForm {
  const own = roles.find((r) => r.presetRole === row.role) ?? roles.find((r) => row.positions.some((p) => p.id === r.roleId));
  const base = company?.baseCommission ?? 0;
  // "Use the company rule" is judged by the amount: a rep whose amount equals the company base follows the company rule (no schema flag).
  return {
    ...blankForm(),
    name: row.name, email: row.email, phone: row.phoneNumber ?? '', roleId: own ? String(own.roleId) : '',
    payMethod: row.payMethod ?? (row.role === 'sales_rep' ? 'per_order' : 'none'),
    amount: row.commissionAmount && row.commissionAmount !== base ? String(row.commissionAmount) : '',
    custom: row.commissionAmount !== null && row.commissionAmount > 0 && row.commissionAmount !== base,
    vehicleType: row.vehicleType ?? VEHICLES[0], vehicleId: row.vehicleId ?? '', city: row.location ?? '',
  };
}

/**
 * Invite a person (F-1158) and edit a person (F-1159) in one modal, built from the Person modal of docs/mockups/v2/staff.html.
 * A delivery partner has no amount here: its fee is one rule per partner (Deliveries), and the modal links to it.
 */
export function PersonModal({ row, roles, roleId, company, currency, onClose, onInvited, onSaved }: PersonModalProps) {
  const say = useToast();
  const editing = row !== undefined;
  const [form, setForm] = useState<PersonForm>(() => (row ? formOf(row, roles, company) : { ...blankForm(), roleId: roleId ? String(roleId) : '' }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  // Roles load after the page: once they are there, an edit picks its role (and an invite its first)
  useEffect(() => {
    setForm((f) => (f.roleId || roles.length === 0 ? f : { ...f, roleId: row ? formOf(row, roles, company).roleId : String(firstChoice(roles).roleId) }));
  }, [roles, row, company]);

  const role = roles.find((r) => String(r.roleId) === form.roleId);
  const delivery = isDeliveryRole(role?.presetRole);
  const errors = useMemo(() => validatePerson(form, { invite: !editing, delivery }), [form, editing, delivery]);
  const set = (patch: Partial<PersonForm>) => setForm((f) => ({ ...f, ...patch }));
  const choices = payChoices(delivery);
  const payMethod: PayMethod = choices.includes(form.payMethod) ? form.payMethod : choices[0];
  // An edit picks the rule with the buttons; an invite uses the company rule while the amount is empty
  const useCompany = payMethod === 'per_order' && (editing ? !form.custom : form.amount.trim() === '');
  const labels = PAY_LABEL(company, currency);
  const shown = (key: keyof PersonForm) => (touched ? errors[key] : undefined);

  const send = async () => {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    try {
      const amount = payMethod === 'per_order' ? (useCompany ? company?.baseCommission : Number(form.amount)) : undefined;
      if (editing) {
        const [firstName, ...rest] = form.name.trim().split(/\s+/);
        const saved = await staffService.update(row.id, {
          firstName, lastName: rest.join(' ') || firstName, email: form.email.trim(), phoneNumber: form.phone.trim(), payMethod,
          ...(role?.presetRole && role.presetRole !== row.role && { role: role.presetRole }),
          ...(amount !== undefined && { commissionAmount: amount }),
          ...(delivery && { vehicleType: form.vehicleType, vehicleId: form.vehicleId.trim() }),
          ...(delivery || form.city.trim() ? { location: form.city.trim() } : {}),
        });
        onSaved(saved);
      } else {
        const result = await staffService.invite({
          name: form.name.trim(), email: form.email.trim(), roleId: Number(form.roleId), channel: form.channel, payMethod,
          ...(form.phone.trim() && { phoneNumber: form.phone.trim() }),
          ...(amount !== undefined && { amount }),
          ...(delivery && { vehicleType: form.vehicleType, ...(form.vehicleId.trim() && { vehicleId: form.vehicleId.trim() }) }),
          ...(form.city.trim() && { city: form.city.trim() }),
        });
        onInvited(result);
      }
    } catch (err) {
      say(await apiMessage(err, editing ? 'The changes could not be saved.' : 'The invite could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open onClose={onClose} title={editing ? `Edit ${row.name}` : 'Invite a person'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void send()}>{editing ? 'Save changes' : 'Send invite'}</Button></>}
    >
      <div className="two2">
        <Input label="Full name" value={form.name} onChange={(e) => set({ name: e.target.value })} error={shown('name')} placeholder="e.g. Akua Serwaa" />
        <Input label="Email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} error={shown('email')} placeholder="name@example.com" />
      </div>
      <div className="two2">
        <Input label="Phone" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} error={shown('phone')} placeholder="024 555 0100" optional />
        <Select label="Role" value={form.roleId} onChange={(e) => set({ roleId: e.target.value })} error={shown('roleId')}>
          {roles.map((r) => <option key={r.roleId} value={r.roleId} disabled={editing && r.presetRole === null}>{r.name}</option>)}
        </Select>
      </div>
      <Select label="How are they paid?" value={payMethod} onChange={(e) => set({ payMethod: e.target.value as PayMethod })}
        hint={delivery ? 'Delivery partners have no pay here. They keep a delivery fee from the cash they collect.' : undefined}>
        {choices.map((c) => <option key={c} value={c}>{labels[c]}</option>)}
      </Select>
      {delivery && editing && row.feeRule && <p className="hint"><Link to={`/deliveries?partner=${row.id}`}>Open the fee rule of {row.name}</Link></p>}
      {payMethod === 'per_order' && editing && (
        <div className="fl">
          <label htmlFor="staff-rule">Commission per delivered confirmed order</label>
          <div className="seg" role="radiogroup" aria-label="Commission rule">
            <button type="button" role="radio" aria-checked={useCompany} className={useCompany ? 'on' : undefined} onClick={() => set({ custom: false, amount: '' })}>
              Use the company rule ({formatCurrency(company?.baseCommission ?? 8, currency)})
            </button>
            <button type="button" role="radio" aria-checked={!useCompany} className={!useCompany ? 'on' : undefined} onClick={() => set({ custom: true, amount: form.amount || String(company?.baseCommission ?? 8) })}>
              Custom amount
            </button>
          </div>
          {!useCompany && <Input id="staff-rule" label="Amount per order" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} error={shown('amount')} hint="Applies to orders delivered after you save." />}
        </div>
      )}
      {payMethod === 'per_order' && !editing && (
        <Input label="Commission per delivered confirmed order" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })}
          error={shown('amount')} placeholder={String(company?.baseCommission ?? 8)} hint="Leave empty to use the company rule." />
      )}
      {delivery && (
        <>
          <div className="two2">
            <Select label="Vehicle" value={form.vehicleType} onChange={(e) => set({ vehicleType: e.target.value })}>
              {VEHICLES.map((v) => <option key={v}>{v}</option>)}
            </Select>
            <Input label="Vehicle number" value={form.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })} placeholder="e.g. GR 4821-23" optional />
          </div>
          <Input label="Location" value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="City, e.g. Kumasi" hint="Orders in this city can be assigned to them." optional />
        </>
      )}
      {!editing && (
        <Select label="Send the invite by" value={form.channel} onChange={(e) => set({ channel: e.target.value as PersonForm['channel'] })} error={shown('channel')}>
          {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      )}
    </Modal>
  );
}
