import { useState } from 'react';
import { Check, FlaskConical, Minus } from 'lucide-react';
import { Button, Input, Tag } from '../../../components/ui-v2';
import type { TestRunResult } from '../../../services/workflows.service';
import { parseOrderNumber } from '../../../utils/orderNumber';
import { actionChoice, CONDITION_FIELDS, describeTrigger, OPERATORS, fieldKind, NO_VALUE_OPERATORS, summariseAction, type Form } from '../model';

interface ReviewStepProps {
  form: Form;
  nameOf: (id: number) => string;
  /** Messages the API gave that name no field. */
  general: string[];
  /** The saved version is older than the screen: a test would run the old one. */
  dirty: boolean;
  saved: boolean;
  canTest: boolean;
  onTest: (orderId?: number) => Promise<TestRunResult | null>;
  history?: React.ReactNode;
}

const conditionText = (c: Form['conds'][number]): string => {
  const field = CONDITION_FIELDS.find((f) => f.field === c.field)?.label ?? c.field;
  const op = OPERATORS[fieldKind(c.field)].find((o) => o.id === c.operator)?.label ?? c.operator;
  return NO_VALUE_OPERATORS.includes(c.operator) ? `${field} ${op}` : `${field} ${op} ${c.value}`;
};

/** Step 5: the whole workflow in words, and a test run that sends nothing (POST /api/workflows/:id/test). */
export function ReviewStep({ form, nameOf, general, dirty, saved, canTest, onTest, history }: ReviewStepProps) {
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<string | null>(null);
  const blocked = saved && dirty;

  const run = async () => {
    let orderId: number | undefined;
    if (typed.trim()) {
      const id = parseOrderNumber(typed);
      if (id === null) return setBad('Use an order number like #24117, or leave it empty.');
      orderId = id;
    }
    setBad(null);
    setBusy(true);
    try { setResult(await onTest(orderId)); } finally { setBusy(false); }
  };

  const noOrder = form.triggerType === 'time_based';
  return (
    <>
      <h2>Review</h2>
      <p>Check the whole workflow, try it on a real order, then save.</p>
      {general.length > 0 && (
        <div className="errlist" role="alert">
          The workflow could not be saved:
          <ul>{general.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
      <div className="two2">
        <div>
          <div className="sum">
            <div className="sumrow"><span>Name</span><b>{form.name || 'No name yet'}</b></div>
            <div className="sumrow"><span>Trigger</span><div>{describeTrigger({ triggerType: form.triggerType, triggerData: form.triggerData })}</div></div>
            <div className="sumrow">
              <span>Conditions</span>
              <div className="chips">
                {noOrder || (form.conds.length === 0 && !form.rawConditions)
                  ? <span className="mut">{noOrder ? 'None, a schedule has no order' : 'Every order'}</span>
                  : form.rawConditions ? <Tag>Grouped conditions</Tag>
                  : form.conds.map((c) => <Tag key={c.key}>{conditionText(c)}</Tag>)}
              </div>
            </div>
            <div className="sumrow">
              <span>Actions</span>
              <div>
                {form.actions.length === 0 ? <span className="mut">None yet</span> : form.actions.map((a, i) => (
                  <div key={a.key}>{i + 1}. <b>{actionChoice(a.type)?.label}</b> <span className="mut">{summariseAction(a, nameOf)}</span></div>
                ))}
              </div>
            </div>
            <div className="sumrow"><span>Status</span><div><Tag tone={form.isActive ? 'ok' : 'n'}>{form.isActive ? 'Will be active' : 'Will be off'}</Tag></div></div>
          </div>

          <div className="test">
            <div className="trow2">
              <b>Test run</b>
              <Input compact label="Order number for the test" placeholder="#24117 (optional)" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <Button disabled={busy || blocked || !canTest} onClick={() => void run()}><FlaskConical />Run test</Button>
            </div>
            <div className="hint">Test runs change nothing. No messages are sent.{!saved && ' A new workflow is saved as a draft that is switched off, then tested.'}</div>
            {blocked && <div className="hint">Save your changes first. The test runs the saved workflow.</div>}
            {bad && <p className="ferr" role="alert">{bad}</p>}
            {result && (
              <div style={{ marginTop: 8 }} aria-live="polite">
                <p><b>Nothing was sent.</b> {result.conditions.matches === false
                  ? 'The conditions do not match this order, so no action would run.'
                  : result.conditions.reason === 'no_order'
                    ? 'No order was given, so the conditions were not checked. This is what would run:'
                    : result.conditions.evaluated ? 'The conditions match this order. This is what would run:' : 'This is what would run:'}</p>
                {result.plan.map((p) => (
                  <div className="tstep" key={p.index}><Check /><span>{p.index + 1}. {p.willDo}</span></div>
                ))}
                {result.plan.length === 0 && result.conditions.matches !== false && <div className="tstep"><Minus /><span>No actions.</span></div>}
              </div>
            )}
          </div>
        </div>
        {history}
      </div>
    </>
  );
}
