import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Skeleton, Tag, useToast, type TagTone } from '../../../components/ui-v2';
import { workflowsService, type WorkflowRun, type WorkflowStep } from '../../../services/workflows.service';
import { apiErrorMessage } from '../../../utils/apiError';
import { formatDateTime, formatRelativeTime } from '../../../utils/format';
import { formatOrderNumber } from '../../../utils/orderNumber';

const PAGE = 10;

const RESULT: Record<string, { label: string; tone: TagTone }> = {
  completed: { label: 'Success', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  skipped: { label: 'Skipped', tone: 'n' },
  pending: { label: 'Waiting to start', tone: 'warn' },
  running: { label: 'Running', tone: 'warn' },
  waiting: { label: 'Waiting', tone: 'warn' },
};

const SOURCE: Record<string, string> = {
  manual: 'Run by a person', screen: 'Screen', import: 'Import', mcp: 'Agent', webhook: 'Webhook', payment: 'Payment',
  schedule: 'Schedule', catch_up: 'Catch-up', retry: 'Retry',
};
const sourceLabel = (s: string | null) => (s ? SOURCE[s] ?? s.replace(/_/g, ' ') : 'Not known');

const STEP_TONE: Record<string, TagTone> = { completed: 'ok', failed: 'bad', skipped: 'n', planned: 'n' };

const resultText = (step: WorkflowStep): string => {
  if (step.result === null || step.result === undefined) return '';
  const text = typeof step.result === 'string' ? step.result : JSON.stringify(step.result);
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
};

interface RunHistoryProps {
  workflowId: number;
  /** The person may start a retry (workflows: execute). */
  canRetry: boolean;
}

/**
 * The runs of one workflow (M9-T43, F-502): status, source, order, start and finish; open a run to see each step's result and
 * error. A failed run has Retry (POST /api/workflows/executions/:id/retry). A refusal (409: workflow off, workflow changed,
 * already retried) is shown in the API's own words.
 */
export function RunHistory({ workflowId, canRetry }: RunHistoryProps) {
  const say = useToast();
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);

  const load = useCallback(async (upTo: number) => {
    try {
      const all: WorkflowRun[] = [];
      let last = 1;
      for (let p = 1; p <= upTo; p++) {
        const r = await workflowsService.getRuns(workflowId, { page: p, limit: PAGE });
        all.push(...r.executions);
        last = r.pagination.pages;
      }
      setRuns(all);
      setPages(last);
      setFailed(null);
    } catch (e) {
      setFailed(apiErrorMessage(e, 'The run history could not load.'));
    }
  }, [workflowId]);

  useEffect(() => { void load(1); }, [load]);

  const retry = async (run: WorkflowRun) => {
    setRetrying(run.id);
    try {
      const r = await workflowsService.retryRun(run.id);
      say(r.message || 'Retry started');
      await load(page);
    } catch (e) {
      say(apiErrorMessage(e, 'The run could not be retried.'));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="card hist" style={{ boxShadow: 'none' }}>
      <div className="ct"><h3>Run history</h3><Button size="mini" onClick={() => { setPage(1); void load(1); }}>Refresh</Button></div>
      {failed ? (
        <EmptyState title={failed} action={<Button onClick={() => void load(page)}>Try again</Button>} />
      ) : runs === null ? (
        <div style={{ padding: 20 }}><Skeleton height={60} /></div>
      ) : runs.length === 0 ? (
        <EmptyState title="No runs yet" text="Runs show here when the workflow starts, from an order, a schedule, a webhook or the Run button." />
      ) : (
        <>
          <div className="tablewrap">
            <table aria-label="Run history">
              <thead><tr><th>Order</th><th>Result</th><th>Source</th><th>Started</th><th>Finished</th><th /></tr></thead>
              <tbody>
                {runs.map((r) => {
                  const result = r.mode === 'test' ? { label: 'Test', tone: 'v' as TagTone } : RESULT[r.status] ?? { label: r.status, tone: 'n' as TagTone };
                  const isOpen = openId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td>{r.orderId ? <Link to={`/orders/${r.orderId}`}><b>{formatOrderNumber(r.orderId)}</b></Link> : <span className="mut">No order</span>}</td>
                        <td>
                          <Tag tone={result.tone}>{result.label}</Tag>
                          {r.status === 'failed' && r.error && <small className="err" style={{ display: 'block' }}>{r.error}</small>}
                        </td>
                        <td>{sourceLabel(r.triggerSource)}</td>
                        <td title={formatDateTime(r.startedAt)}>{formatRelativeTime(r.startedAt)}</td>
                        <td title={r.finishedAt ? formatDateTime(r.finishedAt) : undefined}>{r.finishedAt ? formatRelativeTime(r.finishedAt) : <span className="mut">Not yet</span>}</td>
                        <td style={{ textAlign: 'right' }}>
                          <Button size="mini" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} steps of run ${r.id}`} onClick={() => setOpenId(isOpen ? null : r.id)}>{isOpen ? 'Hide steps' : 'Steps'}</Button>
                          {canRetry && r.status === 'failed' && r.mode === 'live' && (
                            <Button size="mini" variant="primary" style={{ marginLeft: 6 }} disabled={retrying === r.id} aria-label={`Retry run ${r.id}`} onClick={() => void retry(r)}>Retry</Button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="steps2">
                            {r.steps.length === 0 ? (
                              <p className="mut">{r.error ? `No step ran: ${r.error.replace(/_/g, ' ')}.` : 'No step has run yet.'}</p>
                            ) : (
                              <ul>
                                {r.steps.map((s) => (
                                  <li key={s.index}>
                                    <Tag tone={STEP_TONE[s.status] ?? 'warn'}>{s.status}</Tag>
                                    <div>
                                      <b>{s.index + 1}. {String(s.type ?? 'step').replace(/_/g, ' ')}</b>
                                      {s.error && <div className="err">{s.error}</div>}
                                      {!s.error && resultText(s) && <pre>{resultText(s)}</pre>}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {page < pages && (
            <div className="foot"><span /><Button size="mini" onClick={() => { const next = page + 1; setPage(next); void load(next); }}>Show older runs</Button></div>
          )}
        </>
      )}
    </div>
  );
}
