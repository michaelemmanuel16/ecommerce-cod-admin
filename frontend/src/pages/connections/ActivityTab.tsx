import { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { Button, Card, EmptyState, Skeleton, Table, Tabs, Tag, type Column } from '../../components/ui-v2';
import { connectionsService, type ActivityItem, type ActivityTab as Level } from '../../services/connections.service';
import { apiErrorMessage } from '../../utils/apiError';

const CONNECTION_NAMES: Record<string, string> = {
  sms: 'Arkesel SMS', whatsapp: 'WhatsApp Business', email: 'Email', paystack: 'Paystack',
  meta: 'Meta Ads', checkout: 'Checkout', webhook: 'Webhook', csv: 'CSV upload',
};

const LEVELS = {
  error: { tone: 'bad', label: 'Failed' },
  warning: { tone: 'warn', label: 'Warning' },
  info: { tone: 'ok', label: 'Done' },
} as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Activity log (M9-T45, F-1213): connection problems of the last 90 days, newest first, with the tab counts from the API. */
export function ActivityTab() {
  const [level, setLevel] = useState<Level>('all');
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [counts, setCounts] = useState<{ all: number; error: number; warning: number } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(async (l: Level) => {
    setItems(null);
    try {
      const page = await connectionsService.getActivity(l);
      setItems(page.items);
      setCounts(page.counts);
      setCursor(page.nextCursor);
      setFailed(null);
    } catch (e) {
      setFailed(apiErrorMessage(e, 'The activity could not load.'));
    }
  }, []);

  useEffect(() => { void load(level); }, [level, load]);

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    try {
      const page = await connectionsService.getActivity(level, cursor);
      setItems((cur) => [...(cur ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setFailed(apiErrorMessage(e, 'More activity could not load.'));
    } finally {
      setMore(false);
    }
  };

  const columns: Column<ActivityItem>[] = [
    { key: 'at', header: 'Time', render: (r) => when(r.at) },
    { key: 'conn', header: 'Connection', render: (r) => <b>{CONNECTION_NAMES[r.connection] ?? r.connection}</b> },
    { key: 'level', header: 'Level', render: (r) => <Tag tone={LEVELS[r.level].tone}>{LEVELS[r.level].label}</Tag> },
    { key: 'msg', header: 'What happened', render: (r) => r.message },
  ];

  return (
    <Card title="Activity" aside="Last 90 days">
      <Tabs
        label="Activity filter" value={level} onChange={(id) => setLevel(id as Level)}
        items={[
          { id: 'all', label: 'All', count: counts?.all ?? 0 },
          { id: 'error', label: 'Failed', count: counts?.error ?? 0 },
          { id: 'warning', label: 'Warnings', count: counts?.warning ?? 0 },
        ]}
      />
      {failed ? (
        <div className="opserr" role="alert">{failed} <Button size="mini" onClick={() => load(level)}>Retry</Button></div>
      ) : items === null ? (
        <div style={{ padding: 20 }}><Skeleton height={120} /></div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Activity />} title={level === 'all' ? 'Nothing yet' : level === 'error' ? 'No failures' : 'No warnings'}
          text="Problems with your connections show here when they happen."
        />
      ) : (
        <>
          <Table label="Connection activity" className="lg" columns={columns} rows={items} rowKey={(r) => r.id} />
          {cursor && <div className="more"><Button onClick={loadMore} disabled={more}>{more ? 'Loading...' : 'Show more'}</Button></div>}
        </>
      )}
    </Card>
  );
}
