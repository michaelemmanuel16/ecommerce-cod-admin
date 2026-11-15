import { useCallback, useEffect, useRef, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Button, EmptyState, Skeleton, Table, Tag, type TagTone } from '../../components/ui-v2';
import { communicationService, type EmailCampaign } from '../../services/communication.service';
import { countText, stamp } from './format';

const STATUS: Record<EmailCampaign['status'], { label: string; tone: TagTone }> = {
  queued: { label: 'Queued', tone: 'n' },
  sending: { label: 'Sending', tone: 'warn' },
  completed: { label: 'Done', tone: 'ok' },
};
const POLL_MS = 4000;

/** Campaign history (read only): one row per campaign with its delivery breakdown. A campaign still sending refreshes itself. */
export function CampaignsTab() {
  const [rows, setRows] = useState<EmailCampaign[] | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const data = await communicationService.getCampaigns();
      setRows(data);
      setFailed(false);
      // keep polling while a campaign is still draining its queue
      if (data.some((c) => c.status === 'queued' || c.status === 'sending')) timer.current = setTimeout(() => void load(), POLL_MS);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => clearTimeout(timer.current);
  }, [load]);

  if (failed && rows === null) return <EmptyState icon={<Megaphone />} title="Campaigns did not load" action={<Button onClick={() => void load()}>Try again</Button>} />;
  if (rows === null) return <div className="pad" aria-busy="true"><Skeleton height={120} /></div>;
  if (rows.length === 0) return <EmptyState icon={<Megaphone />} title="No campaigns yet" text="A campaign you send shows here with how many messages went out." />;

  return (
    <div role="tabpanel" aria-label="Campaigns">
      <Table
        label="Campaigns" className="ctab" rowKey={(c) => c.id} rows={rows}
        columns={[
          { key: 'name', header: 'Campaign', render: (c) => <><b>{c.title}</b><span className="pct">{c.subject}</span></> },
          { key: 'status', header: 'Status', render: (c) => <Tag tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Tag> },
          { key: 'date', header: 'Date', render: (c) => stamp(c.createdAt) },
          { key: 'audience', header: 'Audience', right: true, render: (c) => countText(c.stats.audienceTotal) },
          { key: 'sent', header: 'Sent', right: true, render: (c) => countText(c.stats.sent) },
          { key: 'delivered', header: 'Delivered', right: true, render: (c) => countText(c.stats.delivered) },
          { key: 'failed', header: 'Failed', right: true, render: (c) => countText(c.stats.failed) },
          // no address and opted out are skips, never failures
          { key: 'skipped', header: 'Skipped', right: true, render: (c) => <span title={`${c.stats.noEmail} no address, ${c.stats.optedOut} opted out`}>{countText(c.stats.noEmail + c.stats.optedOut + c.stats.skipped)}</span> },
        ]}
      />
    </div>
  );
}
