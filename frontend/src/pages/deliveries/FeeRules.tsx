import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Select, Tag, Tooltip, useToast } from '../../components/ui-v2';
import {
  deliveryPartnersService,
  type FeeBasis,
  type FeeOutcome,
  type FeeRuleRow,
  type FeeRulesResponse,
} from '../../services/delivery-partners.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, todayYmd } from '../../utils/format';
import { feeAmountText, FEE_OUTCOMES, FEE_OUTCOME_LABEL } from './model';

interface FeeRulesProps {
  partnerId: number;
  /** Owner and admin write rules; the others read them. */
  canEdit: boolean;
  /** A rule was saved: the page reloads its table (the "Delivery fee" column). */
  onChanged: () => void;
}

interface Row {
  amount: string;
  basis: FeeBasis;
  validFrom: string;
}

/** The form starts from the rule in force: its amount and basis, dated today (a new rule closes the old one on its date). */
const startRows = (data: FeeRulesResponse): Record<FeeOutcome, Row> =>
  Object.fromEntries(
    FEE_OUTCOMES.map((o) => [o, { amount: data.current[o]?.amount ?? '', basis: data.current[o]?.basis ?? 'flat', validFrom: todayYmd() }]),
  ) as Record<FeeOutcome, Row>;

const isDirty = (data: FeeRulesResponse, outcome: FeeOutcome, row: Row): boolean => {
  const held = data.current[outcome];
  if (row.amount.trim() === '') return false;
  return !held || Number(held.amount) !== Number(row.amount) || held.basis !== row.basis;
};

/**
 * Delivery fee rules of one partner (F-703, M5-T32): one rule per outcome (delivered, failed, returned), the history of
 * rules, and the weighted fee over its delivered orders. A save sends one rule per changed outcome. A second rule with the
 * same date for an outcome is refused by the server, and its sentence shows under that outcome.
 */
export function FeeRules({ partnerId, canEdit, onChanged }: FeeRulesProps) {
  const say = useToast();
  const [data, setData] = useState<FeeRulesResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<FeeOutcome, Row> | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FeeOutcome, string>>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await deliveryPartnersService.feeRules(partnerId);
      setData(loaded);
      setRows(startRows(loaded));
      setFailed(null);
    } catch (e) {
      setFailed(apiErrorMessage(e, 'The delivery fee rules could not load.'));
    }
  }, [partnerId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="mut">{failed}</p>;
  if (!data || !rows) return <p className="mut">Loading delivery fee rules…</p>;

  const set = (outcome: FeeOutcome, patch: Partial<Row>) => {
    setRows({ ...rows, [outcome]: { ...rows[outcome], ...patch } });
    setErrors((e) => ({ ...e, [outcome]: undefined }));
  };
  const dirty = FEE_OUTCOMES.filter((o) => isDirty(data, o, rows[o]));

  const save = async () => {
    const next: Partial<Record<FeeOutcome, string>> = {};
    for (const outcome of dirty) {
      const row = rows[outcome];
      const amount = Number(row.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        next[outcome] = 'The delivery fee must be a number of 0 or more';
        continue;
      }
      try {
        await deliveryPartnersService.addFeeRule(partnerId, { outcome, basis: row.basis, amount: row.amount.trim(), validFrom: row.validFrom });
      } catch (e) {
        next[outcome] = apiErrorMessage(e, 'The delivery fee could not be saved.');
      }
    }
    setErrors(next);
    const saved = dirty.length - Object.keys(next).length;
    if (saved > 0) {
      say(saved === 1 ? 'Delivery fee saved' : 'Delivery fees saved');
      onChanged();
    }
    // Reload from the server: the rows that saved show as the rule in force, the ones that failed keep what was typed
    const loaded = await deliveryPartnersService.feeRules(partnerId).catch(() => null);
    if (loaded) {
      setData(loaded);
      setRows((prev) => {
        const fresh = startRows(loaded);
        return Object.fromEntries(FEE_OUTCOMES.map((o) => [o, next[o] && prev ? prev[o] : fresh[o]])) as Record<FeeOutcome, Row>;
      });
    }
  };

  const inForce = new Set(FEE_OUTCOMES.flatMap((o) => (data.current[o] ? [data.current[o]!.id] : [])));
  const history: FeeRuleRow[] = [...data.rules].sort((a, b) => b.validFrom.localeCompare(a.validFrom) || a.outcome.localeCompare(b.outcome) || b.id - a.id);
  const saveButton = (
    <Button variant="primary" disabled={!canEdit || saving || dirty.length === 0} onClick={() => { setSaving(true); void save().finally(() => setSaving(false)); }}>
      Save delivery fees
    </Button>
  );

  return (
    <div className="dfeerules">
      <section>
        <h4>Delivery fee</h4>
        <p className="mut">What we pay this partner for each outcome. A new fee starts on its date and never changes orders already closed.</p>
        <div className="dfr-rows">
          {FEE_OUTCOMES.map((outcome) => {
            const row = rows[outcome];
            const held = data.current[outcome];
            return (
              <div key={outcome} className="dfr">
                <Input
                  label={`${FEE_OUTCOME_LABEL[outcome]} delivery fee`}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={row.amount}
                  disabled={!canEdit}
                  hint={held ? `Now ${feeAmountText(held)} since ${held.validFrom}` : 'No delivery fee yet'}
                  error={errors[outcome]}
                  onChange={(e) => set(outcome, { amount: e.target.value })}
                />
                <Select label="Basis" value={row.basis} disabled={!canEdit} onChange={(e) => set(outcome, { basis: e.target.value as FeeBasis })}>
                  <option value="flat">Flat amount</option>
                  <option value="percent">Percent of order total</option>
                </Select>
                <Input label="Valid from" type="date" value={row.validFrom} disabled={!canEdit} onChange={(e) => set(outcome, { validFrom: e.target.value })} />
              </div>
            );
          })}
        </div>
        <div className="dfoot">
          {canEdit ? saveButton : <Tooltip label="Only the owner and admins change delivery fees"><span>{saveButton}</span></Tooltip>}
        </div>
      </section>

      <section>
        <h4>Weighted delivery fee</h4>
        {data.weightedFee !== null ? (
          <p>
            <b>{formatCurrency(data.weightedFee)}</b> per delivered order, over {data.deliveredOrders.toLocaleString('en-GB')} delivered {data.deliveredOrders === 1 ? 'order' : 'orders'}
          </p>
        ) : (
          <p className="mut">No delivered order with a delivery fee yet.</p>
        )}
      </section>

      <section>
        <h4>History of delivery fee rules</h4>
        {history.length === 0 ? (
          <p className="mut">No delivery fee saved yet. Orders of this partner carry a delivery fee of {formatCurrency(0)} until one is saved.</p>
        ) : (
          <div className="dfr-hist" role="region" aria-label="History of delivery fee rules" tabIndex={0}>
            <table>
              <thead>
                <tr><th scope="col">Valid from</th><th scope="col">Outcome</th><th scope="col">Delivery fee</th><th scope="col" /></tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>{r.validFrom}</td>
                    <td>{FEE_OUTCOME_LABEL[r.outcome]}</td>
                    <td>{feeAmountText(r)}</td>
                    <td>{inForce.has(r.id) && <Tag tone="ok">In force</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mut">Delivery fee is what the partner keeps from the cash it collects. Expected cash = cash collected minus fees.</p>
    </div>
  );
}
