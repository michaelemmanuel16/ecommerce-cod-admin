import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, List } from 'lucide-react';
import { BlockError } from '../dashboard/blocks/Frame';
import { EmptyState, Pagination, Select, Skeleton, Table, Tag } from '../../components/ui-v2';
import { messagesService } from '../../services/messages.service';
import { formatStamp } from '../../utils/format';
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_TONE, clipReason } from './format';
import { datesFor, isLogRangeKey, LOG_RANGES, type LogRangeKey } from './range';
import { useLoad } from './useLoad';
import type { Channel, LogRow, LogStatus } from './types';

const PAGE = 50;
const STATUSES: LogStatus[] = ['sent', 'delivered', 'read', 'replied', 'failed', 'skipped', 'pending'];
const isStatus = (v: string | null): v is LogStatus => STATUSES.includes(v as LogStatus);
const isChannel = (v: string | null): v is Channel => v === 'whatsapp' || v === 'sms' || v === 'email';

/**
 * The message log: every message under the filters, newest first, 50 to a page. The count is `total` from the API, the
 * same definition as the Overview tile of that status, range and channel.
 */
export function LogTab() {
  const [params] = useSearchParams();
  // A tile on the Overview opens the log with its status, range and channel in the address
  const [channel, setChannel] = useState<Channel | ''>(() => (isChannel(params.get('channel')) ? (params.get('channel') as Channel) : ''));
  const [status, setStatus] = useState<LogStatus | ''>(() => (isStatus(params.get('status')) ? (params.get('status') as LogStatus) : ''));
  const [range, setRange] = useState<LogRangeKey>(() => (isLogRangeKey(params.get('range')) ? (params.get('range') as LogRangeKey) : 'any'));
  const [search, setSearch] = useState('');
  const [recipient, setRecipient] = useState('');
  // Cursors of the pages already seen: cursors[0] is page 1 (none)
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const page = cursors.length;

  useEffect(() => { const t = setTimeout(() => setRecipient(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  // A new filter starts again at page 1
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setCursors([undefined]);
  }, [channel, status, range, recipient]);

  const dates = datesFor(range);
  const cursor = cursors[cursors.length - 1];
  const data = useLoad(
    () => messagesService.log({ ...dates, ...(channel && { channel }), ...(status && { status }), ...(recipient && { recipient }), ...(cursor && { cursor }), limit: PAGE }),
    `${channel}|${status}|${range}|${recipient}|${cursor ?? ''}`,
  );
  const filtered = !!(channel || status || recipient || range !== 'any');

  const go = (next: number) => {
    if (next > page && data.data?.nextCursor) setCursors((c) => [...c, data.data!.nextCursor!]);
    else if (next < page) setCursors((c) => c.slice(0, next));
  };

  return (
    <div role="tabpanel" aria-label="Message log" className={data.loading && data.data ? 'busy' : undefined}>
      <div className="bar2">
        <label className="srch">
          <Search />
          <input type="search" aria-label="Search by phone or name" placeholder="Search by phone or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Select compact label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')}>
          <option value="">All channels</option>
          {(['whatsapp', 'sms', 'email'] as const).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </Select>
        <Select compact label="Status" value={status} onChange={(e) => setStatus(e.target.value as LogStatus | '')}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Select compact label="Date range" value={range} onChange={(e) => setRange(e.target.value as LogRangeKey)}>
          {LOG_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
      </div>

      {data.failed && !data.data ? (
        <div className="pad"><BlockError bare name="Message log" onRetry={() => void data.reload()} /></div>
      ) : !data.data ? (
        <div className="pad" aria-busy="true"><Skeleton height={200} /></div>
      ) : data.data.items.length === 0 ? (
        <EmptyState
          icon={<List />} title={filtered ? 'No message matches these filters' : 'No messages yet'}
          text={filtered ? 'Change a filter to see more.' : 'Messages you send customers show here.'}
        />
      ) : (
        <>
          <Table<LogRow>
            label="Message log" className="otab" rowKey={(r) => r.id} rows={data.data.items}
            columns={[
              { key: 'at', header: 'Date', render: (r) => formatStamp(r.at) },
              { key: 'channel', header: 'Channel', render: (r) => CHANNEL_LABEL[r.channel] },
              {
                key: 'to', header: 'Customer',
                render: (r) => (
                  <>
                    {r.customer ? <Link className="lnk" to={`/customers/${r.customer.id}`}>{r.customer.name}</Link> : <b>Unknown customer</b>}
                    {r.recipient && <span className="pct">{r.recipient}</span>}
                  </>
                ),
              },
              { key: 'tpl', header: 'Template', render: (r) => r.templateName ?? '-' },
              {
                key: 'status', header: 'Status',
                render: (r) => <><Tag tone={STATUS_TONE[r.status] ?? 'n'}>{STATUS_LABEL[r.status]}</Tag>{r.status === 'failed' && r.errorMessage && <span className="pct err" title={r.errorMessage}>{clipReason(r.errorMessage)}</span>}</>,
              },
              { key: 'order', header: 'Order', render: (r) => (r.order ? <Link className="lnk" to={`/orders/${r.order.id}`}>#{r.order.id}</Link> : '-') },
            ]}
          />
          <Pagination page={page} pageSize={PAGE} total={data.data.total} noun="messages" onPageChange={go} />
        </>
      )}
    </div>
  );
}
