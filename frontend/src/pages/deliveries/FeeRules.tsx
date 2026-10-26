import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Button, Input, Select, Tag, Tooltip, useToast } from '../../components/ui-v2';
import {
  deliveryPartnersService,
  type FeeBasis,
  type FeeOutcome,
  type FeeRulesResponse,
} from '../../services/delivery-partners.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, todayYmd } from '../../utils/format';
import { DELIVERY_FEE, feeAmountText, FEE_OUTCOMES, FEE_OUTCOME_LABEL } from './model';

interface FeeRulesProps {
  partnerId: number;
  /** Owner and admin write rules; the others read them. */
  canEdit: boolean;
  /** A save went through: the page updates the partner's row from the rules in force (no table refetch). */
  onSaved: (saved: FeeRulesResponse) => void;
}

/** One outcome's inputs and the sentence the server refused it with. */
interface Row {
  amount: string;
  basis: FeeBasis;
  validFrom: string;
  error?: string;
}

/** The form starts from the rule in force: its amount and basis, dated today (a new rule closes the old one on its date). */
const startRows = (data: FeeRulesResponse): Record<FeeOutcome, Row> =>
  Object.fromEntries(
    FEE_OUTCOMES.map((o) => [o, { amount: data.current[o]?.amount ?? '', basis: data.current[o]?.basis ?? 'flat', validFrom: todayYmd() }]),
  ) as Record<FeeOutcome, Row>;

/**
 * Delivery fee rules of one partner (F-703, M5-T32): one rule per outcome (delivered, failed, returned), the history of
 * rules, and the weighted fee over its delivered orders. Save sends the changed outcomes in one request, all or none. A second
 * rule with the same date for an outcome is refused by the server, and its sentence shows under that outcome.
 */
export function FeeRules({ partnerId, canEdit, onSaved }: FeeRulesProps) {
  const say = useToast();
  const [data, setData] = useState<FeeRulesResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<FeeOutcome, Row> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await deliveryPartnersService.feeRules(partnerId);
      setData(loaded);
      setRows(startRows(loaded));
      setFailed(null);
    } catch (e) {
      setFailed(apiErrorMessage(e, `The ${DELIVERY_FEE.toLowerCase()} rules could not load.`));
    }
  }, [partnerId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="mut">{failed}</p>;
  if (!data || !rows) return <p className="mut">Loading {DELIVERY_FEE.toLowerCase()} rules…</p>;

  const set = (outcome: FeeOutcome, patch: Partial<Row>) => setRows({ ...rows, [outcome]: { ...rows[outcome], error: undefined, ...patch } });

  const changed = FEE_OUTCOMES.filter((o) => {
    const held = data.current[o];
    const row = rows[o];
    return row.amount.trim() !== '' && (!held || Number(held.amount) !== Number(row.amount) || held.basis !== row.basis);
  });

  const save = async () => {
    const bad = changed.filter((o) => !Number.isFinite(Number(rows[o].amount)) || Number(rows[o].amount) < 0);
    if (bad.length > 0) {
      setRows({ ...rows, ...Object.fromEntries(bad.map((o) => [o, { ...rows[o], error: `The ${DELIVERY_FEE.toLowerCase()} must be a number of 0 or more` }])) });
      return;
    }
    setSaving(true);
    try {
      const saved = await deliveryPartnersService.addFeeRules(
        partnerId,
        changed.map((o) => ({ outcome: o, basis: rows[o].basis, amount: rows[o].amount.trim(), validFrom: rows[o].validFrom })),
      );
      setData(saved);
      setRows(startRows(saved));
      say(changed.length === 1 ? `${DELIVERY_FEE} saved` : `${DELIVERY_FEE}s saved`);
      onSaved(saved);
    } catch (e) {
      // All or none: nothing was saved. The server names the outcomes it refused; what was typed stays so the date can change.
      const byOutcome = axios.isAxiosError(e) ? (e.response?.data?.errors as Partial<Record<FeeOutcome, string>> | undefined) : undefined;
      if (byOutcome) setRows({ ...rows, ...Object.fromEntries(Object.entries(byOutcome).map(([o, error]) => [o, { ...rows[o as FeeOutcome], error }])) });
      else say(apiErrorMessage(e, `The ${DELIVERY_FEE.toLowerCase()} could not be saved.`));
    } finally {
      setSaving(false);
    }
  };

  const saveButton = (
    <Button variant="primary" disabled={!canEdit || saving || changed.length === 0} onClick={() => void save()}>
      Save {DELIVERY_FEE.toLowerCase()}s
    </Button>
  );

  return (
    <div className="dfeerules">
      <section>
        <h4>{DELIVERY_FEE}</h4>
        <p className="mut">What we pay this partner for each outcome. A new fee starts on its date and never changes orders already closed.</p>
        <div className="dfr-rows">
          {FEE_OUTCOMES.map((outcome) => {
            const row = rows[outcome];
            const held = data.current[outcome];
            return (
              <div key={outcome} className="dfr">
                <Input
                  label={`${FEE_OUTCOME_LABEL[outcome]} ${DELIVERY_FEE.toLowerCase()}`}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={row.amount}
                  disabled={!canEdit}
                  hint={held ? `Now ${feeAmountText(held)} since ${held.validFrom}` : `No ${DELIVERY_FEE.toLowerCase()} yet`}
                  error={row.error}
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
          {canEdit ? saveButton : <Tooltip label={`Only the owner and admins change ${DELIVERY_FEE.toLowerCase()}s`}><span>{saveButton}</span></Tooltip>}
        </div>
      </section>

      <section>
        <h4>Weighted {DELIVERY_FEE.toLowerCase()}</h4>
        {data.weightedFee !== null ? (
          <p>
            <b>{formatCurrency(data.weightedFee)}</b> per delivered order, over {data.deliveredOrders.toLocaleString('en-GB')} delivered {data.deliveredOrders === 1 ? 'order' : 'orders'}
          </p>
        ) : (
          <p className="mut">No delivered order with a {DELIVERY_FEE.toLowerCase()} yet.</p>
        )}
      </section>

      <section>
        <h4>History of {DELIVERY_FEE.toLowerCase()} rules</h4>
        {data.rules.length === 0 ? (
          <p className="mut">No {DELIVERY_FEE.toLowerCase()} saved yet. Orders of this partner carry a {DELIVERY_FEE.toLowerCase()} of {formatCurrency(0)} until one is saved.</p>
        ) : (
          <div className="dfr-hist" role="region" aria-label={`History of ${DELIVERY_FEE.toLowerCase()} rules`} tabIndex={0}>
            <table>
              <thead>
                <tr><th scope="col">Valid from</th><th scope="col">Outcome</th><th scope="col">{DELIVERY_FEE}</th><th scope="col" /></tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.validFrom}</td>
                    <td>{FEE_OUTCOME_LABEL[r.outcome]}</td>
                    <td>{feeAmountText(r)}</td>
                    <td>{data.current[r.outcome]?.id === r.id && <Tag tone="ok">In force</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mut">{DELIVERY_FEE} is what the partner keeps from the cash it collects. Expected cash = cash collected minus fees.</p>
    </div>
  );
}
