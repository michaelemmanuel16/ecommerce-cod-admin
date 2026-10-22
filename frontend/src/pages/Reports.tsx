import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { useV2Page } from '../components/shell/useV2Page';
import { Tabs } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { AgentCards } from './reports/AgentCards';
import { DateCard } from './reports/DateCard';
import { DeliveryTab } from './reports/DeliveryTab';
import { ExportSlot } from './reports/ExportSlot';
import { rangeLabel } from './reports/format';
import { OverviewTab } from './reports/OverviewTab';
import { presetRange, type DayRange, type Preset } from './reports/range';
import { SalesTab } from './reports/SalesTab';
import { visibleTabs, type TabKey } from './reports/tabs';
import { TeamTab } from './reports/TeamTab';
import type { DeliveryReport, OverviewReport, SalesReport } from './reports/types';
import { useReport } from './reports/useReport';

/**
 * Reports (M3-T60, M3-T61, F-1050 to F-1053, F-1064), built from docs/mockups/v2/reports.html. The page holds the date
 * card, the compare switch and the tab bar; each tab asks for its own numbers (GET /api/reports/:tab) only while it is
 * open. The page does no KPI arithmetic: every figure, change and tag comes from the API.
 *
 * Not on the page yet: "Explain this month" (M11), the Team tab body and the Export menu (M3-T62), Products and profit
 * (M5) and Marketing (M8). The last two have a slot in tabs.ts and stay hidden.
 */
export function Reports() {
  useV2Page();
  const { user, can } = usePermissions();
  const [search, setSearch] = useSearchParams();
  const tabs = visibleTabs(user?.role, can);
  const tab: TabKey = tabs.find((t) => t.key === search.get('tab'))?.key ?? tabs[0]?.key ?? 'overview';

  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState<DayRange>(() => presetRange('month'));
  const [compare, setCompare] = useState(false);
  const range = preset === 'custom' ? custom : presetRange(preset);
  const params = { ...range, compare };

  const overview = useReport<OverviewReport>('overview', params, tab === 'overview');
  const sales = useReport<SalesReport>('sales', params, tab === 'sales');
  // the Delivery numbers also feed the card on top, so they load whatever the open tab is
  const delivery = useReport<DeliveryReport>('delivery', params, true);

  const open = (key: TabKey) => setSearch((prev) => { const next = new URLSearchParams(prev); next.set('tab', key); return next; }, { replace: true });
  const choosePreset = (next: Preset) => {
    // "Custom" starts from the days on screen
    if (next === 'custom') setCustom(range);
    setPreset(next);
  };

  const current = tab === 'overview' ? overview : tab === 'sales' ? sales : delivery;
  // the label comes from the answer (the server's days), until there is one from the days asked for
  const answered = (tab === 'team' ? delivery : current).data;
  const label = answered ? rangeLabel(answered.range.from, answered.range.to) : rangeLabel(range.from, range.to);
  const compareLabel = compare && answered?.compare ? `Previous period: ${rangeLabel(answered.compare.from, answered.compare.to)}` : null;
  const ctl = (r: { loading: boolean; failed: boolean; refetch: () => Promise<void> }) => ({ loading: r.loading, failed: r.failed, compare, onRetry: () => void r.refetch() });

  return (
    <section className={clsx('reports', current.loading && current.data && 'busy')}>
      <div className="head">
        <div>
          <h1>Reports</h1>
          <p>Sales, delivery and team numbers for the dates you pick.</p>
        </div>
        <div className="hd-actions"><ExportSlot /></div>
      </div>

      <DateCard
        preset={preset} range={range} onPreset={choosePreset} onCustom={setCustom}
        compare={compare} onCompare={setCompare} label={label} compareLabel={compareLabel}
      />
      {tab !== 'team' && current.failed && current.message && <p className="rangeerr" role="alert">{current.message}</p>}

      <AgentCards delivery={delivery.data} onOpenDelivery={() => open('delivery')} />

      <Tabs
        className="pgtabs" label="Reports" value={tab} onChange={(id) => open(id as TabKey)}
        items={tabs.map((t) => ({ id: t.key, label: <><t.icon />{t.label}</> }))}
      />

      <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label}>
        {tab === 'overview' && <OverviewTab report={overview.data} ctl={ctl(overview)} />}
        {tab === 'sales' && <SalesTab report={sales.data} ctl={ctl(sales)} />}
        {tab === 'delivery' && <DeliveryTab report={delivery.data} ctl={ctl(delivery)} />}
        {tab === 'team' && <TeamTab />}
      </div>
    </section>
  );
}
