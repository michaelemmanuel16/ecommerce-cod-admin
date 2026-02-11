import React from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { GeneralLedgerTab } from '../../components/financial/gl/GeneralLedgerTab';
import { FinancialStatementsTab } from '../../components/financial/FinancialStatementsTab';
import { ProfitabilityTab } from '../../components/financial/ProfitabilityTab';
import { ExpenseManagementTab } from '../../components/financial/ExpenseManagementTab';

export const AccountingAnalysis: React.FC = () => {
  const tabs = [
    {
      id: 'gl',
      label: 'General Ledger',
      content: <GeneralLedgerTab />
    },
    {
      id: 'statements',
      label: 'Financial Statements',
      content: <FinancialStatementsTab />
    },
    {
      id: 'profitability',
      label: 'Profitability Analysis',
      content: <ProfitabilityTab />
    },
    {
      id: 'expenses',
      label: 'Expense Management',
      content: <ExpenseManagementTab />
    }
  ];

  return (
    <div className="space-y-6">
      <Tabs tabs={tabs} defaultTab="gl" />
    </div>
  );
};
