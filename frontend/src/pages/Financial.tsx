import React, { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, TrendingDown, Wallet, Receipt, Filter } from 'lucide-react';
import { useFinancialStore } from '../stores/financialStore';
import { Card } from '../components/ui/Card';
import { FinancialSummarySkeleton, TransactionTableSkeleton } from '../components/ui/PageSkeletons';

export const Financial: React.FC = () => {
  const {
    summary,
    transactions,
    codCollections,
    isLoading,
    fetchSummary,
    fetchTransactions,
    fetchCODCollections
  } = useFinancialStore();
  const [activeTab, setActiveTab] = useState<'transactions' | 'cod'>('transactions');

  useEffect(() => {
    const loadFinancialData = async () => {
      await Promise.all([
        fetchSummary(),
        fetchTransactions({ limit: 10 }),
        fetchCODCollections({ limit: 10 })
      ]);
    };
    loadFinancialData();
  }, [fetchSummary, fetchTransactions, fetchCODCollections]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'collected':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Financial Overview</h1>
        <button className="flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Filter className="w-4 h-4 mr-2" />
          Filter
        </button>
      </div>

      {isLoading ? (
        <>
          <FinancialSummarySkeleton />
          <Card className="mt-6">
            <div className="p-6">
              <TransactionTableSkeleton />
            </div>
          </Card>
        </>
      ) : (
        <>
          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              {/* Total Revenue */}
              <Card className="hover:shadow-lg transition-shadow">
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Total Revenue</p>
                      <p className="text-2xl font-bold text-gray-900 mt-2">
                        {formatCurrency(summary.totalRevenue)}
                      </p>
                    </div>
                    <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                      <DollarSign className="w-6 h-6 text-green-600" />
                    </div>
                  </div>
                </div>
              </Card>

              {/* Total Expenses */}
              <Card className="hover:shadow-lg transition-shadow">
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Total Expenses</p>
                      <p className="text-2xl font-bold text-gray-900 mt-2">
                        {formatCurrency(summary.totalExpenses)}
                      </p>
                    </div>
                    <div className="h-12 w-12 bg-red-100 rounded-full flex items-center justify-center">
                      <TrendingDown className="w-6 h-6 text-red-600" />
                    </div>
                  </div>
                </div>
              </Card>

              {/* Net Profit */}
              <Card className="hover:shadow-lg transition-shadow">
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Net Profit</p>
                      <p className={`text-2xl font-bold mt-2 ${summary.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(summary.profit)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Margin: {summary.profitMargin.toFixed(1)}%
                      </p>
                    </div>
                    <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                      summary.profit >= 0 ? 'bg-blue-100' : 'bg-red-100'
                    }`}>
                      <TrendingUp className={`w-6 h-6 ${summary.profit >= 0 ? 'text-blue-600' : 'text-red-600'}`} />
                    </div>
                  </div>
                </div>
              </Card>

              {/* COD Collected */}
              <Card className="hover:shadow-lg transition-shadow">
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">COD Collected</p>
                      <p className="text-2xl font-bold text-gray-900 mt-2">
                        {formatCurrency(summary.codCollected)}
                      </p>
                    </div>
                    <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center">
                      <Wallet className="w-6 h-6 text-purple-600" />
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Tabs */}
          <Card className="mb-6">
            <div className="border-b border-gray-200">
              <div className="flex space-x-8 px-6">
                <button
                  onClick={() => setActiveTab('transactions')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === 'transactions'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center">
                    <Receipt className="w-4 h-4 mr-2" />
                    All Transactions
                  </div>
                </button>
                <button
                  onClick={() => setActiveTab('cod')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === 'cod'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center">
                    <Wallet className="w-4 h-4 mr-2" />
                    COD Collections
                  </div>
                </button>
              </div>
            </div>

            <div className="p-6">
              {activeTab === 'transactions' ? (
                <div className="overflow-x-auto">
                  {transactions.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No transactions yet</p>
                  ) : (
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Order
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Customer
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Type
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Amount
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Date
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {transactions.map((transaction) => (
                          <tr key={transaction.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {transaction.order?.orderNumber || 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {transaction.order?.customer
                                ? `${transaction.order.customer.firstName} ${transaction.order.customer.lastName}`
                                : 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {transaction.type.replace('_', ' ').toUpperCase()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                              {formatCurrency(transaction.amount)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(transaction.status)}`}>
                                {transaction.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(transaction.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  {codCollections.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No COD collections yet</p>
                  ) : (
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Order
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Customer
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Delivery Agent
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Amount
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Date
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {codCollections.map((collection) => (
                          <tr key={collection.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {collection.order?.orderNumber || 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {collection.order?.customer
                                ? `${collection.order.customer.firstName} ${collection.order.customer.lastName}`
                                : 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {collection.order?.deliveryAgent
                                ? `${collection.order.deliveryAgent.firstName} ${collection.order.deliveryAgent.lastName}`
                                : 'Unassigned'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                              {formatCurrency(collection.amount)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(collection.status)}`}>
                                {collection.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(collection.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
