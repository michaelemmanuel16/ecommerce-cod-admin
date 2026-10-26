import { useState } from 'react';
import { Button, EmptyState, Input, Modal, Pagination, Table, Tabs, Tag, useToast, type Column } from '../../ui-v2';
import { GuardedButtonV2 } from '../GuardedButtonV2';
import { collectionsService, type PartnerCollection, type PartnerDeposit } from '../../../services/collections.service';
import { apiErrorMessage } from '../../../utils/apiError';
import { formatCurrency, formatDate } from '../../../utils/format';
import { isPdfUrl, isSafeReceiptUrl } from '../../../utils/expenseRules';
import { useBlock } from '../../../pages/financial/profit/useBlock';
import { ListSkeleton } from '../../../pages/deliveries/ListSkeleton';
import { DEPOSIT_TONE, depositLabel } from '../../../pages/financial/collections/model';

/** The most collections the server verifies in one call; also the page size of the list. */
const MAX_VERIFY = 50;
const MIN_REASON = 5;

interface Props {
  onClose: () => void;
  agentId: number;
  agentName: string;
  /** Something changed (a verify or a reject): the page reloads its figures. */
  onChanged?: () => void;
}

/** What each pane needs: run one call, say `done`, reload this modal and the page together. */
type Run = (work: () => Promise<void>, done: string) => Promise<boolean>;
interface PaneProps {
  agentName: string;
  busy: boolean;
  run: Run;
}

const outstanding = (c: PartnerCollection) => Math.max(c.amount - c.allocatedAmount, 0);
const loading = <ListSkeleton label="Loading" rows={2} height={40} style={{ padding: 20 }} />;

/** Collections still to verify: one at a time or up to 50 together. Verify reconciles in one step. */
function CollectionsPane({ rows, agentName, busy, run }: PaneProps & { rows: PartnerCollection[] | null }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  if (rows === null) return loading;
  if (rows.length === 0) return <EmptyState title="Nothing to verify" text={`${agentName} has no collections waiting.`} />;

  const paged = rows.slice((page - 1) * MAX_VERIFY, page * MAX_VERIFY);
  const allOnPage = paged.every((c) => selected.has(c.id));
  const toggle = (ids: number[], on: boolean) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const verified = async (work: () => Promise<void>, done: string) => { if (await run(work, done)) setSelected(new Set()); };

  const columns: Column<PartnerCollection>[] = [
    {
      key: 'sel',
      width: 36,
      header: <input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={(e) => toggle(paged.map((c) => c.id), e.target.checked)} />,
      render: (c) => <input type="checkbox" aria-label={`Select order #${c.orderId}`} checked={selected.has(c.id)} onChange={(e) => toggle([c.id], e.target.checked)} />,
    },
    { key: 'order', header: 'Order', render: (c) => `#${c.orderId}` },
    { key: 'amount', header: 'Amount', right: true, render: (c) => <b className="num">{formatCurrency(outstanding(c))}</b> },
    { key: 'date', header: 'Delivered', render: (c) => formatDate(c.collectionDate, 'd MMM') },
    {
      key: 'act',
      header: 'Action',
      right: true,
      render: (c) => (
        <GuardedButtonV2 perm="verifyCollection" size="mini" variant="primary" disabled={busy} aria-label={`Verify order #${c.orderId}`} onClick={() => void verified(() => collectionsService.verify(c.id), `Order #${c.orderId} reconciled`)}>Verify</GuardedButtonV2>
      ),
    },
  ];

  return (
    <>
      <div className="agtools">
        <b className="mut">{selected.size > 0 ? `${selected.size} selected` : `Select collections to verify them together (up to ${MAX_VERIFY})`}</b>
        <GuardedButtonV2 perm="verifyCollection" variant="primary" disabled={selected.size === 0 || selected.size > MAX_VERIFY || busy} onClick={() => void verified(() => collectionsService.verifyMany([...selected]), `${selected.size} collections reconciled`)}>
          Verify selected{selected.size > 0 ? ` (${selected.size})` : ''}
        </GuardedButtonV2>
      </div>
      <Table label="Collections to verify" columns={columns} rows={paged} rowKey={(c) => c.id} />
      {rows.length > MAX_VERIFY && <Pagination page={page} pageSize={MAX_VERIFY} total={rows.length} noun="collections" onPageChange={setPage} />}
    </>
  );
}

/** Pay-ins: verify, or reject with a reason of at least 5 characters. */
function DepositsPane({ rows, agentName, busy, run }: PaneProps & { rows: PartnerDeposit[] | null }) {
  const [rejecting, setRejecting] = useState<PartnerDeposit | null>(null);
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  if (rows === null) return loading;
  if (rows.length === 0) return <EmptyState title="No pay-ins" text={`${agentName} has not sent a pay-in yet.`} />;

  const reject = async () => {
    if (!rejecting || reason.trim().length < MIN_REASON) return;
    const target = rejecting;
    if (await run(() => collectionsService.rejectDeposit(target.id, reason.trim()), `Pay-in ${target.referenceNumber} rejected`)) {
      setRejecting(null);
      setReason('');
    }
  };

  const columns: Column<PartnerDeposit>[] = [
    { key: 'ref', header: 'Reference', render: (d) => d.referenceNumber },
    { key: 'amount', header: 'Amount', right: true, render: (d) => <b className="num">{formatCurrency(d.amount)}</b> },
    { key: 'date', header: 'Date', render: (d) => formatDate(d.depositDate, 'd MMM') },
    { key: 'receipt', header: 'Receipt', render: (d) => (isSafeReceiptUrl(d.receiptUrl) ? <Button size="mini" onClick={() => setReceipt(d.receiptUrl)}>View</Button> : <span className="mut">No receipt</span>) },
    {
      key: 'status',
      header: 'Status',
      render: (d) => (
        <>
          <Tag tone={DEPOSIT_TONE[d.status]}>{depositLabel(d.status)}</Tag>
          {d.status === 'rejected' && d.rejectReason && <small className="note" style={{ display: 'block' }}>{d.rejectReason}</small>}
        </>
      ),
    },
    {
      key: 'act',
      header: 'Action',
      right: true,
      render: (d) =>
        d.status === 'pending' ? (
          <div className="rowacts">
            <GuardedButtonV2 perm="verifyCollection" size="mini" variant="primary" disabled={busy} aria-label={`Verify pay-in ${d.referenceNumber}`} onClick={() => void run(() => collectionsService.verifyDeposit(d.id), `Pay-in ${d.referenceNumber} verified`)}>Verify</GuardedButtonV2>
            <GuardedButtonV2 perm="verifyCollection" size="mini" disabled={busy} aria-label={`Reject pay-in ${d.referenceNumber}`} onClick={() => { setRejecting(d); setReason(''); }}>Reject</GuardedButtonV2>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <Table label="Pay-ins" columns={columns} rows={rows} rowKey={(d) => d.id} />
      {rejecting && (
        <form className="rejectbox" noValidate onSubmit={(e) => { e.preventDefault(); void reject(); }}>
          <Input label={`Why reject ${rejecting.referenceNumber}?`} value={reason} autoComplete="off" hint={`Required, at least ${MIN_REASON} characters.`} onChange={(e) => setReason(e.target.value)} />
          <div className="rowacts">
            <Button onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" disabled={reason.trim().length < MIN_REASON || busy} onClick={() => void reject()}>Reject pay-in</Button>
          </div>
        </form>
      )}
      <Modal open={receipt !== null} onClose={() => setReceipt(null)} title="Receipt" footer={<Button onClick={() => setReceipt(null)}>Close</Button>}>
        {receipt && (isPdfUrl(receipt) ? <iframe title="Receipt PDF" src={receipt} style={{ width: '100%', height: '60vh', border: 0 }} /> : <img src={receipt} alt="Receipt" style={{ maxWidth: '100%' }} />)}
      </Modal>
    </>
  );
}

/**
 * Review one partner's cash (F-912, M5-T36). Collections: verify reconciles in one step, one or up to 50 at once; there is no
 * approve step. Pay-ins: verify, or reject with a reason. After a change the modal and the page reload together.
 */
export function CollectionActionModal({ onClose, agentId, agentName, onChanged }: Props) {
  const say = useToast();
  const [tab, setTab] = useState<'collections' | 'deposits'>('collections');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toVerify = useBlock(`collections:to-verify:${agentId}`, () => collectionsService.toVerify(agentId));
  const payIns = useBlock(`collections:deposits:${agentId}`, () => collectionsService.deposits(agentId));
  const collections = toVerify.data ?? null;
  const deposits = payIns.data ?? null;
  const pending = (deposits ?? []).filter((d) => d.status === 'pending').length;

  // The modal's lists and the page reload together, so one change costs one round of requests
  const reload = () => {
    toVerify.retry();
    payIns.retry();
    void onChanged?.();
  };
  const run: Run = async (work, done) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      say(done);
      reload();
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, 'That did not work. Try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const pane = { agentName, busy, run };

  let body;
  if (toVerify.status === 'failed' && !collections) body = <EmptyState title="This partner's cash could not load." action={<Button onClick={reload}>Try again</Button>} />;
  else if (tab === 'collections') body = <CollectionsPane {...pane} rows={collections} />;
  else body = <DepositsPane {...pane} rows={deposits} />;

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Review ${agentName}`}
      description="Verify reconciles the cash in one step. There is no separate approval."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <Tabs
        label="What to review"
        items={[
          { id: 'collections', label: 'Collections', count: collections?.length },
          { id: 'deposits', label: 'Pay-ins', count: deposits ? (pending > 0 ? `${pending} pending` : deposits.length) : undefined },
        ]}
        value={tab}
        onChange={(id) => setTab(id as 'collections' | 'deposits')}
      />
      {error && <p className="err" role="alert">{error}</p>}
      {body}
    </Modal>
  );
}
