import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Plus, X } from 'lucide-react';
import { Button, Input, Select } from '../../../components/ui-v2';
import { workflowsService } from '../../../services/workflows.service';
import { ORDER_STATUS_LABELS } from '../../../utils/orderStatus';
import { CONDITION_FIELDS, fieldKind, newCondition, NO_VALUE_OPERATORS, OPERATORS, PAYMENT_STATUSES, type CondRow, type Form } from '../model';

interface ConditionsStepProps {
  form: Form;
  set: (patch: Partial<Form>) => void;
  /** Row index (from 0) to the message the API gave for it. */
  errors: Record<number, string>;
}

/** The regions of the store's country, for "Region is X" (GET /api/workflows/meta/regions). */
function useRegions(needed: boolean) {
  const [regions, setRegions] = useState<string[] | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  useEffect(() => {
    if (!needed || regions !== null) return;
    let live = true;
    workflowsService.getRegions()
      .then((r) => { if (live) { setRegions(r.regions); setCountry(r.country); } })
      .catch(() => live && setRegions([]));
    return () => { live = false; };
  }, [needed, regions]);
  return { regions: regions ?? [], country };
}

function ValueInput({ row, regions, onChange, invalid }: { row: CondRow; regions: string[]; onChange: (v: string) => void; invalid: boolean }) {
  const kind = fieldKind(row.field);
  if (NO_VALUE_OPERATORS.includes(row.operator)) return <span className="mut">No value needed</span>;
  const options =
    kind === 'status' ? Object.entries(ORDER_STATUS_LABELS).map(([id, label]) => [id, label] as const)
    : kind === 'paymentStatus' ? PAYMENT_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)] as const)
    : kind === 'region' && regions.length > 0 ? regions.map((r) => [r, r] as const)
    : null;
  if (options) {
    return (
      <Select compact label="Value" value={row.value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick one</option>
        {row.value && !options.some(([id]) => id === row.value) && <option value={row.value}>{row.value}</option>}
        {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </Select>
    );
  }
  return <Input compact label="Value" type={kind === 'number' ? 'number' : 'text'} value={row.value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />;
}

/** Step 3: only run when the order matches. Fields and operators are the ones the API accepts. */
export function ConditionsStep({ form, set, errors }: ConditionsStepProps) {
  const { regions, country } = useRegions(form.conds.some((c) => c.field === 'region') || form.triggerType !== 'time_based');
  const update = (key: string, patch: Partial<CondRow>) => set({ conds: form.conds.map((c) => (c.key === key ? { ...c, ...patch } : c)) });

  if (form.triggerType === 'time_based') {
    return (
      <>
        <h2>Conditions</h2>
        <p>A schedule runs with no order, so it has no conditions. It runs every time its time comes.</p>
      </>
    );
  }
  return (
    <>
      <h2>Conditions</h2>
      <p>Only run when the order matches. Leave empty to run on every order.</p>
      {form.rawConditions ? (
        <p className="hint">These conditions hold groups inside groups, which this editor cannot draw. They are kept as they are.</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="lbl" style={{ margin: 0 }}>Run when</span>
            <div className="seg" role="group" aria-label="Run when">
              {(['AND', 'OR'] as const).map((l) => (
                <button key={l} type="button" className={clsx(form.logic === l && 'on')} aria-pressed={form.logic === l} onClick={() => set({ logic: l })}>
                  {l === 'AND' ? 'All match' : 'Any match'}
                </button>
              ))}
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {form.conds.map((c, i) => {
              const kind = fieldKind(c.field);
              return (
                <div key={c.key}>
                  <div className="crow" role="group" aria-label={`Condition ${i + 1}`}>
                    <span className="and">{i === 0 ? 'When' : form.logic === 'AND' ? 'and' : 'or'}</span>
                    <Select compact label={`Field of condition ${i + 1}`} value={c.field} aria-invalid={errors[i] ? true : undefined}
                      onChange={(e) => update(c.key, { field: e.target.value, operator: OPERATORS[fieldKind(e.target.value)][0].id, value: '' })}>
                      {!CONDITION_FIELDS.some((f) => f.field === c.field) && <option value={c.field}>{c.field || 'Pick a field'}</option>}
                      {CONDITION_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                    </Select>
                    <Select compact label={`Operator of condition ${i + 1}`} value={c.operator} onChange={(e) => update(c.key, { operator: e.target.value })}>
                      {!OPERATORS[kind].some((o) => o.id === c.operator) && <option value={c.operator}>{c.operator}</option>}
                      {OPERATORS[kind].map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                    <ValueInput row={c} regions={regions} invalid={!!errors[i]} onChange={(value) => update(c.key, { value })} />
                    <button type="button" className="iconbtn dng" aria-label={`Remove condition ${i + 1}`} onClick={() => set({ conds: form.conds.filter((x) => x.key !== c.key) })}><X /></button>
                  </div>
                  {errors[i] && <p className="ferr" role="alert">{errors[i]}</p>}
                </div>
              );
            })}
          </div>
          <Button style={{ marginTop: 12 }} onClick={() => set({ conds: [...form.conds, newCondition()] })}><Plus />Add condition</Button>
          <p className="hint" style={{ marginTop: 12 }}>
            {country ? `Regions come from your store's country, ${country}. ` : ''}"Region is X" checks the order's delivery state.
          </p>
        </>
      )}
    </>
  );
}
