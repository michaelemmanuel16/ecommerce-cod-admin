import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Input, Modal, Pagination, Skeleton, Table, Tabs, Tag, useToast, type Column } from '../../ui-v2';
import { GuardedButtonV2 } from '../GuardedButtonV2';
import { collectionsService, type PartnerCollection, type PartnerDeposit } from '../../../services/collections.service';
import { apiErrorMessage } from '../../../utils/apiError';
import { formatCurrency, formatDate } from '../../../utils/format';
import { isPdfUrl, isSafeReceiptUrl } from '../../../utils/expenseRules';

const PAGE_SIZE = 50; // also the most the server verifies in one call
const MIN_REASON = 5;

interface Props {
  /** Old callers pass it; the modal is open while it is mounted unless this is false. */
  isOpen?: boolean;
  onClose: () => void;
  agentId: number;
  agentName: string;
  /** Something changed (a verify or a reject): the page reloads its figures. */
  onChanged?: () => void;
}

const DEPOSIT_TONE = { pending: 'warn', verified: 'ok', rejected: 'bad' } as const;
const outstanding = (c: PartnerCollection) => Math.max(c.amount - c.allocatedAmount, 0);

/**
 * Review one partner's cash (F-912, M5-T36). Collections: verify reconciles in one step, one or up to 50 at once; there is no
 * approve step. Pay-ins: verify, or reject with a reason of at least 5 characters.
 */
export function CollectionActionModal({ isOpen = true, onClose, agentId, agentName, onChanged }: Props) {
  const say = useToast();
  const [tab, setTab] = useState<'collections' | 'deposits'>('collections');
  const [collections, setCollections] = useState<PartnerCollection[] | null>(null);
  const [deposits, setDeposits] = useState<PartnerDeposit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PartnerDeposit | null>(null);
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([collectionsService.toVerify(agentId), collectionsService.deposits(agentId)]);
      setCollections(c);
      setDeposits(d);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [agentId]);
  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const paged = useMemo(() => (collections ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [collections, page]);
  const pending = (deposits ?? []).filter((d) => d.status === 'pending').length;

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      say(done);
      setSelected(new Set());
      await load();
      onChanged?.();
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, 'That did not work. Try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const verifyOne = (c: PartnerCollection) => run(() => collectionsService.verify(c.id), `Order #${c.orderId} reconciled`);
  const verifySelected = () => run(() => collectionsService.verifyMany([...selected]), `${selected.size} collections reconciled`);
  const verifyDeposit = (d: PartnerDeposit) => run(() => collectionsService.verifyDeposit(d.id), `Pay-in ${d.referenceNumber} verified`);
  const reject = async () => {
    if (!rejecting || reason.trim().length < MIN_REASON) return;
    const target = rejecting;
    if (await run(() => collectionsService.rejectDeposit(target.id, reason.trim()), `Pay-in ${target.referenceNumber} rejected`)) {
      setRejecting(null);
      setReason('');
    }
  };

  const allOnPage = paged.length > 0 && paged.every((c) => selected.has(c.id));
  const toggle = (id: number, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const collectionColumns: Column<PartnerCollection>[] = [
    {
      key: 'sel',
      width: 36,
      header: <input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={(e) => setSelected((s) => { const n = new Set(s); paged.forEach((c) => (e.target.checked ? n.add(c.id) : n.delete(c.id))); return n; })} />,
      render: (c) => <input type="checkbox" aria-label={`Select order #${c.orderId}`} checked={selected.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />,
    },
    { key: 'order', header: 'Order', render: (c) => `#${c.orderId}` },
    { key: 'amount', header: 'Amount', right: true, render: (c) => <b className="num">{formatCurrency(outstanding(c))}</b> },
    { key: 'date', header: 'Delivered', render: (c) => formatDate(c.collectionDate, 'd MMM') },
    { key: 'act', header: 'Action', right: true, render: (c) => <GuardedButtonV2 perm="verifyCollection" size="mini" variant="primary" disabled={busy} aria-label={`Verify order #${c.orderId}`} onClick={() => void verifyOne(c)}>Verify</GuardedButtonV2> },
  ];

  const depositColumns: Column<PartnerDeposit>[] = [
    { key: 'ref', header: 'Reference', render: (d) => d.referenceNumber },
    { key: 'amount', header: 'Amount', right: true, render: (d) => <b className="num">{formatCurrency(d.amount)}</b> },
    { key: 'date', header: 'Date', render: (d) => formatDate(d.depositDate, 'd MMM') },
    { key: 'receipt', header: 'Receipt', render: (d) => (isSafeReceiptUrl(d.receiptUrl) ? <Button size="mini" onClick={() => setReceipt(d.receiptUrl)}>View</Button> : <span className="mut">No receipt</span>) },
    {
      key: 'status',
      header: 'Status',
      render: (d) => (
        <>
          <Tag tone={DEPOSIT_TONE[d.status]}>{d.status[0].toUpperCase() + d.status.slice(1)}</Tag>
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
            <GuardedButtonV2 perm="verifyCollection" size="mini" variant="primary" disabled={busy} aria-label={`Verify pay-in ${d.referenceNumber}`} onClick={() => void verifyDeposit(d)}>Verify</GuardedButtonV2>
            <GuardedButtonV2 perm="verifyCollection" size="mini" disabled={busy} aria-label={`Reject pay-in ${d.referenceNumber}`} onClick={() => { setRejecting(d); setReason(''); setError(null); }}>Reject</GuardedButtonV2>
          </div>
        ) : null,
    },
  ];

  const skeleton = <div aria-busy="true" aria-label="Loading" style={{ padding: 20 }}><Skeleton height={40} /><Skeleton height={40} className="skelgap" /></div>;

  return (
    <>
      <Modal
        open={isOpen}
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
        {failed && !collections ? (
          <EmptyState title="This partner's cash could not load." action={<Button onClick={() => void load()}>Try again</Button>} />
        ) : tab === 'collections' ? (
          collections === null ? skeleton : collections.length === 0 ? (
            <EmptyState title="Nothing to verify" text={`${agentName} has no collections waiting.`} />
          ) : (
            <>
              <div className="agtools">
                <b className="mut">{selected.size > 0 ? `${selected.size} selected` : 'Select collections to verify them together (up to 50)'}</b>
                <GuardedButtonV2 perm="verifyCollection" variant="primary" disabled={selected.size === 0 || selected.size > 50 || busy} onClick={() => void verifySelected()}>
                  Verify selected{selected.size > 0 ? ` (${selected.size})` : ''}
                </GuardedButtonV2>
              </div>
              <Table label="Collections to verify" columns={collectionColumns} rows={paged} rowKey={(c) => c.id} />
              {collections.length > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={collections.length} noun="collections" onPageChange={setPage} />}
            </>
          )
        ) : deposits === null ? skeleton : deposits.length === 0 ? (
          <EmptyState title="No pay-ins" text={`${agentName} has not sent a pay-in yet.`} />
        ) : (
          <>
            <Table label="Pay-ins" columns={depositColumns} rows={deposits} rowKey={(d) => d.id} />
            {rejecting && (
              <form className="rejectbox" noValidate onSubmit={(e) => { e.preventDefault(); void reject(); }}>
                <Input label={`Why reject ${rejecting.referenceNumber}?`} value={reason} autoComplete="off" hint={`Required, at least ${MIN_REASON} characters.`} onChange={(e) => setReason(e.target.value)} />
                <div className="rowacts">
                  <Button onClick={() => setRejecting(null)}>Cancel</Button>
                  <Button variant="danger" disabled={reason.trim().length < MIN_REASON || busy} onClick={() => void reject()}>Reject pay-in</Button>
                </div>
              </form>
            )}
          </>
        )}
      </Modal>
      <Modal open={receipt !== null} onClose={() => setReceipt(null)} title="Receipt" footer={<Button onClick={() => setReceipt(null)}>Close</Button>}>
        {receipt && (isPdfUrl(receipt) ? <iframe title="Receipt PDF" src={receipt} style={{ width: '100%', height: '60vh', border: 0 }} /> : <img src={receipt} alt="Receipt" style={{ maxWidth: '100%' }} />)}
      </Modal>
    </>
  );
}
