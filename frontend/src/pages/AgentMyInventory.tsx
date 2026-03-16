import { useEffect } from 'react';
import { Package, Boxes, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useAgentInventoryStore } from '../stores/agentInventoryStore';

export default function AgentMyInventory() {
  const { user } = useAuthStore();
  const { agentInventory, isLoadingInventory, fetchAgentInventory } = useAgentInventoryStore();

  useEffect(() => {
    if (user?.id) {
      fetchAgentInventory(user.id);
    }
  }, [user?.id, fetchAgentInventory]);

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
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {items.map((item) => (
                  <tr key={item.productId} className="hover:bg-gray-50">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
