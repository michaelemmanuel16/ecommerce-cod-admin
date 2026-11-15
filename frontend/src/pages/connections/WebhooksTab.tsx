import { Fragment, useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, ScrollText, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import clsx from 'clsx';
import { Button, Card, ConfirmDialog, EmptyState, Skeleton, Tabs, Tag, useToast } from '../../components/ui-v2';
import { webhooksService } from '../../services/webhooks.service';
import type { Webhook, WebhookLog } from '../../types';
import { apiErrorMessage } from '../../utils/apiError';
import { CopyButton } from './parts';
import { WebhookDialog } from './WebhookDialog';

type Row = Webhook & { product?: { name: string } | null };

const apiBase = (): string => import.meta.env.VITE_API_URL || window.location.origin;
const importUrl = (w: Pick<Webhook, 'uniqueUrl'>) => `${apiBase()}/api/webhooks/import/${w.uniqueUrl}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const short = (key: string) => `${key.slice(0, 6)}...${key.slice(-4)}`;

/** Webhooks tab (M9-T45, F-1209 to F-1212): the list, create, edit, delete, and per webhook its logs and how to send. */
export function WebhooksTab() {
  const say = useToast();
  const [hooks, setHooks] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [panel, setPanel] = useState<'logs' | 'how'>('logs');

  const load = useCallback(async () => {
    try {
      setHooks((await webhooksService.getWebhooks()).webhooks as Row[]);
      setFailed(null);
    } catch (e) {
      setFailed(apiErrorMessage(e, 'The webhooks could not load.'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async () => {
    if (!deleting) return;
    const w = deleting;
    setDeleting(null);
    try {
      await webhooksService.deleteWebhook(w.id);
      say(`${w.name} deleted`);
      if (openId === w.id) setOpenId(null);
      await load();
    } catch (e) {
      say(apiErrorMessage(e, 'The webhook could not be deleted.'));
    }
  };

  const open = hooks?.find((h) => h.id === openId) ?? null;

  return (
    <>
      <Card>
        <div className="ct">
          <h3>Webhooks</h3>
          <Button variant="primary" size="mini" onClick={() => setEditing('new')}><Plus size={14} /> New webhook</Button>
        </div>
        <p className="secnote">Other forms and pages can post orders to a private import URL. Pick a webhook to read its logs.</p>
        {failed ? (
          <div className="opserr" role="alert">{failed} <Button size="mini" onClick={load}>Retry</Button></div>
        ) : hooks === null ? (
          <div style={{ padding: 20 }}><Skeleton height={100} /></div>
        ) : hooks.length === 0 ? (
          <EmptyState
            icon={<WebhookIcon />} title="No webhooks yet" text="Make one to import orders from another form or page."
            action={<Button variant="primary" onClick={() => setEditing('new')}>New webhook</Button>}
          />
        ) : (
          <div className="tablewrap">
            <table className="wh" aria-label="Webhooks">
              <thead>
                <tr><th scope="col">Name</th><th scope="col">Import URL</th><th scope="col">Key</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {hooks.map((w) => (
                  <tr key={w.id} className={clsx(w.id === openId && 'on')}>
                    <td><b>{w.name}</b><span className="td-sub">{w.product?.name ?? 'No product'}</span></td>
                    <td><div className="urlc"><span className="mono" title={importUrl(w)}>{importUrl(w)}</span><CopyButton text={importUrl(w)} label="Copy URL" /></div></td>
                    <td>
                      {w.apiKey
                        ? <div className="urlc"><span className="mono">{short(w.apiKey)}</span><CopyButton text={w.apiKey} label="Copy key" /></div>
                        : <span className="mut">None</span>}
                    </td>
                    <td>{w.isActive ? <Tag tone="ok">On</Tag> : <Tag>Off</Tag>}</td>
                    <td>
                      <div className="acts-row">
                        <Button size="mini" onClick={() => { setOpenId(w.id); setPanel('logs'); }} aria-label={`Logs for ${w.name}`}><ScrollText size={14} /> Logs</Button>
                        <Button size="mini" onClick={() => setEditing(w)} aria-label={`Edit ${w.name}`}><Pencil size={14} /> Edit</Button>
                        <Button size="mini" onClick={() => setDeleting(w)} aria-label={`Delete ${w.name}`}><Trash2 size={14} /> Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <Card title={open.name}>
          <Tabs
            label="Webhook detail" value={panel} onChange={(id) => setPanel(id as 'logs' | 'how')}
            items={[{ id: 'logs', label: 'Logs' }, { id: 'how', label: 'How to send' }]}
          />
          {panel === 'logs' ? <Logs webhook={open} /> : <HowToSend webhook={open} />}
        </Card>
      )}

      <WebhookDialog
        open={editing !== null} webhook={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(saved) => { void load(); if (editing === 'new') { setOpenId(saved.id); setPanel('how'); } }}
      />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} action="Delete" count={1} noun="webhook" title={deleting ? `Delete ${deleting.name}?` : undefined}>
        Its import URL stops working. Orders already imported stay. The logs are deleted.
      </ConfirmDialog>
    </>
  );
}

function HowToSend({ webhook }: { webhook: Row }) {
  return (
    <div style={{ padding: '16px 20px 20px', display: 'grid', gap: 14 }}>
      <div>
        <small className="mut" style={{ fontWeight: 600 }}>Send a POST request with a JSON body to</small>
        <div className="urlc" style={{ marginTop: 6 }}><div className="code" style={{ flex: 1 }}>{importUrl(webhook)}</div><CopyButton text={importUrl(webhook)} label="Copy URL" /></div>
      </div>
      {webhook.apiKey && (
        <div>
          <small className="mut" style={{ fontWeight: 600 }}>Or send it to {apiBase()}/api/webhooks/import with this key in the header X-API-Key</small>
          <div className="urlc" style={{ marginTop: 6 }}><div className="code" style={{ flex: 1 }}>{webhook.apiKey}</div><CopyButton text={webhook.apiKey} label="Copy key" /></div>
        </div>
      )}
      <div className="strip warn"><span>Keep the URL and the key private. If they leak, make a new webhook and delete this one.</span></div>
    </div>
  );
}

function Logs({ webhook }: { webhook: Row }) {
  const say = useToast();
  const [logs, setLogs] = useState<WebhookLog[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filter, setFilter] = useState<'all' | 'bad'>('all');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async (p: number, append: boolean) => {
    try {
      const res = await webhooksService.getWebhookLogs(webhook.id, { page: p, limit: 20 });
      setLogs((cur) => (append ? [...(cur ?? []), ...res.logs] : res.logs));
      setPage(res.pagination.page);
      setPages(res.pagination.pages);
      setFailed(null);
    } catch (e) {
      setFailed(apiErrorMessage(e, 'The logs could not load.'));
    }
  }, [webhook.id]);

  useEffect(() => { setLogs(null); setExpanded(null); void load(1, false); }, [load]);

  const retry = async (log: WebhookLog) => {
    setRetrying(log.id);
    try {
      await webhooksService.retryWebhook(webhook.id, log.id);
      say('Delivery retried');
      await load(1, false);
    } catch (e) {
      say(apiErrorMessage(e, 'The delivery could not be retried.'));
    } finally {
      setRetrying(null);
    }
  };

  if (failed) return <div className="opserr" role="alert">{failed} <Button size="mini" onClick={() => load(1, false)}>Retry</Button></div>;
  if (logs === null) return <div style={{ padding: 20 }}><Skeleton height={100} /></div>;
  const shown = filter === 'bad' ? logs.filter((l) => !l.success) : logs;
  const count = logs.filter((l) => !l.success).length;

  return (
    <>
      <div className="filters" style={{ borderBottom: '1px solid var(--line)', padding: '10px 20px' }}>
        <Tabs label="Log filter" value={filter} onChange={(id) => setFilter(id as 'all' | 'bad')} items={[{ id: 'all', label: 'All' }, { id: 'bad', label: 'Failed', count }]} className="pgtabs" />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<ScrollText />} title={filter === 'bad' ? 'No failed requests' : 'No requests yet'} text="Requests to this URL show here." />
      ) : (
        <div className="tablewrap">
          <table className="lg" aria-label="Webhook logs">
            <thead><tr><th scope="col">Time</th><th scope="col">Status</th><th scope="col">Error</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((l) => (
                <Fragment key={l.id}>
                  <tr className="row" onClick={() => setExpanded(expanded === l.id ? null : l.id)} aria-expanded={expanded === l.id}>
                    <td>{when(l.processedAt)}</td>
                    <td>{l.success ? <Tag tone="ok">Done</Tag> : <Tag tone="bad">Failed</Tag>} <span className="mut">{l.statusCode ?? ''}</span></td>
                    <td>{l.errorMessage ?? <span className="mut">None</span>}</td>
                    <td>
                      <div className="acts-row">
                        {!l.success && l.statusCode !== 401 && (
                          <Button size="mini" disabled={retrying === l.id} onClick={(e) => { e.stopPropagation(); void retry(l); }} aria-label={`Retry delivery from ${when(l.processedAt)}`}>
                            {retrying === l.id ? 'Retrying...' : 'Retry'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === l.id && (
                    <tr className="dtl">
                      <td colSpan={4}>
                        <div className="cols2">
                          <div><small>Request</small><div className="code">{JSON.stringify(l.body, null, 2)}</div></div>
                          <div><small>Response</small><div className="code">{JSON.stringify(l.response ?? {}, null, 2)}</div></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page < pages && <div className="more"><Button onClick={() => load(page + 1, true)}>Show more</Button></div>}
    </>
  );
}
