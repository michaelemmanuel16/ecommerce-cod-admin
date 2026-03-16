import { useEffect, useState } from 'react';
import {
  Users,
  Boxes,
  DollarSign,
  ArrowLeft,
  RotateCcw,
  ArrowLeftRight,
  SlidersHorizontal,
  History,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { useAgentInventoryStore } from '../stores/agentInventoryStore';
import { AgentInventoryItem } from '../services/agent-inventory.service';
import { formatCurrency } from '../utils/format';
import { ReturnStockModal } from '../components/inventory/ReturnStockModal';
import { TransferStockModal } from '../components/inventory/TransferStockModal';
import { AdjustStockModal } from '../components/inventory/AdjustStockModal';

type Tab = 'summary' | 'detail' | 'history';

export default function AgentInventoryManagement() {
  const {
    summary,
    agentInventory,
    transferHistory,
    isLoadingInventory,
    isLoadingSummary,
    isLoadingHistory,
    fetchSummary,
    fetchAgentInventory,
    fetchTransferHistory,
    returnStock,
    transferStock,
    adjustStock,
  } = useAgentInventoryStore();

  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [selectedAgentName, setSelectedAgentName] = useState('');

  // Modal states
  const [returnModal, setReturnModal] = useState<{ item: AgentInventoryItem } | null>(null);
  const [transferModal, setTransferModal] = useState<{ item: AgentInventoryItem } | null>(null);
  const [adjustModal, setAdjustModal] = useState<{ item: AgentInventoryItem } | null>(null);

  // Transfer history filters
  const [historyFilters, setHistoryFilters] = useState({
    agentId: '',
    type: '',
    startDate: '',
    endDate: '',
    page: 1,
  });

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if (selectedAgentId) {
      fetchAgentInventory(selectedAgentId);
    }
  }, [selectedAgentId, fetchAgentInventory]);

  useEffect(() => {
    if (activeTab === 'history') {
      const params: Record<string, any> = { page: historyFilters.page, limit: 20 };
      if (historyFilters.agentId) params.agentId = parseInt(historyFilters.agentId);
      if (historyFilters.type) params.type = historyFilters.type;
      if (historyFilters.startDate) params.startDate = historyFilters.startDate;
      if (historyFilters.endDate) params.endDate = historyFilters.endDate;
      fetchTransferHistory(params);
    }
  }, [activeTab, historyFilters, fetchTransferHistory]);

  const handleViewAgent = (agentId: number, agentName: string) => {
    setSelectedAgentId(agentId);
    setSelectedAgentName(agentName);
    setActiveTab('detail');
  };

  const handleBackToSummary = () => {
    setSelectedAgentId(null);
    setSelectedAgentName('');
    setActiveTab('summary');
    fetchSummary();
  };

  const refreshAfterAction = async () => {
    if (selectedAgentId) {
      await fetchAgentInventory(selectedAgentId);
    }
    await fetchSummary();
  };

  const renderSummaryTab = () => (
    <>
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-sm p-6 border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-blue-700 font-medium">Agents with Stock</p>
              <p className="text-2xl font-bold text-blue-900 mt-1">{summary?.totalAgents || 0}</p>
            </div>
            <div className="bg-blue-500 p-3 rounded-lg">
              <Users className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow-sm p-6 border border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-700 font-medium">Total Quantity</p>
              <p className="text-2xl font-bold text-green-900 mt-1">{summary?.totalQuantity || 0}</p>
            </div>
            <div className="bg-green-500 p-3 rounded-lg">
              <Boxes className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg shadow-sm p-6 border border-purple-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-purple-700 font-medium">Total Value</p>
              <p className="text-2xl font-bold text-purple-900 mt-1">{formatCurrency(summary?.totalValue || 0)}</p>
            </div>
            <div className="bg-purple-500 p-3 rounded-lg">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Agent Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Agents Inventory Overview</h2>
        </div>

        {!summary?.agents?.length ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="bg-gray-100 p-4 rounded-full mb-4">
              <AlertCircle className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No agent inventory yet</h3>
            <p className="text-gray-600 text-center max-w-md">
              Allocate stock to agents from the Products page to get started.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agent</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Qty</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Value</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {summary.agents.map((agent) => (
                  <tr key={agent.agentId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{agent.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{agent.items}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{agent.totalQuantity}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-green-600">{formatCurrency(agent.totalValue)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleViewAgent(agent.agentId, agent.name)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  const renderDetailTab = () => {
    const items = agentInventory?.items || [];

    return (
      <>
        {/* Back button */}
        <button
          onClick={handleBackToSummary}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Back to Summary</span>
        </button>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {selectedAgentName}&apos;s Inventory
          </h2>
          <span className="text-sm text-gray-500">
            Total Value: <span className="font-semibold text-green-600">{formatCurrency(agentInventory?.totalValue || 0)}</span>
          </span>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="bg-gray-100 p-4 rounded-full mb-4">
                <AlertCircle className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No stock assigned</h3>
              <p className="text-gray-600 text-center max-w-md">
                This agent has no inventory allocated yet.
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
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-green-600">{formatCurrency(item.value)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setReturnModal({ item })}
                            className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-md"
                            title="Return to warehouse"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setTransferModal({ item })}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md"
                            title="Transfer to another agent"
                          >
                            <ArrowLeftRight className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setAdjustModal({ item })}
                            className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-md"
                            title="Adjust quantity"
                          >
                            <SlidersHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modals */}
        {returnModal && selectedAgentId && (
          <ReturnStockModal
            isOpen={true}
            onClose={() => setReturnModal(null)}
            onSubmit={async (quantity, notes) => {
              await returnStock({
                productId: returnModal.item.productId,
                agentId: selectedAgentId,
                quantity,
                notes,
              });
              await refreshAfterAction();
              setReturnModal(null);
            }}
            productName={returnModal.item.productName}
            agentName={selectedAgentName}
            availableQuantity={returnModal.item.quantity}
          />
        )}

        {transferModal && selectedAgentId && (
          <TransferStockModal
            isOpen={true}
            onClose={() => setTransferModal(null)}
            onSubmit={async (toAgentId, quantity, notes) => {
              await transferStock({
                productId: transferModal.item.productId,
                fromAgentId: selectedAgentId,
                toAgentId,
                quantity,
                notes,
              });
              await refreshAfterAction();
              setTransferModal(null);
            }}
            productName={transferModal.item.productName}
            fromAgentId={selectedAgentId}
            fromAgentName={selectedAgentName}
            availableQuantity={transferModal.item.quantity}
          />
        )}

        {adjustModal && selectedAgentId && (
          <AdjustStockModal
            isOpen={true}
            onClose={() => setAdjustModal(null)}
            onSubmit={async (newQuantity, notes) => {
              await adjustStock({
                productId: adjustModal.item.productId,
                agentId: selectedAgentId,
                newQuantity,
                notes,
              });
              await refreshAfterAction();
              setAdjustModal(null);
            }}
            productName={adjustModal.item.productName}
            agentName={selectedAgentName}
            currentQuantity={adjustModal.item.quantity}
          />
        )}
      </>
    );
  };

  const renderHistoryTab = () => {
    const transfers = transferHistory?.transfers || [];
    const pagination = transferHistory?.pagination;

    const formatAgentName = (agent: { firstName: string; lastName: string } | null) =>
      agent ? `${agent.firstName} ${agent.lastName}` : 'Warehouse';

    const typeLabels: Record<string, string> = {
      allocation: 'Allocation',
      transfer: 'Transfer',
      return: 'Return',
      adjustment: 'Adjustment',
      fulfillment: 'Fulfillment',
    };

    const typeBadgeColors: Record<string, string> = {
      allocation: 'bg-green-100 text-green-800',
      transfer: 'bg-blue-100 text-blue-800',
      return: 'bg-orange-100 text-orange-800',
      adjustment: 'bg-purple-100 text-purple-800',
      fulfillment: 'bg-gray-100 text-gray-800',
    };

    return (
      <>
        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Agent</label>
              <select
                value={historyFilters.agentId}
                onChange={(e) => setHistoryFilters((f) => ({ ...f, agentId: e.target.value, page: 1 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Agents</option>
                {summary?.agents?.map((a) => (
                  <option key={a.agentId} value={a.agentId}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select
                value={historyFilters.type}
                onChange={(e) => setHistoryFilters((f) => ({ ...f, type: e.target.value, page: 1 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Types</option>
                <option value="allocation">Allocation</option>
                <option value="transfer">Transfer</option>
                <option value="return">Return</option>
                <option value="adjustment">Adjustment</option>
                <option value="fulfillment">Fulfillment</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
              <input
                type="date"
                value={historyFilters.startDate}
                onChange={(e) => setHistoryFilters((f) => ({ ...f, startDate: e.target.value, page: 1 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
              <input
                type="date"
                value={historyFilters.endDate}
                onChange={(e) => setHistoryFilters((f) => ({ ...f, endDate: e.target.value, page: 1 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Transfer History Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {transfers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="bg-gray-100 p-4 rounded-full mb-4">
                <AlertCircle className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No transfer history</h3>
              <p className="text-gray-600 text-center max-w-md">
                Transfer records will appear here as inventory moves occur.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">From</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">To</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">By</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {transfers.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {format(new Date(t.createdAt), 'MMM dd, yyyy')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeBadgeColors[t.transferType] || 'bg-gray-100 text-gray-800'}`}>
                            {typeLabels[t.transferType] || t.transferType}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{t.product.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">{t.quantity}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{formatAgentName(t.fromAgent)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{formatAgentName(t.toAgent)}</td>
                        <td className="px-6 py-4 text-sm text-gray-500 max-w-[200px] truncate">{t.notes || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {t.createdBy.firstName} {t.createdBy.lastName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50">
                  <p className="text-sm text-gray-700">
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total} records)
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setHistoryFilters((f) => ({ ...f, page: f.page - 1 }))}
                      disabled={pagination.page <= 1}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 hover:bg-gray-100"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setHistoryFilters((f) => ({ ...f, page: f.page + 1 }))}
                      disabled={pagination.page >= pagination.totalPages}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 hover:bg-gray-100"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </>
    );
  };

  if ((isLoadingSummary || isLoadingInventory || isLoadingHistory) && !summary && !agentInventory && !transferHistory) {
    return (
      <div className="flex items-center justify-center h-64">
        <div role="status" className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600">
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Agent Inventory</h1>
        <p className="text-gray-600 mt-1">
          Manage stock allocated to delivery agents
        </p>
      </div>

      {/* Tabs */}
      {activeTab !== 'detail' && (
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setActiveTab('summary')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === 'summary'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <Boxes className="w-4 h-4" />
              Summary
            </div>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === 'history'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <History className="w-4 h-4" />
              Transfer History
            </div>
          </button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'summary' && renderSummaryTab()}
      {activeTab === 'detail' && renderDetailTab()}
      {activeTab === 'history' && renderHistoryTab()}
    </div>
  );
}
