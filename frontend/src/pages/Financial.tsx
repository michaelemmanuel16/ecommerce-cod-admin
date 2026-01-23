import React, { useEffect } from 'react';
import { useFinancialStore } from '../stores/financialStore';
import { Tabs } from '../components/ui/Tabs';
import { DateRangePicker } from '../components/ui/DateRangePicker';
import { OverviewTab } from '../components/financial/OverviewTab';
import { CashFlowTab } from '../components/financial/CashFlowTab';
import { AgentReconciliationTab } from '../components/financial/AgentReconciliationTab';
import { AgentAgingTab } from '../components/financial/AgentAgingTab';
import { ExpenseManagementTab } from '../components/financial/ExpenseManagementTab';
import { ReportsTab } from '../components/financial/ReportsTab';
import { ProfitabilityTab } from '../components/financial/ProfitabilityTab';

export const Financial: React.FC = () => {
  const { dateRange, setDateRange } = useFinancialStore();

  const handleDateRangeChange = (startDate: string | undefined, endDate: string | undefined) => {
    setDateRange(startDate, endDate);
  };

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: <OverviewTab />
    },
    {
      id: 'cash-flow',
      label: 'Cash Flow',
      content: <CashFlowTab />
    },
    {
      id: 'agent-reconciliation',
      label: 'Agent Reconciliation',
      content: <AgentReconciliationTab />
    },
    {
      id: 'agent-aging',
      label: 'Agent Aging',
      content: <AgentAgingTab />
    },
    {
      id: 'expense-management',
      label: 'Expense Management',
      content: <ExpenseManagementTab />
    },
    {
      id: 'reports',
      label: 'Reports & Analytics',
      content: <ReportsTab />
    },
    {
      id: 'profitability',
      label: 'Profitability Analysis',
      content: <ProfitabilityTab />
    }
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Financial Management</h1>
          <p className="text-sm text-gray-600 mt-1">
            Track revenue, expenses, COD collections, and agent accountability
          </p>
        </div>
        <DateRangePicker
          startDate={dateRange.startDate}
          endDate={dateRange.endDate}
          onChange={handleDateRangeChange}
          placeholder="Select date range"
        />
      </div>

      <Tabs tabs={tabs} defaultTab="overview" />
    </div>
  );
};
