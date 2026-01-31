import apiClient from './api';

export interface FinancialSummary {
  totalRevenue: number;
  totalExpenses: number;
  profit: number;
  codCollected: number;
  profitMargin: number;
}

export interface Transaction {
  id: string;
  type: string;
  status: string;
  amount: number;
  createdAt: string;
  order?: {
    orderNumber: string;
    customer?: {
      firstName: string;
      lastName: string;
    };
  };
}

export interface CODCollection {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  order?: {
    orderNumber: string;
    deliveryAgent?: {
      id: string;
      firstName: string;
      lastName: string;
    };
    customer?: {
      firstName: string;
      lastName: string;
    };
  };
}

export interface FinancialReport {
  date: string;
  revenue: number;
  expenses: number;
  profit: number;
  orders: number;
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  description: string;
  receiptUrl?: string;
  expenseDate: string;
  recordedBy?: {
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}

export interface ExpenseCategory {
  category: string;
  totalAmount: number;
  count: number;
}

export interface AgentCashHolding {
  agent: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
  };
  totalCollected: number;
  orderCount: number;
  oldestCollectionDate: string;
}

export interface PipelineRevenue {
  totalExpected: number;
  byStatus: {
    status: string;
    amount: number;
    count: number;
  }[];
}

export interface ProfitMargins {
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  profitMargin: number;
  orderCount: number;
}

export interface AgingSummary {
  totalAgentsWithBalance: number;
  totalOutstandingAmount: number;
  overdueAgentsCount: number;
  criticalOverdueAmount: number;
  warningOverdueAmount: number;
  blockedAgentsWithBalance: number;
  bucketTotals: {
    bucket_0_1: number;
    bucket_2_3: number;
    bucket_4_7: number;
    bucket_8_plus: number;
  };
}

export interface AgentAgingBucket {
  agent: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
  };
  totalBalance: number;
  oldestCollectionDate: string;
  bucket_0_1: number;
  bucket_2_3: number;
  bucket_4_7: number;
  bucket_8_plus: number;
  updatedAt: string;
}

export interface AgentAgingReport {
  summary: AgingSummary;
  buckets: AgentAgingBucket[];
}

export interface CollectionRecord {
  id: number;
  orderId: number;
  agentId: number;
  amount: number;
  status: 'draft' | 'reconciled';
  collectionDate: string;

  verifiedAt?: string;
  approvedAt?: string;
  order: {
    id: number;
    totalAmount: number;
    customer: {
      firstName: string;
      lastName: string;
    }
  }
}

export interface CashFlowKPI {
  cashInHand: number;
  cashInTransit: number;
  arAgents: number;
  cashExpected: number;
  totalCashPosition: number;
}

export interface CashFlowForecastPoint {
  date: string;
  expectedCollection: number;
  expectedExpense: number;
  projectedBalance: number;
}

export interface ProfitabilityAnalysis {
  summary: {
    totalRevenue: number;
    totalCOGS: number;
    totalShippingCost: number;
    totalDiscount: number;
    totalMarketingExpense: number;
    grossProfit: number;
    grossMargin: number;
    netProfit: number;
    netMargin: number;
    orderCount: number;
  };
  products: {
    id: number;
    name: string;
    sku: string;
    revenue: number;
    cogs: number;
    quantity: number;
    grossProfit: number;
    grossMargin: number;
  }[];
  daily: {
    date: string;
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMargin: number;
  }[];
}

export interface CashFlowReport {
  kpis: CashFlowKPI;
  forecast: CashFlowForecastPoint[];
  agentBreakdown: AgentCashHolding[];
}

export interface FinancialStatementAccount {
  id: number;
  code: string;
  name: string;
  balance: number;
}

export interface BalanceSheetData {
  asOfDate: string;
  assets: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  liabilities: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  equity: {
    accounts: FinancialStatementAccount[];
    retainedEarnings: number;
    total: number;
  };
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

export interface ProfitLossData {
  startDate: string;
  endDate: string;
  revenue: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  cogs: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  expenses: {
    accounts: FinancialStatementAccount[];
    total: number;
  };
  grossProfit: number;
  grossMarginPercentage: number;
  netIncome: number;
  netMarginPercentage: number;
}

export const financialService = {
  async getFinancialSummary(startDate?: string, endDate?: string): Promise<FinancialSummary> {
    const response = await apiClient.get('/api/financial/summary', {
      params: { startDate, endDate }
    });
    return response.data.summary;
  },

  async getTransactions(params?: {
    type?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ transactions: Transaction[]; pagination: any }> {
    const response = await apiClient.get('/api/financial/transactions', { params });
    return response.data;
  },

  async getCODCollections(params?: {
    agentId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ collections: CODCollection[]; pagination: any }> {
    const response = await apiClient.get('/api/financial/cod-collections', { params });
    return response.data;
  },

  async recordExpense(expense: {
    category: string;
    amount: number;
    description: string;
    expenseDate: string;
  }): Promise<any> {
    const response = await apiClient.post('/api/financial/expenses', expense);
    return response.data.expense;
  },

  async getFinancialReports(params?: {
    period?: 'daily' | 'monthly';
    startDate?: string;
    endDate?: string;
  }): Promise<FinancialReport[]> {
    const response = await apiClient.get('/api/financial/reports', { params });
    return response.data.reports;
  },

  async getExpenses(params?: {
    category?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<{ expenses: Expense[]; pagination: any }> {
    const response = await apiClient.get('/api/financial/expenses', { params });
    return response.data;
  },

  async getExpenseBreakdown(startDate?: string, endDate?: string): Promise<ExpenseCategory[]> {
    const response = await apiClient.get('/api/financial/expenses/breakdown', {
      params: { startDate, endDate }
    });
    return response.data.breakdown;
  },

  async updateExpense(
    id: string,
    data: {
      category?: string;
      amount?: number;
      description?: string;
      expenseDate?: string;
    }
  ): Promise<Expense> {
    const response = await apiClient.put(`/api/financial/expenses/${id}`, data);
    return response.data.expense;
  },

  async deleteExpense(id: string): Promise<void> {
    await apiClient.delete(`/api/financial/expenses/${id}`);
  },

  async getAgentCashHoldings(): Promise<AgentCashHolding[]> {
    const response = await apiClient.get('/api/financial/agent-cash-holdings');
    return response.data.holdings;
  },

  async getPipelineRevenue(startDate?: string, endDate?: string): Promise<PipelineRevenue> {
    const response = await apiClient.get('/api/financial/pipeline-revenue', {
      params: { startDate, endDate }
    });
    return response.data;
  },

  async getProfitMargins(startDate?: string, endDate?: string): Promise<ProfitMargins> {
    const response = await apiClient.get('/api/financial/profit-margins', {
      params: { startDate, endDate }
    });
    return response.data;
  },

  async getProfitabilityAnalysis(params: {
    startDate?: string;
    endDate?: string;
    productId?: number;
  }): Promise<ProfitabilityAnalysis> {
    const response = await apiClient.get('/api/financial/profitability', { params });
    return response.data;
  },

  async exportProfitability(params: {
    startDate?: string;
    endDate?: string;
    productId?: number;
    format: 'csv' | 'xlsx';
  }): Promise<any> {
    const response = await apiClient.get('/api/financial/profitability/export', {
      params,
      responseType: 'blob'
    });
    return response.data;
  },

  async markAsDeposited(transactionIds: string[], depositReference?: string): Promise<void> {
    await apiClient.post('/api/financial/collections/deposit', {
      transactionIds,
      depositReference
    });
  },

  async reconcileTransaction(
    id: string,
    data: {
      status: string;
      reference?: string;
      notes?: string;
    }
  ): Promise<void> {
    await apiClient.post(`/api/financial/transactions/${id}/reconcile`, data);
  },

  async getAgentSettlement(
    agentId: string,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    const response = await apiClient.get(`/api/financial/agents/settlement/${agentId}`, {
      params: { startDate, endDate }
    });
    return response.data;
  },

  async getAgentAging(): Promise<AgentAgingReport> {
    const response = await apiClient.get('/api/financial/agent-aging');
    return response.data;
  },

  async downloadAgentAgingCSV(): Promise<void> {
    const response = await apiClient.get('/api/financial/agent-aging/export/csv', {
      responseType: 'blob'
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `agent-aging-report-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  async getCashFlowReport(): Promise<CashFlowReport> {
    const response = await apiClient.get('/api/financial/cash-flow');
    return response.data;
  },

  async downloadCashFlowCSV(): Promise<void> {
    const response = await apiClient.get('/api/financial/cash-flow/export/csv', {
      responseType: 'blob'
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `cash_flow_report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  async getBalanceSheet(asOfDate?: string): Promise<BalanceSheetData> {
    const response = await apiClient.get('/api/financial/balance-sheet', {
      params: { asOfDate }
    });
    return response.data;
  },

  async getProfitLoss(startDate: string, endDate: string): Promise<ProfitLossData> {
    const response = await apiClient.get('/api/financial/profit-loss', {
      params: { startDate, endDate }
    });
    return response.data;
  },

  // General Ledger Methods
  async getAllGLAccounts(params?: {
    accountType?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ accounts: any[]; pagination: any }> {
    const response = await apiClient.get('/api/gl/accounts', { params });
    return response.data;
  },

  async getAccountLedger(accountId: number, params?: {
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<any> {
    const response = await apiClient.get(`/api/gl/accounts/${accountId}/ledger`, { params });
    return response.data;
  },

  async recordJournalEntry(entry: any): Promise<any> {
    const response = await apiClient.post('/api/gl/journal-entries', entry);
    return response.data.entry;
  },

  async getAccountLedgerExport(accountId: number, params: { startDate?: string; endDate?: string }): Promise<any> {
    const response = await apiClient.get(`/api/gl/accounts/${accountId}/ledger/export`, {
      params,
      responseType: 'blob'
    });
    return response.data;
  },

  // Agent Reconciliation Methods
  async getAgentCollections(agentId: number, params?: { status?: string }): Promise<CollectionRecord[]> {
    const response = await apiClient.get('/api/agent-reconciliation', {
      params: { agentId, ...params }
    });
    return response.data;
  },

  async verifyCollection(collectionId: number): Promise<void> {
    await apiClient.post(`/api/agent-reconciliation/${collectionId}/verify`);
  },

  async approveCollection(collectionId: number): Promise<void> {
    await apiClient.post(`/api/agent-reconciliation/${collectionId}/approve`);
  },

  async bulkVerifyCollections(ids: number[]): Promise<void> {
    await apiClient.post('/api/agent-reconciliation/bulk-verify', { ids });
  }
};
