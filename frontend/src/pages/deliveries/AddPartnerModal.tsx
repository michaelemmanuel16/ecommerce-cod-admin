import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, useToast } from '../../components/ui-v2';
import { deliveryPartnersService, type NewPartner, type PartnerKind } from '../../services/delivery-partners.service';
import { apiErrorMessage } from '../../utils/apiError';
import { VEHICLE_TYPES } from './model';

interface AddPartnerModalProps {
  open: boolean;
  onClose: () => void;
  /** The new partner's id and name, after a save. */
  onAdded: (id: number, name: string) => void;
}

interface Fields {
  kind: PartnerKind;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  baseTown: string;
  vehicleType: string;
  daysToPay: string;
  password: string;
}

const BLANK: Fields = { kind: 'person', firstName: '', lastName: '', email: '', phoneNumber: '', baseTown: '', vehicleType: '', daysToPay: '7', password: '' };
type Errors = Partial<Record<keyof Fields, string>>;

/**
 * Add delivery partner (M4-T33, F-708). A person or a company. The API creates the user, its stock location and the
 * partner profile in one step. Regions are not set here: Workflows assign by region (decision O4).
 */
export function AddPartnerModal({ open, onClose, onAdded }: AddPartnerModalProps) {
  const say = useToast();
  const [fields, setFields] = useState<Fields>(BLANK);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFields(BLANK);
    setErrors({});
    setSaving(false);
  }, [open]);

  const company = fields.kind === 'company';
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const check = (): Errors => {
    const e: Errors = {};
    if (!fields.firstName.trim()) e.firstName = company ? 'Company name is required' : 'First name is required';
    if (!/\S+@\S+\.\S+/.test(fields.email.trim())) e.email = 'A valid email is required';
    const days = Number(fields.daysToPay);
    if (fields.daysToPay.trim() === '' || !Number.isInteger(days) || days < 0 || days > 365) e.daysToPay = 'Days to pay must be a whole number from 0 to 365';
    if (fields.password && fields.password.length < 8) e.password = 'Password must be at least 8 characters';
    return e;
  };

  const save = async () => {
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    const body: NewPartner = {
      kind: fields.kind,
      firstName: fields.firstName.trim(),
      ...(!company && fields.lastName.trim() && { lastName: fields.lastName.trim() }),
      email: fields.email.trim(),
      ...(fields.phoneNumber.trim() && { phoneNumber: fields.phoneNumber.trim() }),
      ...(fields.baseTown.trim() && { baseTown: fields.baseTown.trim() }),
      ...(!company && fields.vehicleType && { vehicleType: fields.vehicleType }),
      daysToPay: Number(fields.daysToPay),
      ...(!company && fields.password && { password: fields.password }),
    };
    try {
      const partner = await deliveryPartnersService.create(body);
      onAdded(partner.id, partner.name);
    } catch (e) {
      setSaving(false);
      say(apiErrorMessage(e, 'The partner could not be added.'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add delivery partner"
      description="A 3PL company or a person with a bike or car. The partner keeps its fee from the cash it collects."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>Add partner</Button>
        </>
      }
    >
      <form className="cform" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Select className="span2" label="Type" value={fields.kind} onChange={(e) => set('kind', e.target.value as PartnerKind)}>
          <option value="person">Delivery agent (a person)</option>
          <option value="company">3PL company</option>
        </Select>
        <Input className={company ? 'span2' : undefined} label={company ? 'Company name' : 'First name'} value={fields.firstName} error={errors.firstName} autoComplete="off" onChange={(e) => set('firstName', e.target.value)} />
        {!company && <Input label="Last name" optional value={fields.lastName} autoComplete="off" onChange={(e) => set('lastName', e.target.value)} />}
        <Input label="Email" type="email" value={fields.email} error={errors.email} autoComplete="off" onChange={(e) => set('email', e.target.value)} />
        <Input label="Phone" optional type="tel" value={fields.phoneNumber} autoComplete="off" onChange={(e) => set('phoneNumber', e.target.value)} />
        <Input label="Base town" optional placeholder="Kumasi" value={fields.baseTown} autoComplete="off" onChange={(e) => set('baseTown', e.target.value)} />
        <Input label="Days to pay" type="number" min={0} max={365} value={fields.daysToPay} error={errors.daysToPay} onChange={(e) => set('daysToPay', e.target.value)} />
        {!company && (
          <>
            <Select label="Vehicle type" value={fields.vehicleType} onChange={(e) => set('vehicleType', e.target.value)}>
              <option value="">Not set</option>
              {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
            <Input label="Password" optional type="password" hint="Lets the agent sign in to the agent app." value={fields.password} error={errors.password} autoComplete="new-password" onChange={(e) => set('password', e.target.value)} />
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
