import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Activity, AlertTriangle, LayoutTemplate, Pencil, PlayCircle, Plus, Search, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, ConfirmDialog, EmptyState, Skeleton, Table, Tabs, Tag, Tile, useToast, type Column } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { workflowsService, type Workflow, type WorkflowList, type WorkflowTemplate } from '../services/workflows.service';
import { apiErrorMessage } from '../utils/apiError';
import { formatRelativeTime } from '../utils/format';
import { describeTrigger, triggerChoice } from './workflows/model';

type Filter = 'all' | 'on' | 'off';

const people = (n: number) => n.toLocaleString('en-GB');

/**
 * Workflows (M9-T41, COD-84, F-500 F-501 F-504), built from docs/mockups/v2/workflows.html: the list with its tiles, tabs and
 * search, the switch, delete, and the template gallery. Every figure comes from GET /api/workflows (`summary`, `stats`).
 * The builder is WorkflowWizard (T42); run history and the Run button are T43.
 */
export function Workflows() {
  useV2Page();
  const navigate = useNavigate();
  const say = useToast();
  const { can } = usePermissions();
  const canCreate = can('workflows', 'create');
  const canUpdate = can('workflows', 'update');
  const canDelete = can('workflows', 'delete');

  const [data, setData] = useState<WorkflowList | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WorkflowTemplate[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<Workflow | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const gallery = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await workflowsService.getWorkflows());
      setFailed(null);
    } catch (e) {
      setFailed(apiErrorMessage(e, 'The workflows could not load.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canCreate) return;
    workflowsService.getTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [canCreate]);

  const workflows = data?.workflows ?? [];
  const on = workflows.filter((w) => w.isActive).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workflows.filter((w) => {
      if (filter === 'on' && !w.isActive) return false;
      if (filter === 'off' && w.isActive) return false;
      return !q || `${w.name} ${w.description ?? ''}`.toLowerCase().includes(q);
    });
  }, [workflows, filter, query]);

  const toggle = async (w: Workflow, next: boolean) => {
    setBusyId(w.id);
    try {
      await workflowsService.updateWorkflow(w.id, { isActive: next });
      say(next ? `${w.name} is on` : `${w.name} is off`);
      await load();
    } catch (e) {
      say(apiErrorMessage(e, 'The workflow could not be changed.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const w = deleting;
    setDeleting(null);
    try {
      await workflowsService.deleteWorkflow(w.id);
      say('Workflow deleted');
      await load();
    } catch (e) {
      say(apiErrorMessage(e, 'The workflow could not be deleted.'));
    }
  };

  const columns: Column<Workflow>[] = [
    {
      key: 'name', header: 'Workflow',
      render: (w) => {
        const t = triggerChoice(w.triggerType);
        return (
          <div className="wfname">
            <div className={clsx('icn', t.tone)}><t.icon /></div>
            <div>
              <Link to={`/workflows/${w.id}`}>{w.name}</Link>
              {w.description && <small>{w.description}</small>}
            </div>
          </div>
        );
      },
    },
    { key: 'trigger', header: 'Trigger', render: (w) => <Tag>{describeTrigger(w)}</Tag> },
    { key: 'actions', header: 'Actions', right: true, render: (w) => (Array.isArray(w.actions) ? w.actions.length : 0) },
    {
      key: 'last', header: 'Last run',
      render: (w) => (w.stats?.lastRunAt ? formatRelativeTime(w.stats.lastRunAt) : <span className="mut">Never</span>),
    },
    {
      key: 'runs', header: 'Runs, 30 days', right: true,
      render: (w) => {
        const s = w.stats;
        return (
          <div className="runs">
            <b>{people(s?.runs ?? 0)}</b>
            <small>{people(s?.succeeded ?? 0)} passed, {people(s?.failed ?? 0)} failed</small>
          </div>
        );
      },
    },
    {
      key: 'active', header: 'Active',
      render: (w) => canUpdate ? (
        <label className="wfsw">
          <input type="checkbox" role="switch" aria-label={`Active: ${w.name}`} checked={w.isActive} disabled={busyId === w.id} onChange={(e) => void toggle(w, e.target.checked)} />
          <i />
        </label>
      ) : <Tag tone={w.isActive ? 'ok' : 'n'}>{w.isActive ? 'On' : 'Off'}</Tag>,
    },
    {
      key: 'tools', header: '', right: true,
      render: (w) => (
        <div className="rowtools">
          <button type="button" className="iconbtn" aria-label={`Open ${w.name}`} title="Open" onClick={() => navigate(`/workflows/${w.id}`)}><Pencil /></button>
          {canDelete && (
            <button type="button" className="iconbtn dng" aria-label={`Delete ${w.name}`} title="Delete" onClick={() => setDeleting(w)}><Trash2 /></button>
          )}
        </div>
      ),
    },
  ];

  const summary = data?.summary;
  const title = (
    <div>
      <h1>Workflows</h1>
      <p>
        Rules that run on your orders for you.
        {summary && ` ${people(summary.activeCount)} ${summary.activeCount === 1 ? 'is' : 'are'} on and ran ${people(summary.runsToday)} ${summary.runsToday === 1 ? 'time' : 'times'} today.`}
      </p>
    </div>
  );
  const actions = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {canCreate && (
        <>
          <Button onClick={() => gallery.current?.scrollIntoView({ behavior: 'smooth' })}><LayoutTemplate />Browse templates</Button>
          <Button variant="primary" onClick={() => navigate('/workflows/new')}><Plus />New workflow</Button>
        </>
      )}
    </div>
  );

  if (failed && !data) {
    return (
      <section className="wf">
        <div className="head">{title}</div>
        <div className="card"><EmptyState title={failed} action={<Button onClick={() => void load()}>Try again</Button>} /></div>
      </section>
    );
  }
  if (!data) {
    return <section className="wf" aria-busy="true" aria-label="Loading workflows"><div className="head">{title}</div><Skeleton height={160} /></section>;
  }

  return (
    <section className="wf">
      <div className="head">{title}{actions}</div>

      <div className="grid kpis three">
        <Tile icon={<PlayCircle />} tone="mint" value={people(summary!.activeCount)} label="Active"
          footer={<><span>{people(workflows.length - on)} switched off</span><Tag tone="ok">On</Tag></>} />
        <Tile icon={<Activity />} tone="pine" value={people(summary!.runsToday)} label="Runs today"
          footer={<span>Test runs and skipped runs are not counted</span>} />
        <Tile icon={<AlertTriangle />} tone="coral" value={people(summary!.failuresToday)} label="Failed runs today"
          footer={<><span>{summary!.failuresToday === 0 ? 'Nothing failed' : 'Open a workflow to retry'}</span>{summary!.failuresToday > 0 && <Tag tone="bad">Check</Tag>}</>} />
      </div>

      <div className="card">
        <div className="toolbar">
          <label className="srch">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search workflows" aria-label="Search workflows" />
          </label>
          <Tabs
            label="Workflow status" value={filter} onChange={(id) => setFilter(id as Filter)}
            items={[{ id: 'all', label: 'All', count: workflows.length }, { id: 'on', label: 'Active', count: on }, { id: 'off', label: 'Inactive', count: workflows.length - on }]}
          />
        </div>
        {workflows.length === 0 ? (
          <EmptyState
            icon={<WorkflowIcon />} title="No workflows yet"
            text="A workflow runs on its own when an order arrives or changes. Start from a template or build your own."
            action={canCreate ? <Button variant="primary" onClick={() => navigate('/workflows/new')}><Plus />New workflow</Button> : undefined}
          />
        ) : shown.length === 0 ? (
          <EmptyState title="No workflows match." />
        ) : (
          <Table label="Workflows" className="wft" columns={columns} rows={shown} rowKey={(w) => w.id} />
        )}
        <div className="foot"><span>Switch a workflow off to stop it without deleting it.</span></div>
      </div>

      {canCreate && (
        <div className="card" ref={gallery} id="templates">
          <div className="ct"><h3>Start from a template</h3><span>{templates ? `${templates.length} templates` : ''}</span></div>
          {templates === null ? (
            <div style={{ padding: 20 }}><Skeleton height={90} /></div>
          ) : templates.length === 0 ? (
            <EmptyState title="No templates." />
          ) : (
            <div className="gal">
              {templates.map((t) => {
                const choice = triggerChoice(t.triggerType);
                return (
                  <button
                    key={t.id} type="button" className="tpl" disabled={!t.available}
                    onClick={() => navigate('/workflows/new', { state: { template: t } })}
                  >
                    <div className={clsx('icn', choice.tone)}><choice.icon /></div>
                    <b>{t.name}</b>
                    <p>{t.description}</p>
                    {!t.available && <span className="why">{t.unavailableReason ?? 'Not available'}</span>}
                    <div className="meta"><span>{t.category}</span><Tag>{choice.label}</Tag></div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null} onClose={() => setDeleting(null)} onConfirm={() => void remove()}
        action="Delete" count={1} noun="workflow" title={deleting ? `Delete "${deleting.name}"?` : undefined}
      >
        Its run history goes with it and you cannot undo this. Switch it off to stop it without deleting it.
      </ConfirmDialog>
    </section>
  );
}
