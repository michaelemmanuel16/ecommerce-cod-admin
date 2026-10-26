import React from 'react';
import { useFinancialStore } from '../stores/financialStore';
import { Tabs } from '../components/ui/Tabs';
import { DateRangePicker } from '../components/ui/DateRangePicker';
import { FinancialDashboard } from './financial/FinancialDashboard';
import { AgentCollections } from './financial/AgentCollections';
import { AccountingAnalysis } from './financial/AccountingAnalysis';
import { RepCommissions } from './financial/RepCommissions';
import { OverviewProfitCards } from './financial/profit/OverviewProfitCards';
import { CashFlowPanel } from './financial/cash/CashFlowPanel';
import { ExportMenu } from './financial/cash/ExportMenu';
import { usePermissions } from '../hooks/usePermissions';
import { useV2Page } from '../components/shell/useV2Page';

export const Financial: React.FC = () => {
  // v2 tokens, so the page follows the light and dark theme (the Agent collections tab is v2)
  useV2Page();
  const { dateRange, setDateRange } = useFinancialStore();
  const { can } = usePermissions();

  const handleDateRangeChange = (startDate: string | undefined, endDate: string | undefined) => {
    setDateRange(startDate, endDate);
  };

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: <><FinancialDashboard /><div className="mt-12"><OverviewProfitCards /></div></>
    },
    {
      id: 'agent-collections',
      label: 'Agent Collections',
      content: <AgentCollections />
    },
    // F-914: the Rep commissions tab shows for roles that can view payouts
    ...(can('payouts', 'view') ? [{ id: 'rep-commissions', label: 'Rep commissions', content: <RepCommissions /> }] : []),
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
    <div>
      <div className="head">
        <div>
          <h1>Financial Management</h1>
          <p>Track revenue, expenses, COD collections, and agent accountability</p>
        </div>
        <div className="finhead">
          <ExportMenu />
          <DateRangePicker
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            onChange={handleDateRangeChange}
            placeholder="Select date range"
          />
        </div>
      </div>

      <Tabs tabs={tabs} defaultTab="overview" persistKey="financial-tab" compact />
    </div>
  );
};
