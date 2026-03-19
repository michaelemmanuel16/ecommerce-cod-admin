import { useEffect, useState, useCallback } from 'react';
import { Package, Boxes, AlertCircle, ChevronRight, X, Clock, ArrowDownLeft, ArrowUpRight, RotateCcw, Truck, Settings2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useAgentInventoryStore } from '../stores/agentInventoryStore';

interface SelectedProduct {
  id: number;
  name: string;
}

const TRANSFER_TYPE_CONFIG: Record<string, { label: string; badgeClass: string; icon: React.ElementType; sign: '+' | '-' | 'dynamic' }> = {
  allocation: { label: 'Allocated', badgeClass: 'bg-green-100 text-green-800', icon: ArrowDownLeft, sign: '+' },
  order_fulfillment: { label: 'Fulfilled', badgeClass: 'bg-blue-100 text-blue-800', icon: Truck, sign: '-' },
  agent_transfer: { label: 'Transfer', badgeClass: 'bg-purple-100 text-purple-800', icon: ArrowUpRight, sign: 'dynamic' },
  return_to_warehouse: { label: 'Returned', badgeClass: 'bg-orange-100 text-orange-800', icon: RotateCcw, sign: '-' },
  adjustment: { label: 'Adjusted', badgeClass: 'bg-gray-100 text-gray-800', icon: Settings2, sign: 'dynamic' },
};

export default function AgentMyInventory() {
  const { user } = useAuthStore();
  const {
    agentInventory,
    isLoadingInventory,
    fetchAgentInventory,
    transferHistory,
    isLoadingHistory,
    fetchTransferHistory,
  } = useAgentInventoryStore();

  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  useEffect(() => {
    if (user?.id) {
      fetchAgentInventory(user.id);
    }
  }, [user?.id, fetchAgentInventory]);

  const openHistory = useCallback((productId: number, productName: string) => {
    setSelectedProduct({ id: productId, name: productName });
    setHistoryPage(1);
    if (user?.id) {
      fetchTransferHistory({ agentId: user.id, productId, page: 1, limit: 10 });
    }
  }, [user?.id, fetchTransferHistory]);

  const loadMoreHistory = useCallback(() => {
    if (!selectedProduct || !user?.id) return;
    const nextPage = historyPage + 1;
    setHistoryPage(nextPage);
    fetchTransferHistory({ agentId: user.id, productId: selectedProduct.id, page: nextPage, limit: 10 });
  }, [selectedProduct, user?.id, historyPage, fetchTransferHistory]);

  const closeSheet = useCallback(() => {
    setSelectedProduct(null);
  }, []);

  if (isLoadingInventory) {
    return (
      <div className="flex items-center justify-center h-64">
        <div role="status" className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600">
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  const items = agentInventory?.items || [];
  const totalProducts = items.length;
  const totalOnHand = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Inventory</h1>
        <p className="text-gray-600 mt-1">
          View your currently assigned stock
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-sm p-6 border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-blue-700 font-medium">Total Products</p>
              <p className="text-2xl font-bold text-blue-900 mt-1">{totalProducts}</p>
            </div>
            <div className="bg-blue-500 p-3 rounded-lg">
              <Package className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow-sm p-6 border border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-700 font-medium">Total On Hand</p>
              <p className="text-2xl font-bold text-green-900 mt-1">{totalOnHand}</p>
            </div>
            <div className="bg-green-500 p-3 rounded-lg">
              <Boxes className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Assigned Stock</h2>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="bg-gray-100 p-4 rounded-full mb-4">
              <AlertCircle className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No inventory assigned yet
            </h3>
            <p className="text-gray-600 text-center max-w-md">
              Your assigned stock will appear here once an administrator allocates products to you.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">On Hand</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Allocated</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">In Transit</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Fulfilled</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Returned</th>
                  <th className="px-6 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {items.map((item) => (
                  <tr
                    key={item.productId}
                    className="hover:bg-gray-50 cursor-pointer active:bg-gray-100"
                    onClick={() => openHistory(item.productId, item.productName)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{item.productName}</div>
                        <div className="text-sm text-gray-500">{item.sku}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">{item.quantity}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{item.totalAllocated}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{item.totalInTransit}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{item.totalFulfilled}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{item.totalReturned}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Allocation History Bottom Sheet */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={closeSheet} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl max-h-[70vh] overflow-y-auto">
            {/* Sheet Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-gray-500" />
                  <h3 className="text-lg font-semibold text-gray-900">{selectedProduct.name}</h3>
                </div>
                <button
                  onClick={closeSheet}
                  className="p-1 rounded-full hover:bg-gray-100"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-1">Allocation History</p>
            </div>

            {/* Sheet Content */}
            <div className="px-4 py-3">
              {isLoadingHistory && !transferHistory ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse flex gap-3 p-3">
                      <div className="w-8 h-8 bg-gray-200 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-1/3" />
                        <div className="h-3 bg-gray-200 rounded w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !transferHistory?.transfers.length ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <Clock className="w-10 h-10 text-gray-300 mb-3" />
                  <p className="text-gray-500 text-sm">No allocation history for this product</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {transferHistory.transfers.map((transfer) => {
                      const config = TRANSFER_TYPE_CONFIG[transfer.transferType] || TRANSFER_TYPE_CONFIG.adjustment;
                      const Icon = config.icon;

                      let sign: string;
                      if (config.sign === 'dynamic') {
                        if (transfer.transferType === 'agent_transfer') {
                          sign = transfer.toAgentId === user?.id ? '+' : '-';
                        } else {
                          sign = transfer.quantity >= 0 ? '+' : '';
                        }
                      } else {
                        sign = config.sign === '+' ? '+' : '-';
                      }

                      let label = config.label;
                      if (transfer.transferType === 'agent_transfer') {
                        label = transfer.toAgentId === user?.id ? 'Transfer In' : 'Transfer Out';
                      }

                      const fromName = transfer.fromAgent
                        ? `${transfer.fromAgent.firstName} ${transfer.fromAgent.lastName}`
                        : null;
                      const toName = transfer.toAgent
                        ? `${transfer.toAgent.firstName} ${transfer.toAgent.lastName}`
                        : null;

                      return (
                        <div key={transfer.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
                          <div className={`p-1.5 rounded-full ${config.badgeClass}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.badgeClass}`}>
                                {label}
                              </span>
                              <span className={`text-sm font-semibold ${sign === '+' ? 'text-green-600' : 'text-red-600'}`}>
                                {sign}{Math.abs(transfer.quantity)}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                              <p>{new Date(transfer.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                              {fromName && <p>From: {fromName}</p>}
                              {toName && <p>To: {toName}</p>}
                              {transfer.order && <p>Order #{transfer.order.id}</p>}
                              {transfer.notes && <p className="text-gray-400 italic">{transfer.notes}</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {transferHistory.pagination.totalPages > 1 &&
                    historyPage < transferHistory.pagination.totalPages && (
                    <button
                      onClick={loadMoreHistory}
                      disabled={isLoadingHistory}
                      className="w-full mt-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                    >
                      {isLoadingHistory ? 'Loading...' : 'Load More'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
