import { useState } from 'react';
import { Button, Input, Select, useToast } from '../../components/ui-v2';
import { deliveryPartnersService, type PartnerDataSource, type PartnerDetail } from '../../services/delivery-partners.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency } from '../../utils/format';
import { fieldsOf, type Fields } from './feesFields';
import { DATA_SOURCES, DATA_SOURCE_LABEL, VEHICLE_TYPES } from './model';

interface DrawerFeesProps {
  partner: PartnerDetail;
  canEdit: boolean;
  /** Called with the partner the API returned after a save. */
  onSaved: (partner: PartnerDetail) => void;
}

/**
 * Fees tab (F-707): the fee rule read-only (rules are edited in M5), days to pay, data source, trial flag, and the base town
 * and vehicle. A save sends PATCH /api/delivery-partners/:id, which writes an audit row. Only owner and admin edit.
 */
export function DrawerFees({ partner, canEdit, onSaved }: DrawerFeesProps) {
  const say = useToast();
  // The page gives this component a key made of the saved fields, so a new saved partner starts it again
  const base = fieldsOf(partner);
  const [fields, setFields] = useState<Fields>(base);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setFields((f) => ({ ...f, [key]: value }));
    setError(null);
  };
  const dirty = (Object.keys(base) as Array<keyof Fields>).some((k) => fields[k] !== base[k]);

  const save = async () => {
    const days = Number(fields.daysToPay);
    if (fields.daysToPay.trim() === '' || !Number.isInteger(days) || days < 0 || days > 365) {
      setError('Days to pay must be a whole number from 0 to 365');
      return;
    }
    setSaving(true);
    try {
      const saved = await deliveryPartnersService.update(partner.id, {
        daysToPay: days,
        dataSource: fields.dataSource,
        isTrial: fields.isTrial,
        baseTown: fields.baseTown.trim() || null,
        ...(fields.vehicleType && { vehicleType: fields.vehicleType }),
        vehicleId: fields.vehicleId.trim() || null,
      });
      onSaved(saved);
      say('Partner saved');
    } catch (e) {
      say(apiErrorMessage(e, 'The partner could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const rule = partner.feeRule;
  const dis = !canEdit;
  return (
    <form className="dfees" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <section>
        <h4>Delivery fee rule</h4>
        {rule === undefined ? (
          <p className="mut">Fee rules show to roles that can see money.</p>
        ) : rule.delivered === null && rule.failed === null && rule.returned === null ? (
          <p className="mut">No fee rule yet. Fee rules arrive with the payouts release.</p>
        ) : (
          <dl className="kv">
            <div><dt>Per delivered</dt><dd>{formatCurrency(rule.delivered ?? 0)}</dd></div>
            <div><dt>Per failed</dt><dd>{formatCurrency(rule.failed ?? 0)}</dd></div>
            <div><dt>Per returned</dt><dd>{formatCurrency(rule.returned ?? 0)}</dd></div>
          </dl>
        )}
      </section>

      <section className="cform">
        <Input label="Days to pay" type="number" min={0} max={365} value={fields.daysToPay} disabled={dis} error={error ?? undefined} onChange={(e) => set('daysToPay', e.target.value)} />
        <Select label="Data source" value={fields.dataSource} disabled={dis} onChange={(e) => set('dataSource', e.target.value as PartnerDataSource)}>
          {DATA_SOURCES.map((d) => <option key={d} value={d}>{DATA_SOURCE_LABEL[d]}</option>)}
        </Select>
        <Input label="Base town" optional value={fields.baseTown} disabled={dis} onChange={(e) => set('baseTown', e.target.value)} />
        <label className="chk span2">
          <input type="checkbox" checked={fields.isTrial} disabled={dis} onChange={(e) => set('isTrial', e.target.checked)} />
          Trial partner
        </label>
        {partner.kind === 'person' && (
          <>
            <Select label="Vehicle type" value={fields.vehicleType} disabled={dis} onChange={(e) => set('vehicleType', e.target.value)}>
              <option value="">Not set</option>
              {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
            <Input label="Vehicle number" optional value={fields.vehicleId} disabled={dis} onChange={(e) => set('vehicleId', e.target.value)} />
          </>
        )}
      </section>

      {canEdit && (
        <div className="dfoot">
          <Button variant="primary" type="submit" disabled={saving || !dirty}>Save changes</Button>
        </div>
      )}
    </form>
  );
}
