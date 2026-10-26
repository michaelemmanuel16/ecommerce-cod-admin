import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useV2Page } from '../../components/shell/useV2Page';
import { Button, ConfirmDialog, EmptyState, Modal, Pagination, Select, Table, Tag, useToast, type Column } from '../../components/ui-v2';
import { GuardedButtonV2 } from '../../components/financial/GuardedButtonV2';
import { ListSkeleton } from '../deliveries/ListSkeleton';
import {
  FINDING_TYPES, findingAssignees, findingsService, type Finding, type FindingList, type FindingStatus, type FindingType,
} from '../../services/findings.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, formatDate } from '../../utils/format';
import { STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from './findingsModel';

const PAGE_SIZE = 25;
const STATUSES: FindingStatus[] = ['open', 'explained', 'closed', 'written_off'];

/** Resolve one Finding: give it to someone, explain it, or (owner only) write it off. A note is required to explain or write off. */
function ResolveModal({ finding, people, onClose, onDone }: { finding: Finding; people: Array<{ id: number; name: string }>; onClose: () => void; onDone: () => void }) {
  const say = useToast();
  const [assignee, setAssignee] = useState(finding.assigneeId ? String(finding.assigneeId) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const needsNote = note.trim() === '';

  const save = async (change: Parameters<typeof findingsService.update>[1], done: string) => {
    setBusy(true);
    setError(null);
    try {
      await findingsService.update(finding.id, change);
      say(done);
      onDone();
      onClose();
    } catch (e) {
      setBusy(false);
      setConfirmOff(false);
      setError(apiErrorMessage(e, 'The Finding could not be saved.'));
    }
  };
  const assignChange = assignee === '' ? null : Number(assignee);
  const assignmentChanged = assignChange !== finding.assigneeId;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={TYPE_LABEL[finding.type]}
        description={finding.note ?? undefined}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !assignmentChanged} onClick={() => void save({ assigneeId: assignChange }, assignChange === null ? 'Finding unassigned' : 'Finding assigned')}>Save assignment</Button>
            <GuardedButtonV2 perm="resolveFinding" variant="primary" disabled={busy || needsNote} onClick={() => void save({ status: 'explained', explanation: note.trim(), ...(assignmentChanged ? { assigneeId: assignChange } : {}) }, 'Finding explained')}>Mark explained</GuardedButtonV2>
            <GuardedButtonV2 perm="writeOffFinding" variant="danger" disabled={busy || needsNote} onClick={() => setConfirmOff(true)}>Write off</GuardedButtonV2>
          </>
        }
      >
        <div className="fform">
          {finding.amount !== null && <p className="fmeta">Amount <b className="num">{formatCurrency(finding.amount)}</b></p>}
          <Select label="Assigned to" value={assignee} onChange={(e) => setAssignee(e.target.value)} hint={people.length === 0 ? 'Only the owner, admins and managers can pick a person.' : undefined} disabled={people.length === 0}>
            <option value="">Nobody</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <div className="fl">
            <label htmlFor="finding-note">Note</label>
            <textarea id="finding-note" value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="hint">Required to explain or write off.</p>
          </div>
          {error && <p className="err" role="alert">{error}</p>}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => void save({ status: 'written_off', explanation: note.trim(), ...(assignmentChanged ? { assigneeId: assignChange } : {}) }, 'Finding written off')}
        action="Write off"
        count={1}
        noun="Finding"
        title="Write off this Finding?"
      >
        {finding.amount !== null ? `${formatCurrency(finding.amount)} is posted to the ledger as a loss or a payable cleared.` : 'This posts to the ledger.'} You cannot undo it.
      </ConfirmDialog>
    </>
  );
}

/** /finance/findings: list, filter, assign, explain and write off Findings (F-909, M5-T35). The filters and page are in the URL. */
export function Findings() {
  useV2Page();
  const [search, setSearch] = useSearchParams();
  const type = (FINDING_TYPES as readonly string[]).includes(search.get('type') ?? '') ? (search.get('type') as FindingType) : undefined;
  const statusParam = search.get('status');
  const status: FindingStatus | undefined = statusParam === 'all' ? undefined : STATUSES.includes(statusParam as FindingStatus) ? (statusParam as FindingStatus) : 'open';
  const assigneeParam = search.get('assignee');
  const assigneeId = assigneeParam === 'none' ? 'none' : Number(assigneeParam) > 0 ? Number(assigneeParam) : undefined;
  const page = Math.max(1, Number(search.get('page')) || 1);

  const [data, setData] = useState<FindingList | null>(null);
  const [failed, setFailed] = useState(false);
  const [people, setPeople] = useState<Array<{ id: number; name: string }>>([]);
  const [resolving, setResolving] = useState<Finding | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await findingsService.list({ type, status, assigneeId, page, limit: PAGE_SIZE }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [type, status, assigneeId, page]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void findingAssignees().then(setPeople);
  }, []);

  const set = (key: string, value: string) =>
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      next.delete('page');
      return next;
    });

  const columns = useMemo<Column<Finding>[]>(() => [
    {
      key: 'finding',
      header: 'Finding',
      render: (f) => (
        <div className="fnote">
          <b>{TYPE_LABEL[f.type]}</b>
          {f.note && <small>{f.note}</small>}
          {f.explanation && <small>Note: {f.explanation}</small>}
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', right: true, render: (f) => (f.amount === null ? <span className="mut">—</span> : <b className="num">{formatCurrency(f.amount)}</b>) },
    { key: 'status', header: 'Status', render: (f) => <Tag tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Tag> },
    { key: 'who', header: 'Assigned to', render: (f) => f.assignee?.name ?? <span className="mut">Nobody</span> },
    { key: 'opened', header: 'Opened', render: (f) => formatDate(f.createdAt, 'd MMM') },
    {
      key: 'act',
      header: 'Action',
      right: true,
      render: (f) => (f.status === 'open' ? <Button size="mini" variant="primary" aria-label={`Resolve ${TYPE_LABEL[f.type]}`} onClick={() => setResolving(f)}>Resolve</Button> : null),
    },
  ], []);

  const filtered = Boolean(type || assigneeId !== undefined || status !== 'open');

  return (
    <section className="findings">
      <div className="head">
        <div>
          <h1>Findings</h1>
          <p>Gaps between the books and what happened. Work each one until it is explained or written off.</p>
        </div>
        <Link className="btn" to="/finance"><ArrowLeft />Finance</Link>
      </div>

      <div className="card findwrap">
        <div className="filters">
          <Select compact label="Status" value={statusParam === 'all' ? 'all' : status ?? 'open'} onChange={(e) => set('status', e.target.value === 'open' ? '' : e.target.value)}>
            <option value="open">Open</option>
            <option value="explained">Explained</option>
            <option value="closed">Closed</option>
            <option value="written_off">Written off</option>
            <option value="all">All statuses</option>
          </Select>
          <Select compact label="Type" value={type ?? ''} onChange={(e) => set('type', e.target.value)}>
            <option value="">All types</option>
            {FINDING_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
          <Select compact label="Assigned to" value={assigneeParam ?? ''} onChange={(e) => set('assignee', e.target.value)}>
            <option value="">Anyone</option>
            <option value="none">Nobody</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>

        {!data && !failed ? (
          <ListSkeleton label="Loading Findings" rows={3} height={44} style={{ padding: 20 }} />
        ) : failed && !data ? (
          <EmptyState title="The Findings could not load." action={<Button onClick={() => void load()}>Try again</Button>} />
        ) : data && data.findings.length === 0 ? (
          filtered ? (
            <EmptyState title="No Findings match" text="Change the filters to see more." action={<Button onClick={() => setSearch(new URLSearchParams())}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<ShieldCheck />} title="No open Findings" text="A gap shows here when a payout, count or deposit does not match the books." />
          )
        ) : data ? (
          <Table label="Findings" columns={columns} rows={data.findings} rowKey={(f) => f.id} />
        ) : null}

        {data && data.pagination.total > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.pagination.total} noun="Findings" onPageChange={(p) => setSearch((prev) => { const n = new URLSearchParams(prev); n.set('page', String(p)); return n; })} />
        )}
      </div>

      {resolving && <ResolveModal finding={resolving} people={people} onClose={() => setResolving(null)} onDone={() => void load()} />}
    </section>
  );
}
