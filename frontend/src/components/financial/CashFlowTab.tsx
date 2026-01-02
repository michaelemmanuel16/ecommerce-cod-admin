import React, { useEffect, useState, useMemo } from 'react';
import { useFinancialStore } from '../../stores/financialStore';
import { StatusPipelineCard } from './cards/StatusPipelineCard';
import { CollectionsTimelineChart } from './charts/CollectionsTimelineChart';
import { Card } from '../ui/Card';
import { Filter, CheckSquare } from 'lucide-react';

export const CashFlowTab: React.FC = () => {
  const {
    codCollections,
    dateRange,
    loadingStates,
    fetchCODCollections,
    markAsDeposited
  } = useFinancialStore();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    fetchCODCollections({ status: statusFilter || undefined });
  }, [statusFilter, dateRange.startDate, dateRange.endDate]);

  // Calculate status totals
  const statusTotals = useMemo(() => {
    const totals = {
      pending: { count: 0, amount: 0 },
      collected: { count: 0, amount: 0 },
      deposited: { count: 0, amount: 0 },
      reconciled: { count: 0, amount: 0 }
    };

    codCollections.forEach((collection) => {
      const status = collection.status as keyof typeof totals;
      if (totals[status]) {
        totals[status].count += 1;
        totals[status].amount += collection.amount;
      }
    });

    return totals;
  }, [codCollections]);

  const handleSelectAll = () => {
    if (selectedIds.length === codCollections.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(codCollections.map(c => c.id));
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const handleMarkAsDeposited = async () => {
    if (selectedIds.length === 0) return;

    try {
      const reference = prompt('Enter deposit reference number (optional):');
      await markAsDeposited(selectedIds, reference || undefined);
      setSelectedIds([]);
    } catch (error) {
      console.error('Failed to mark as deposited:', error);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (loadingStates.collections) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <div className="p-4">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Pipeline Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusPipelineCard
          status="pending"
          count={statusTotals.pending.count}
          amount={statusTotals.pending.amount}
          onClick={() => setStatusFilter(statusFilter === 'pending' ? '' : 'pending')}
        />
        <StatusPipelineCard
          status="collected"
          count={statusTotals.collected.count}
          amount={statusTotals.collected.amount}
          onClick={() => setStatusFilter(statusFilter === 'collected' ? '' : 'collected')}
        />
        <StatusPipelineCard
          status="deposited"
          count={statusTotals.deposited.count}
          amount={statusTotals.deposited.amount}
          onClick={() => setStatusFilter(statusFilter === 'deposited' ? '' : 'deposited')}
        />
        <StatusPipelineCard
          status="reconciled"
          count={statusTotals.reconciled.count}
          amount={statusTotals.reconciled.amount}
          onClick={() => setStatusFilter(statusFilter === 'reconciled' ? '' : 'reconciled')}
        />
      </div>

      {/* Collections Timeline Chart */}
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Collections Timeline
          </h3>
          <CollectionsTimelineChart collections={codCollections} height={300} />
        </div>
      </Card>

      {/* Collections Table */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">COD Collections</h3>
            <div className="flex items-center gap-2">
              {selectedIds.length > 0 && (
                <button
                  onClick={handleMarkAsDeposited}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  Mark {selectedIds.length} as Deposited
                </button>
              )}
              <button className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filter
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {codCollections.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No collections found</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === codCollections.length}
                        onChange={handleSelectAll}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Order
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Agent
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(collection.id)}
                          onChange={() => handleSelectRow(collection.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        #{collection.id}
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
                        <span
                          className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            collection.status === 'collected'
                              ? 'bg-blue-100 text-blue-800'
                              : collection.status === 'deposited'
                              ? 'bg-green-100 text-green-800'
                              : collection.status === 'reconciled'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {collection.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(collection.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};
