import clsx from 'clsx';
import { X } from 'lucide-react';
import { Select } from '../../../components/ui-v2';
import type { Option } from '../../orders/useFilterOptions';

interface AssignEditorProps {
  config: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
  reps: Option[];
  agents: Option[];
  nameOf: (id: number) => string;
}

/**
 * "Assign to": a role, the people in it, and how to split orders between them, evenly or by weight (M9-T23, F-511).
 * `config = { role, userIds, split, weights }`. A partner is a delivery agent user, so one list serves both.
 */
export function AssignEditor({ config, onChange, reps, agents, nameOf }: AssignEditorProps) {
  const isRep = config.role === 'sales_rep';
  const ids: number[] = config.userIds ?? [];
  const weights: Record<string, number> = config.weights ?? {};
  const pool = (isRep ? reps : agents).filter((p) => !ids.includes(p.id));
  const weighted = config.split === 'weighted';
  const total = ids.reduce((sum, id) => sum + (Number(weights[id]) || 0), 0);

  const setRole = (role: 'sales_rep' | 'delivery_agent') => {
    if ((role === 'sales_rep') === isRep) return;
    onChange({ ...config, role, userIds: [], weights: {} });
  };
  const add = (id: number) => onChange({ ...config, userIds: [...ids, id], weights: { ...weights, [id]: weights[id] ?? 1 } });
  const remove = (id: number) => onChange({ ...config, userIds: ids.filter((x) => x !== id) });
  const setWeight = (id: number, value: string) => onChange({ ...config, weights: { ...weights, [id]: value === '' ? 0 : Number(value) } });

  return (
    <>
      <div className="row2" style={{ marginBottom: 14 }}>
        <div>
          <span className="lbl">Assign to role</span>
          <div className="seg" role="group" aria-label="Assign to role">
            <button type="button" className={clsx(isRep && 'on')} aria-pressed={isRep} onClick={() => setRole('sales_rep')}>Call rep</button>
            <button type="button" className={clsx(!isRep && 'on')} aria-pressed={!isRep} onClick={() => setRole('delivery_agent')}>Delivery agent</button>
          </div>
        </div>
        <div>
          <span className="lbl">How to share orders</span>
          <div className="seg" role="group" aria-label="How to share orders">
            <button type="button" className={clsx(!weighted && 'on')} aria-pressed={!weighted} onClick={() => onChange({ ...config, split: 'even' })}>Evenly</button>
            <button type="button" className={clsx(weighted && 'on')} aria-pressed={weighted} onClick={() => onChange({ ...config, split: 'weighted', weights: Object.fromEntries(ids.map((id) => [id, weights[id] || 1])) })}>Weighted %</button>
          </div>
        </div>
      </div>

      <span className="lbl">{isRep ? 'Call reps' : 'Delivery agents or partners'}</span>
      {ids.length > 0 && (
        <div className="agl">
          {ids.map((id) => (
            <span key={id} className="agc">
              <b>{nameOf(id)}</b>
              {weighted && (
                <input type="number" min={1} aria-label={`Weight of ${nameOf(id)}`} value={weights[id] || ''} onChange={(e) => setWeight(id, e.target.value)} />
              )}
              <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => remove(id)}><X size={14} /></button>
            </span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10, maxWidth: 320 }}>
        <Select compact label="Add a person" value="" onChange={(e) => e.target.value && add(Number(e.target.value))} disabled={pool.length === 0}>
          <option value="">{pool.length === 0 ? (ids.length ? 'Everyone is added' : 'No one to pick') : 'Add a person'}</option>
          {pool.map((p) => <option key={p.id} value={p.id} disabled={p.unavailable}>{p.name}{p.unavailable ? ' (not available today)' : ''}</option>)}
        </Select>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        {weighted
          ? `Weights add up to ${total}. Only the ratio counts: 3 and 1 gives one order in four to the second person.`
          : ids.length > 1 ? 'Each person gets the same share, in turn.' : 'Orders go to this person. Add more to share them.'}
      </p>
    </>
  );
}
