import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Megaphone } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { communicationService, EmailCampaign } from '../../services/communication.service';

const STATUS_VARIANT: Record<EmailCampaign['status'], 'warning' | 'secondary' | 'success'> = {
  queued: 'secondary',
  sending: 'warning',
  completed: 'success',
};

export const CampaignHistoryTab: React.FC = () => {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try {
      const data = await communicationService.getCampaigns();
      setCampaigns(data);
      // Keep polling while any campaign is still draining its queue (D-H1).
      if (data.some((c) => c.status === 'queued' || c.status === 'sending')) {
        timer.current = setTimeout(load, 4000);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  if (isLoading) {
    return <div className="py-12 text-center text-gray-500">Loading…</div>;
  }

  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No campaigns yet"
        description="Email campaigns you send from Bulk Send → Email appear here with delivery breakdowns."
      />
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Campaign', 'Status', 'Audience', 'Emailable', 'Waiting', 'Sent', 'Delivered', 'Failed', 'Skipped'].map(
                (h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {campaigns.map((c) => {
              const s = c.stats;
              // no-address + opted-out are neutral skips, never failures (D-CRIT).
              const skipped = s.noEmail + s.optedOut + s.skipped;
              return (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{c.title}</div>
                    <div className="text-xs text-gray-400 truncate max-w-[16rem]">{c.subject}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{s.audienceTotal}</td>
                  <td className="px-3 py-2 text-gray-700">{s.emailable}</td>
                  <td className="px-3 py-2 text-gray-500">{s.waiting}</td>
                  <td className="px-3 py-2 text-gray-700">{s.sent}</td>
                  <td className="px-3 py-2 text-green-700">{s.delivered}</td>
                  <td className={`px-3 py-2 ${s.failed > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                    {s.failed}
                  </td>
                  <td className="px-3 py-2 text-gray-500" title={`${s.noEmail} no address · ${s.optedOut} opted out`}>
                    {skipped}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
