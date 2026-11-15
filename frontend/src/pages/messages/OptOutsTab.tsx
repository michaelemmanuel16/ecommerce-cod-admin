import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, UserX } from 'lucide-react';
import { BlockError } from '../dashboard/blocks/Frame';
import { Button, ConfirmDialog, EmptyState, Input, Modal, Pagination, Select, Skeleton, Table, Tag, useToast } from '../../components/ui-v2';
import { messagesService } from '../../services/messages.service';
import { apiMessage } from '../orders/importText';
import { formatNumber, formatStamp } from '../../utils/format';
import { CHANNEL_LABEL } from './format';
import { useLoad } from './useLoad';
import type { Channel, OptOutRow } from './types';

const PAGE = 50;
const REASON: Record<string, string> = {
  stop_reply: 'Replied STOP',
  unsubscribe_link: 'Unsubscribe link',
  staff: 'Added by staff',
  import: 'Imported',
};

/**
 * Opt-outs (M9-T35): everyone you may not message, one row for each channel. Add and remove go through
 * PUT /api/messages/opt-outs, which writes an event for every change. Owner and admin change the list; a manager reads it.
 */
export function OptOutsTab({ canWrite }: { canWrite: boolean }) {
  const say = useToast();
  const [channel, setChannel] = useState<Channel | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OptOutRow | null>(null);

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setPage(1); }, [channel, q]);

  const data = useLoad(() => messagesService.listOptOuts({ ...(channel && { channel }), ...(q && { q }), page, limit: PAGE }), `${channel}|${q}|${page}`);
  const filtered = !!(channel || q);

  const remove = async () => {
    if (!removing) return;
    const row = removing;
    try {
      await messagesService.setOptOut({ channel: row.channel, optedOut: false, ...(row.channel === 'email' ? { email: row.email ?? '' } : { phone: row.phone ?? '' }) });
      setRemoving(null);
      say(`${row.name ?? row.phone ?? row.email} can get ${CHANNEL_LABEL[row.channel]} messages again`);
      void data.reload();
    } catch (err) {
      setRemoving(null);
      say(await apiMessage(err, 'The opt-out was not removed'));
    }
  };

  return (
    <div role="tabpanel" aria-label="Opt-outs" className={data.loading && data.data ? 'busy' : undefined}>
      <div className="bar2">
        <label className="srch">
          <Search />
          <input type="search" aria-label="Search opt-outs" placeholder="Search by name, phone or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Select compact label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')}>
          <option value="">All channels</option>
          {(['sms', 'whatsapp', 'email'] as const).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </Select>
        {data.data && <span className="ink3 note">{formatNumber(data.data.total)} opted out. We never send to them on that channel.</span>}
        {canWrite && <span className="rt"><Button variant="primary" onClick={() => setAdding(true)}><Plus style={{ width: 15, height: 15 }} />Add opt-out</Button></span>}
      </div>

      {data.failed && !data.data ? (
        <div className="pad"><BlockError bare name="Opt-outs" onRetry={() => void data.reload()} /></div>
      ) : !data.data ? (
        <div className="pad" aria-busy="true"><Skeleton height={200} /></div>
      ) : data.data.items.length === 0 ? (
        <EmptyState
          icon={<UserX />} title={filtered ? 'No opt-out matches these filters' : 'Nobody has opted out'}
          text={filtered ? 'Change a filter to see more.' : 'Customers who reply STOP or use the unsubscribe link show here.'}
        />
      ) : (
        <>
          <Table<OptOutRow>
            label="Opt-outs" className="otab" rowKey={(r) => r.key} rows={data.data.items}
            columns={[
              {
                key: 'who', header: 'Customer',
                render: (r) => (
                  <>
                    {r.customerId ? <Link className="lnk" to={`/customers/${r.customerId}`}>{r.name}</Link> : <b>Not a customer</b>}
                    <span className="pct">{r.channel === 'email' ? r.email : r.phone}</span>
                  </>
                ),
              },
              { key: 'channel', header: 'Channel', render: (r) => <Tag tone="n">{CHANNEL_LABEL[r.channel]}</Tag> },
              { key: 'area', header: 'City', render: (r) => r.area ?? '-' },
              { key: 'since', header: 'Opted out', render: (r) => (r.since ? formatStamp(r.since) : '-') },
              { key: 'reason', header: 'Reason', render: (r) => (r.reason ? REASON[r.reason] ?? r.reason : '-') },
              ...(canWrite ? [{
                key: 'act', header: 'Actions', right: true,
                render: (r: OptOutRow) => <Button size="mini" aria-label={`Remove opt-out of ${r.name ?? r.phone ?? r.email} on ${CHANNEL_LABEL[r.channel]}`} onClick={() => setRemoving(r)}>Remove</Button>,
              }] : []),
            ]}
          />
          <Pagination page={page} pageSize={PAGE} total={data.data.total} noun="opt-outs" onPageChange={setPage} />
        </>
      )}

      {adding && <AddModal onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void data.reload(); }} />}
      <ConfirmDialog
        open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => void remove()} action="Remove" count={1} noun="opt-out"
        title={removing ? `Message ${removing.name ?? removing.phone ?? removing.email} on ${CHANNEL_LABEL[removing.channel]} again?` : undefined}
      >
        They asked us to stop. Only remove this if they asked to get messages again.
      </ConfirmDialog>
    </div>
  );
}

function AddModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const say = useToast();
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await messagesService.setOptOut({ channel, optedOut: true, phone: phone.trim() });
      say(`${phone.trim()} will not get ${CHANNEL_LABEL[channel]} messages`);
      onAdded();
    } catch (err) {
      setError(await apiMessage(err, 'The opt-out was not added'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open onClose={onClose} title="Add an opt-out" description="Use this for someone who asked you to stop. If they are a customer, their profile changes too."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving || !phone.trim()} onClick={() => void save()}>{saving ? 'Saving' : 'Add opt-out'}</Button></>}
    >
      <div className="fld">
        <span className="lab" id="opt-ch">Channel</span>
        <div className="seg" role="group" aria-labelledby="opt-ch">
          {(['sms', 'whatsapp'] as const).map((c) => (
            <button key={c} type="button" className={channel === c ? 'on' : undefined} aria-pressed={channel === c} onClick={() => setChannel(c)}>{CHANNEL_LABEL[c]}</button>
          ))}
        </div>
      </div>
      <div className="fld">
        <Input label="Phone number" type="tel" placeholder="024 555 0182" value={phone} onChange={(e) => setPhone(e.target.value)} error={error ?? undefined} />
      </div>
    </Modal>
  );
}
