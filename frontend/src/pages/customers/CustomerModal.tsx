import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Button, Input, Modal, Select, useToast } from '../../components/ui-v2';
import { TownSelect } from '../../components/forms/TownSelect';
import { useTowns } from '../../hooks/useTowns';
import { customersService, type CustomerRow } from '../../services/customers.service';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { apiErrorMessage } from '../../utils/apiError';
import { getCountryByCurrency, getRegionsForCountry } from '../../utils/countries';
import { isManagerUp } from '../../components/shell/navModel';
import { customerName, phoneProblem } from './model';
import { formatPhoneLocal } from '../../utils/format';

interface CustomerModalProps {
  open: boolean;
  onClose: () => void;
  /** null: add a customer. A customer: edit them. */
  customer: CustomerRow | null;
  /** Called with the saved customer's name after a save. */
  onSaved: (name: string, id: number) => void;
}

interface Fields {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  alternatePhone: string;
  email: string;
  state: string;
  area: string;
  address: string;
  landmark: string;
  notes: string;
}

type Errors = Partial<Record<keyof Fields, string>>;

const BLANK: Fields = { firstName: '', lastName: '', phoneNumber: '', alternatePhone: '', email: '', state: '', area: '', address: '', landmark: '', notes: '' };

const fieldsOf = (c: CustomerRow | null): Fields =>
  c
    ? {
        firstName: c.firstName,
        lastName: c.lastName,
        phoneNumber: formatPhoneLocal(c.phoneNumber),
        alternatePhone: c.alternatePhone ? formatPhoneLocal(c.alternatePhone) : '',
        email: c.email ?? '',
        state: c.state,
        area: c.area,
        address: c.address,
        landmark: c.landmark ?? '',
        notes: c.notes ?? '',
      }
    : BLANK;

/** A phone that belongs to another customer, or to a deleted one (F-355). */
interface Clash {
  message: string;
  id?: number;
  name?: string;
  archived: boolean;
}

/** Add and edit customer (F-355). Look = the #av modal of docs/mockups/v2/customers.html, with all the PRD fields. */
export function CustomerModal({ open, onClose, customer, onSaved }: CustomerModalProps) {
  const say = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const currency = useConfigStore((s) => s.currency);
  const regions = useMemo(() => getRegionsForCountry(getCountryByCurrency(currency)), [currency]);
  const [fields, setFields] = useState<Fields>(BLANK);
  const { towns, loading: townsLoading } = useTowns(fields.state);
  const [errors, setErrors] = useState<Errors>({});
  const [clash, setClash] = useState<Clash | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFields(fieldsOf(customer));
    setErrors({});
    setClash(null);
    setSaving(false);
  }, [open, customer]);

  const set = (key: keyof Fields) => (e: { target: { value: string } }) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
    if (key === 'phoneNumber') setClash(null);
  };

  const check = (): Errors => {
    const e: Errors = {};
    if (!fields.firstName.trim()) e.firstName = 'First name is required';
    const phone = phoneProblem('Phone', fields.phoneNumber);
    if (phone) e.phoneNumber = phone;
    if (fields.alternatePhone.trim()) {
      const alt = phoneProblem('Alternate phone', fields.alternatePhone);
      if (alt) e.alternatePhone = alt;
    }
    if (!fields.state) e.state = 'State is required';
    if (!fields.area.trim()) e.area = 'City/Town is required';
    if (!fields.address.trim()) e.address = 'Address is required';
    return e;
  };

  const save = async (reactivate = false) => {
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    // On an edit a cleared optional field is sent empty, so it is cleared; on an add it is left out.
    const optional = (v: string) => (v.trim() || (customer ? '' : undefined));
    const body = {
      firstName: fields.firstName.trim(),
      lastName: fields.lastName.trim(),
      phoneNumber: fields.phoneNumber.trim(),
      alternatePhone: optional(fields.alternatePhone),
      email: optional(fields.email),
      state: fields.state,
      area: fields.area.trim(),
      address: fields.address.trim(),
      landmark: optional(fields.landmark),
      notes: optional(fields.notes),
      ...(reactivate && { reactivate: true }),
    };
    try {
      const saved = customer
        ? await customersService.updateCustomer(customer.id, body)
        : await customersService.createCustomer(body);
      onSaved(customerName({ firstName: body.firstName, lastName: body.lastName }), saved.id);
    } catch (e) {
      setSaving(false);
      const data = axios.isAxiosError(e) ? e.response?.data : undefined;
      if (axios.isAxiosError(e) && e.response?.status === 409 && (data?.code === 'PHONE_BELONGS_TO_OTHER_CUSTOMER' || data?.code === 'CUSTOMER_ARCHIVED')) {
        setClash({ message: data.message, id: data.customerId, name: data.customerName, archived: data.code === 'CUSTOMER_ARCHIVED' });
        return;
      }
      say(apiErrorMessage(e, 'The customer could not be saved.'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? 'Edit customer' : 'Add customer'}
      description={customer ? undefined : 'For a phone or WhatsApp customer. Their orders show on this page once they buy.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {customer ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <form
        className="cform"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input label="First name" value={fields.firstName} onChange={set('firstName')} error={errors.firstName} autoComplete="off" />
        <Input label="Last name" optional value={fields.lastName} onChange={set('lastName')} autoComplete="off" />
        <div>
          <Input
            label="Phone"
            type="tel"
            placeholder="024 555 0100"
            value={fields.phoneNumber}
            onChange={set('phoneNumber')}
            error={errors.phoneNumber ?? clash?.message}
            autoComplete="off"
          />
          {clash && (
            <p className="dup">
              {clash.id !== undefined && <Link to={`/customers/${clash.id}`} onClick={onClose}>Open {clash.name ?? 'this customer'}</Link>}
              {clash.archived && role && isManagerUp(role) && (
                <Button size="mini" variant="primary" disabled={saving} onClick={() => void save(true)}>
                  Reactivate
                </Button>
              )}
            </p>
          )}
        </div>
        <Input label="Alternate phone" optional type="tel" value={fields.alternatePhone} onChange={set('alternatePhone')} error={errors.alternatePhone} autoComplete="off" />
        <Select label="State" value={fields.state} onChange={set('state')} error={errors.state}>
          <option value="">Choose a state</option>
          {(fields.state && !regions.includes(fields.state) ? [...regions, fields.state] : regions).map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <TownSelect
          state={fields.state}
          value={fields.area}
          onChange={(v) => set('area')({ target: { value: v } })}
          towns={towns}
          loading={townsLoading}
          error={errors.area}
          typedClassName="span2"
        />
        <Input className="span2" label="Email" optional type="email" value={fields.email} onChange={set('email')} autoComplete="off" />
        <Input className="span2" label="Street address" value={fields.address} onChange={set('address')} error={errors.address} autoComplete="off" />
        <Input className="span2" label="Nearest landmark" optional placeholder="e.g. Opposite Kasoa Total station" value={fields.landmark} onChange={set('landmark')} autoComplete="off" />
        <div className="fl span2">
          <label htmlFor="cm-notes">
            Internal notes <span className="opt">(optional)</span>
          </label>
          <textarea id="cm-notes" rows={3} value={fields.notes} onChange={set('notes')} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
