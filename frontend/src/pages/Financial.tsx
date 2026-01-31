import React from 'react';
import { useFinancialStore } from '../stores/financialStore';
import { Tabs } from '../components/ui/Tabs';
import { DateRangePicker } from '../components/ui/DateRangePicker';
import { FinancialDashboard } from './financial/FinancialDashboard';
import { AgentCollections } from './financial/AgentCollections';
import { AccountingAnalysis } from './financial/AccountingAnalysis';

export const Financial: React.FC = () => {
  const { dateRange, setDateRange } = useFinancialStore();

  const handleDateRangeChange = (startDate: string | undefined, endDate: string | undefined) => {
    setDateRange(startDate, endDate);
  };

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: <FinancialDashboard />
    },
    {
      id: 'agent-collections',
      label: 'Agent Collections',
      content: <AgentCollections />
    },
    {
      id: 'accounting-analysis',
      label: 'Accounting & Analysis',
      content: <AccountingAnalysis />
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
