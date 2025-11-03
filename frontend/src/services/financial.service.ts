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
  }
};
