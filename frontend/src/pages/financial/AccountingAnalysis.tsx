import React from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { GeneralLedgerTab } from '../../components/financial/gl/GeneralLedgerTab';
import { StatementsPanel } from './profit/StatementsPanel';
import { ProductProfitPanel } from './profit/ProductProfitPanel';
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
      content: <StatementsPanel />
    },
    {
      id: 'profitability',
      label: 'Profit by product',
      content: <ProductProfitPanel />
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
