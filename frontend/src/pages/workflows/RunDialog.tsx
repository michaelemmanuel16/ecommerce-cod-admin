import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Button, Modal, useToast } from '../../components/ui-v2';
import { workflowsService, type Workflow } from '../../services/workflows.service';
import { apiErrorMessage } from '../../utils/apiError';
import { parseOrderNumber } from '../../utils/orderNumber';

interface RunDialogProps {
  onClose: () => void;
  /** The workflow is fixed (the Run button of a list row). Without it the dialog lists the active workflows. */
  workflow?: Pick<Workflow, 'id' | 'name'>;
  /** The orders are given (order drawer, bulk bar). Without them the dialog asks for order numbers. */
  orderIds?: number[];
  onStarted?: () => void;
}

const count = (n: number) => `${n.toLocaleString('en-GB')} ${n === 1 ? 'order' : 'orders'}`;

/** Order numbers as typed ("#24117, 24118") to ids; the first word that is not an order number comes back as `bad`. */
function readOrderNumbers(text: string): { ids: number[]; bad: string | null } {
  const ids: number[] = [];
  for (const word of text.split(/[\s,;]+/).filter(Boolean)) {
    const id = parseOrderNumber(word);
    if (id === null) return { ids: [], bad: word };
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids, bad: null };
}

/**
 * Run a workflow on orders now (M9-T43, F-502). POST /api/workflows/:id/run. When some orders already ran this workflow the
 * API starts nothing and says which; "Run again anyway" sends the same call with `confirm: true`.
 */
export function RunDialog({ onClose, workflow, orderIds, onStarted }: RunDialogProps) {
  const say = useToast();
  const [choices, setChoices] = useState<Array<Pick<Workflow, 'id' | 'name'>> | null>(workflow ? [workflow] : null);
  const [workflowId, setWorkflowId] = useState<number | null>(workflow?.id ?? null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [already, setAlready] = useState<number | null>(null);

  useEffect(() => {
    if (workflow) return;
    let live = true;
    workflowsService.getWorkflows({ isActive: true })
      .then((l) => {
        if (!live) return;
        setChoices(l.workflows);
        setWorkflowId((cur) => cur ?? l.workflows[0]?.id ?? null);
      })
      .catch((e) => live && (setChoices([]), setError(apiErrorMessage(e, 'The workflows could not load.'))));
    return () => { live = false; };
  }, [workflow]);

  const run = async (confirm: boolean) => {
    if (workflowId === null) return;
    let ids = orderIds ?? [];
    if (!orderIds) {
      const read = readOrderNumbers(typed);
      if (read.bad) return setError(`"${read.bad}" is not an order number. Use numbers like #24117.`);
      if (read.ids.length === 0) return setError('Enter at least one order number.');
      ids = read.ids;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await workflowsService.runOnOrders(workflowId, ids, confirm);
      if ('warning' in result) {
        setAlready(result.orderIds.length);
        return;
      }
      say(`Started on ${count(result.queued)}`);
      onStarted?.();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'The workflow could not start.'));
    } finally {
      setBusy(false);
    }
  };

  const total = orderIds?.length ?? readOrderNumbers(typed).ids.length;
  const noneActive = choices !== null && choices.length === 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Run workflow"
      description="Runs the workflow once on each order, now."
      footer={
        already !== null ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void run(true)}>Run again anyway</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || workflowId === null} onClick={() => void run(false)}>
              <Play />
              Run
            </Button>
          </>
        )
      }
    >
      <div className="wfd stack">
        {workflow ? (
          <p><b>{workflow.name}</b></p>
        ) : (
          <div className="fl">
            <label htmlFor="run-wf">Workflow</label>
            <select id="run-wf" className="sel" value={workflowId ?? ''} disabled={choices === null || noneActive} onChange={(e) => { setWorkflowId(Number(e.target.value)); setAlready(null); }}>
              {choices === null && <option value="">Loading…</option>}
              {noneActive && <option value="">No workflow is on</option>}
              {choices?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            {noneActive && <p className="hint">Only workflows that are switched on can run.</p>}
          </div>
        )}
        {orderIds ? (
          <p>Runs on {count(orderIds.length)}.</p>
        ) : (
          <div className="fl">
            <label htmlFor="run-orders">Order numbers</label>
            <textarea id="run-orders" className="ta" rows={3} value={typed} placeholder="#24117, #24118" onChange={(e) => { setTyped(e.target.value); setAlready(null); }} />
            <p className="hint">Separate numbers with a comma or a space. Up to 500 orders.</p>
          </div>
        )}
        {already !== null && (
          <p className="warn" role="alert">
            {already === total ? `All ${count(already)} already ran` : `${already.toLocaleString('en-GB')} of the ${count(total)} already ran`} this workflow. Run again anyway?
          </p>
        )}
        {error && <p className="ferr" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
