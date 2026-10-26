import React from 'react';
import { useFinancialStore } from '../stores/financialStore';
import { Tabs } from '../components/ui/Tabs';
import { DateRangePicker } from '../components/ui/DateRangePicker';
import { FinanceOverview } from './financial/overview/FinanceOverview';
import { AgentCollections } from './financial/AgentCollections';
import { AccountingAnalysis } from './financial/AccountingAnalysis';
import { RepCommissions } from './financial/RepCommissions';
import { OverviewProfitCards } from './financial/profit/OverviewProfitCards';
import { CashFlowPanel } from './financial/cash/CashFlowPanel';
import { ExportMenu } from './financial/cash/ExportMenu';
import { usePermissions } from '../hooks/usePermissions';
import { useV2Page } from '../components/shell/useV2Page';

export const Financial: React.FC = () => {
  const { dateRange, setDateRange } = useFinancialStore();
  const { can } = usePermissions();
  useV2Page();

  const handleDateRangeChange = (startDate: string | undefined, endDate: string | undefined) => {
    setDateRange(startDate, endDate);
  };

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: <><FinanceOverview /><div className="mt-4"><OverviewProfitCards /></div></>
    },
    {
      id: 'agent-collections',
      label: 'Agent Collections',
      content: <div className="legacy-light"><AgentCollections /></div>
    },
    // F-914: the Rep commissions tab shows for roles that can view payouts
    ...(can('payouts', 'view') ? [{ id: 'rep-commissions', label: 'Rep commissions', content: <div className="legacy-light"><RepCommissions /></div> }] : []),
    {
      id: 'accounting-analysis',
      label: 'Accounting & Analysis',
      content: <AccountingAnalysis />
    },
    {
      id: 'cash-flow',
      label: 'Cash-flow forecast',
      content: <CashFlowPanel />
    }
  ];

  return (
    <section className="finance">
      <div className="head">
        <div>
          <h1>Finance</h1>
          <p>Cash and profit, payouts from delivery partners, and the books.</p>
        </div>
        <div className="finhead">
          <ExportMenu />
          <div className="legacy-light">
            <DateRangePicker
              startDate={dateRange.startDate}
              endDate={dateRange.endDate}
              onChange={handleDateRangeChange}
              placeholder="Select date range"
            />
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} defaultTab="overview" persistKey="financial-tab" compact />
    </section>
  );
};
