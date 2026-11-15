import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Check, FlaskConical } from 'lucide-react';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, Input, Skeleton, Tag, useToast } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { workflowsService, type CatchUpPreview, type TestRunResult, type Workflow, type WorkflowBody, type WorkflowTemplate } from '../services/workflows.service';
import { apiErrorMessage } from '../utils/apiError';
import { useFilterOptions } from './orders/useFilterOptions';
import { ActionsStep } from './workflows/builder/ActionsStep';
import { ConditionsStep } from './workflows/builder/ConditionsStep';
import { ReviewStep } from './workflows/builder/ReviewStep';
import { RunHistory } from './workflows/builder/RunHistory';
import { TriggerStep } from './workflows/builder/TriggerStep';
import { Area } from './workflows/builder/Area';
import { emptyForm, firstErrorStep, formFromTemplate, formFromWorkflow, noErrors, sortErrors, toBody, type FieldErrors, type Form } from './workflows/model';

const STEPS = ['Basic info', 'Trigger', 'Conditions', 'Actions', 'Review'];

/** Everything the API would store, except the on/off switch: when it differs from the saved copy the screen has unsaved changes. */
const signature = (f: Form) => JSON.stringify({ ...toBody(f), isActive: undefined });

/** The 400 answer lists `errors: string[]`; any other refusal is one sentence. */
const messagesOf = (e: unknown): string[] => {
  const list = axios.isAxiosError(e) ? e.response?.data?.errors : null;
  return Array.isArray(list) && list.length > 0 ? list.map(String) : [apiErrorMessage(e, 'The workflow could not be saved.')];
};

/**
 * The workflow builder (M9-T42, COD-84, F-505 F-507 F-508 F-509 F-511 F-512 F-514), built from docs/mockups/v2/workflows.html:
 * five steps (Basic info, Trigger, Conditions, Actions, Review). The catch-up switch sits under the first "Assign to" action
 * and counts from GET /api/workflows/:id/catch-up/preview. A test run (or the catch-up count) on a workflow that was never
 * saved first saves it as a draft that is switched off. Run history is T43 (builder/RunHistory.tsx).
 */
export function WorkflowWizard() {
  useV2Page();
  const navigate = useNavigate();
  const location = useLocation();
  const say = useToast();
  const { id: idParam } = useParams<{ id: string }>();
  const routeId = idParam && idParam !== 'new' ? Number(idParam) : null;
  const { can, isManager } = usePermissions();
  const { reps, agents } = useFilterOptions();
  const state = (location.state ?? {}) as { template?: WorkflowTemplate; webhookToken?: string };

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(() => (state.template ? formFromTemplate(state.template) : emptyForm()));
  const [savedId, setSavedId] = useState<number | null>(routeId);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState<string | null>(state.webhookToken ?? null);
  const [loading, setLoading] = useState(routeId !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(noErrors());
  const [preview, setPreview] = useState<{ data?: CatchUpPreview; error?: string; loading?: boolean } | null>(null);

  const canSave = savedId ? can('workflows', 'update') : can('workflows', 'create');
  const canTest = can('workflows', 'execute') && (savedId ? true : can('workflows', 'create'));

  const set = useCallback((patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch })), []);

  const adopt = useCallback((w: Workflow, f: Form) => {
    setSavedId(w.id);
    setSavedSig(signature(f));
    setHasToken(!!w.hasWebhookToken);
  }, []);

  // Editing: load the workflow
  useEffect(() => {
    if (routeId === null) return;
    let live = true;
    workflowsService.getWorkflow(routeId)
      .then((w) => {
        if (!live) return;
        const f = formFromWorkflow(w);
        setForm(f);
        adopt(w, f);
      })
      .catch((e) => live && setLoadError(apiErrorMessage(e, 'The workflow could not load.')))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [routeId, adopt]);

  const dirty = savedId !== null && savedSig !== signature(form);
  const assignIndexes = form.actions.flatMap((a, i) => (a.type === 'assign_to' ? [i] : []));

  const nameOf = useMemo(() => {
    const names = new Map<number, string>([...reps, ...agents].map((p) => [p.id, p.name]));
    return (id: number) => names.get(id) ?? `User ${id}`;
  }, [reps, agents]);

  /** Save the form: a new workflow is created, a saved one updated. Returns the saved workflow, or null when the API refused. */
  const persist = async (overrides: Partial<WorkflowBody> = {}): Promise<{ workflow: Workflow; webhookToken?: string } | null> => {
    if (!form.name.trim()) {
      setErrors({ ...noErrors(), name: 'Give the workflow a name.' });
      setStep(0);
      return null;
    }
    const body = toBody(form, overrides);
    try {
      const res = savedId ? await workflowsService.updateWorkflow(savedId, body) : await workflowsService.createWorkflow(body);
      setErrors(noErrors());
      if (res.webhookToken) setToken(res.webhookToken);
      adopt(res.workflow, form);
      return res;
    } catch (e) {
      const sorted = sortErrors(messagesOf(e), assignIndexes);
      setErrors(sorted);
      const at = firstErrorStep(sorted);
      if (at) setStep(at - 1);
      if (!axios.isAxiosError(e) || e.response?.status !== 400) say(apiErrorMessage(e, 'The workflow could not be saved.'));
      return null;
    }
  };

  /** The id of the saved workflow; a new one is saved first as a draft that is switched off. */
  const ensureSaved = async (): Promise<number | null> => {
    if (savedId) return savedId;
    return (await persist({ isActive: false }))?.workflow.id ?? null;
  };

  const save = async () => {
    setSaving(true);
    try {
      const wasNew = routeId === null;
      const saved = await persist();
      if (!saved) return;
      const w = saved.workflow;
      say('Workflow saved');
      if (form.catchUp && w.isActive && preview?.data && preview.data.count > 0) {
        try {
          const r = await workflowsService.runCatchUp(w.id);
          say(`Catch-up started on ${r.queued.toLocaleString('en-GB')} ${r.queued === 1 ? 'order' : 'orders'}`);
        } catch (e) {
          say(apiErrorMessage(e, 'The catch-up could not start.'));
        }
        set({ catchUp: false });
      }
      const shown = saved.webhookToken ?? token;
      if (wasNew) navigate(`/workflows/${w.id}`, { replace: true, state: shown ? { webhookToken: shown } : undefined });
    } finally {
      setSaving(false);
    }
  };

  const test = async (orderId?: number): Promise<TestRunResult | null> => {
    const id = await ensureSaved();
    if (id === null) return null;
    try {
      return await workflowsService.testRun(id, orderId);
    } catch (e) {
      say(apiErrorMessage(e, 'The test could not run.'));
      return null;
    }
  };

  const regenerate = async () => {
    if (!savedId) return;
    try {
      setToken(await workflowsService.regenerateToken(savedId));
      setHasToken(true);
      say('New token made. The old address stops working.');
    } catch (e) {
      say(apiErrorMessage(e, 'The token could not be regenerated.'));
    }
  };

  /* ---- catch-up (F-512) ---- */
  const catchEligible = isManager && (form.triggerType === 'order_created' || form.triggerType === 'status_change') && assignIndexes.length > 0;
  const loadPreview = useCallback(async (id: number) => {
    setPreview({ loading: true });
    try {
      setPreview({ data: await workflowsService.previewCatchUp(id) });
    } catch (e) {
      setPreview({ error: apiErrorMessage(e, 'The count could not load.') });
    }
  }, []);
  // A saved workflow shows its count as soon as there is an "Assign to" action
  useEffect(() => {
    if (catchEligible && savedId && !loading) void loadPreview(savedId);
    else if (!catchEligible) setPreview(null);
  }, [catchEligible, savedId, loading, loadPreview]);

  const toggleCatchUp = async (on: boolean) => {
    set({ catchUp: on });
    if (on && !savedId) {
      const id = await ensureSaved();
      if (id === null) set({ catchUp: false });
    }
  };

  const catchUp = catchEligible ? (
    <div className="catchup">
      <label className="wfsw">
        <input type="checkbox" role="switch" aria-label="Also assign orders that have no one yet" checked={form.catchUp} onChange={(e) => void toggleCatchUp(e.target.checked)} />
        <i />
      </label>
      <span>
        <b>Also assign orders that have no one yet</b>
        <span className="hint" aria-live="polite">
          {preview?.loading ? 'Counting…'
            : preview?.error ? preview.error
            : preview?.data ? `${preview.data.count.toLocaleString('en-GB')} ${preview.data.count === 1 ? 'order would' : 'orders would'} be assigned now${preview.data.capped ? ' (more are waiting)' : ''}.${dirty ? ' Counted on the saved version.' : ''}${form.catchUp && !form.isActive ? ' It runs when the workflow is on.' : ''}`
            : 'Turn this on to count the orders it would assign now.'}
        </span>
      </span>
    </div>
  ) : null;

  const stepErrors = [!!errors.name, !!errors.trigger, Object.keys(errors.conditions).length > 0, Object.keys(errors.actions).length > 0 || errors.general.length > 0, false];

  if (loading) return <section className="wf" aria-busy="true" aria-label="Loading workflow"><Skeleton height={240} /></section>;
  if (loadError) {
    return (
      <section className="wf">
        <div className="bbar"><Button onClick={() => navigate('/workflows')}><ArrowLeft />Workflows</Button></div>
        <div className="card"><p style={{ padding: 20 }} role="alert">{loadError}</p></div>
      </section>
    );
  }

  const go = (i: number) => { setStep(Math.max(0, Math.min(STEPS.length - 1, i))); window.scrollTo(0, 0); };

  return (
    <section className="wf">
      <div className="bbar">
        <Button onClick={() => navigate('/workflows')}><ArrowLeft />Workflows</Button>
        <h1>{form.name.trim() || (savedId ? 'Workflow' : 'New workflow')}</h1>
        <Tag tone={form.isActive ? 'ok' : 'n'}>{form.isActive ? 'Active' : 'Off'}</Tag>
        <div className="sp" />
        <Button onClick={() => go(4)}><FlaskConical />Test run</Button>
        {canSave && <Button variant="primary" disabled={saving} onClick={() => void save()}><Check />Save workflow</Button>}
      </div>

      <div className="card wiz">
        <div className="steps" role="tablist" aria-label="Builder steps">
          {STEPS.map((title, i) => (
            <button key={title} type="button" role="tab" aria-selected={step === i} className={clsx('step', step === i && 'on', i < step && 'done')} onClick={() => go(i)}>
              <span className="n">{i < step ? <Check size={14} /> : i + 1}</span>
              <span className="t">{title}</span>
              {stepErrors[i] && <span className="bad" aria-label="Has a problem">!</span>}
            </button>
          ))}
        </div>
        <div className="wbody pane" role="tabpanel">
          {step === 0 && (
            <>
              <h2>Basic info</h2>
              <p>Name the workflow so your team knows what it does.</p>
              <div className="stack" style={{ maxWidth: 620 }}>
                <Input label="Name" value={form.name} error={errors.name} onChange={(e) => set({ name: e.target.value })} />
                <Area label="Description" value={form.description} onChange={(e) => set({ description: e.target.value })} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label className="wfsw">
                    <input type="checkbox" role="switch" aria-label="Active" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                    <i />
                  </label>
                  <div><b>Active</b><div className="hint" style={{ margin: 0 }}>Runs on every new match as soon as you save.</div></div>
                </div>
              </div>
            </>
          )}
          {step === 1 && (
            <TriggerStep
              form={form} set={set} error={errors.trigger} token={token} hasToken={hasToken} saved={savedId !== null}
              canRegenerate={isManager && can('workflows', 'update')} onRegenerate={regenerate}
            />
          )}
          {step === 2 && <ConditionsStep form={form} set={set} errors={errors.conditions} />}
          {step === 3 && <ActionsStep form={form} set={set} errors={errors.actions} reps={reps} agents={agents} nameOf={nameOf} catchUp={catchUp} />}
          {step === 4 && (
            <ReviewStep
              form={form} nameOf={nameOf} general={errors.general} dirty={dirty} saved={savedId !== null} canTest={canTest} onTest={test}
              history={savedId ? <RunHistory workflowId={savedId} canRetry={can('workflows', 'execute')} /> : undefined}
            />
          )}
          <div className="wfoot">
            <Button style={{ visibility: step === 0 ? 'hidden' : undefined }} onClick={() => go(step - 1)}><ArrowLeft />Back</Button>
            <Button variant="primary" style={{ visibility: step === STEPS.length - 1 ? 'hidden' : undefined }} onClick={() => go(step + 1)}>Continue<ArrowRight /></Button>
          </div>
        </div>
      </div>
    </section>
  );
}
