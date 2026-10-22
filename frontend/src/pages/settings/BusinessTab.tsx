import { useEffect, useState, type FormEvent } from 'react';
import { Coins } from 'lucide-react';
import { Button, Card, Input, Select, useToast } from '../../components/ui-v2';
import { adminService, type SystemConfig } from '../../services/admin.service';
import { useConfigStore } from '../../stores/configStore';

const apiMessage = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

const TIME_ZONES = [
  { value: 'Africa/Accra', label: 'Africa/Accra (GMT)' },
  { value: 'Africa/Lagos', label: 'Africa/Lagos (GMT+1)' },
  { value: 'Africa/Nairobi', label: 'Africa/Nairobi (GMT+3)' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (GMT+2)' },
];

const fromConfig = (c: SystemConfig | null) => ({
  businessName: c?.businessName ?? '',
  contactPerson: c?.contactPerson ?? '',
  businessEmail: c?.businessEmail ?? '',
  businessPhone: c?.businessPhone ?? '',
  supportWhatsapp: c?.supportWhatsapp ?? '',
  taxId: c?.taxId ?? '',
  businessAddress: c?.businessAddress ?? '',
  timeZone: c?.timeZone || 'Africa/Accra',
});

interface BusinessTabProps {
  systemConfig: SystemConfig | null;
  onSaved: () => void;
  onOpenCurrencies: () => void;
}

/**
 * Business details (M3-T65, F-1230). The owner edits; the system-config route is owner only, so an admin sees
 * the view-only note from the shell instead. The time zone is set here and nowhere else. Country and currency
 * are in Currencies & FX.
 */
export function BusinessTab({ systemConfig, onSaved, onOpenCurrencies }: BusinessTabProps) {
  const say = useToast();
  const [form, setForm] = useState(() => fromConfig(systemConfig));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (systemConfig) setForm(fromConfig(systemConfig));
  }, [systemConfig]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const zones = TIME_ZONES.some((z) => z.value === form.timeZone) ? TIME_ZONES : [...TIME_ZONES, { value: form.timeZone, label: form.timeZone }];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setSaving(true);
    try {
      await adminService.updateSystemConfig({
        ...form,
        contactPerson: form.contactPerson.trim() || null,
        supportWhatsapp: form.supportWhatsapp.trim() || null,
      });
      say('Business details saved');
      onSaved();
      useConfigStore.getState().fetchConfig();
    } catch (err) {
      setError(apiMessage(err, 'The business details could not be saved'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card title="Business details" aside="Shown on invoices and customer messages">
        <form onSubmit={submit}>
          <div className="fields">
            <Input label="Business name" value={form.businessName} onChange={set('businessName')} />
            <Input label="Contact person" optional value={form.contactPerson} onChange={set('contactPerson')} />
            <Input label="Contact email" type="email" value={form.businessEmail} onChange={set('businessEmail')} />
            <Input label="Business phone" type="tel" value={form.businessPhone} onChange={set('businessPhone')} placeholder="+234 803 555 0100" />
            <Input label="Customer support WhatsApp" type="tel" value={form.supportWhatsapp} onChange={set('supportWhatsapp')} placeholder="+233 24 555 0100" hint="Customers see this number in delivery messages. Use the international format." />
            <Input label="Tax ID (TIN)" value={form.taxId} onChange={set('taxId')} />
            <Input label="Business address" className="full" value={form.businessAddress} onChange={set('businessAddress')} />
            <Select label="Time zone" value={form.timeZone} onChange={set('timeZone')} hint="Reports, nightly jobs and operating hours use this. A change applies to future days only.">
              {zones.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
            </Select>
          </div>
          {error && (
            <div className="fl" style={{ padding: '10px 20px 0' }}>
              <p className="err" role="alert">{error}</p>
            </div>
          )}
          <div className="cardfoot">
            <Button variant="primary" type="submit" disabled={saving || !systemConfig}>Save</Button>
          </div>
        </form>
      </Card>
      <Card>
        <div className="linkcard">
          <span className="ico"><Coins aria-hidden="true" /></span>
          <div>
            <b>Country and currency</b>
            <p>Your selling country and store currency are in Currencies &amp; FX.</p>
          </div>
          <Button onClick={onOpenCurrencies}>Open Currencies &amp; FX</Button>
        </div>
      </Card>
    </>
  );
}
