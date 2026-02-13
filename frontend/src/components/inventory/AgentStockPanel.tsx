import React, { useEffect, useState } from 'react';
import { Package, ArrowRightLeft, RotateCcw, History, Plus } from 'lucide-react';
import { useAgentInventoryStore } from '../../stores/agentInventoryStore';
import { AgentStockItem } from '../../services/agent-inventory.service';
import { formatCurrency } from '../../utils/format';
import { Button } from '../ui/Button';
import { AllocateStockModal } from './AllocateStockModal';
import { TransferStockModal } from './TransferStockModal';
import { ReturnStockModal } from './ReturnStockModal';
import { TransferHistoryModal } from './TransferHistoryModal';

interface AgentStockPanelProps {
  productId: number;
  productName: string;
  warehouseStock: number;
  onStockChanged?: () => void;
}

export const AgentStockPanel: React.FC<AgentStockPanelProps> = ({
  productId,
  productName,
  warehouseStock,
  onStockChanged,
}) => {
  const { productAgentStock, isLoading, fetchProductAgentStock, allocateStock, transferStock, returnStock } =
    useAgentInventoryStore();

  const [showAllocate, setShowAllocate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [transferTarget, setTransferTarget] = useState<AgentStockItem | null>(null);
  const [returnTarget, setReturnTarget] = useState<AgentStockItem | null>(null);

  useEffect(() => {
    fetchProductAgentStock(productId);
  }, [productId, fetchProductAgentStock]);

  const data = productAgentStock[productId];
  const agents = data?.agents || [];

  const handleAllocate = async (agentId: number, quantity: number, notes?: string) => {
    await allocateStock({ productId, agentId, quantity, notes });
    onStockChanged?.();
  };

  const handleTransfer = async (toAgentId: number, quantity: number, notes?: string) => {
    if (!transferTarget) return;
    await transferStock({
      productId,
      fromAgentId: transferTarget.agentId,
      toAgentId,
      quantity,
      notes,
    });
  };

  const handleReturn = async (quantity: number, notes?: string) => {
    if (!returnTarget) return;
    await returnStock({ productId, agentId: returnTarget.agentId, quantity, notes });
    onStockChanged?.();
  };

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-gray-500" />
          <h4 className="text-sm font-medium text-gray-700">Agent Stock Distribution</h4>
          {data && (
            <span className="text-xs text-gray-500">
              ({data.totalWithAgents} units / {formatCurrency(data.totalValue)} with agents)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowHistory(true)}
          >
            <History className="w-3 h-3 mr-1" />
            History
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAllocate(true)}
          >
            <Plus className="w-3 h-3 mr-1" />
            Allocate
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto" />
        </div>
      ) : agents.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-3">
          No stock allocated to agents yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase">
                <th className="text-left py-2 pr-4">Agent</th>
                <th className="text-right py-2 px-3">Allocated</th>
                <th className="text-right py-2 px-3" title="Orders currently out for delivery">In Transit</th>
                <th className="text-right py-2 px-3">Fulfilled</th>
                <th className="text-right py-2 px-3">Returned</th>
                <th className="text-right py-2 px-3 font-semibold">On Hand</th>
                <th className="text-right py-2 px-3">Value</th>
                <th className="text-right py-2 pl-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {agents.map((agent) => (
                <tr key={agent.agentId} className="hover:bg-gray-100">
                  <td className="py-2 pr-4">
                    <div className="font-medium text-gray-900">{agent.agentName}</div>
                    {agent.email && (
                      <div className="text-xs text-gray-400">{agent.email}</div>
                    )}
                  </td>
                  <td className="text-right py-2 px-3 text-gray-600">{agent.totalAllocated}</td>
                  <td className="text-right py-2 px-3 text-amber-600 font-medium">{agent.totalInTransit}</td>
                  <td className="text-right py-2 px-3 text-gray-600">{agent.totalFulfilled}</td>
                  <td className="text-right py-2 px-3 text-gray-600">{agent.totalReturned}</td>
                  <td className="text-right py-2 px-3 font-semibold text-gray-900">{agent.quantity}</td>
                  <td className="text-right py-2 px-3 text-gray-600">{formatCurrency(agent.value)}</td>
                  <td className="text-right py-2 pl-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setTransferTarget(agent)}
                        className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded"
                        title="Transfer to another agent"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setReturnTarget(agent)}
                        className="p-1 text-orange-600 hover:text-orange-800 hover:bg-orange-50 rounded"
                        title="Return to warehouse"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              {agents.length > 1 && (
                <tr className="bg-gray-100 font-medium">
                  <td className="py-2 pr-4 text-gray-700">Total</td>
                  <td className="text-right py-2 px-3 text-gray-700">
                    {agents.reduce((s, a) => s + a.totalAllocated, 0)}
                  </td>
                  <td className="text-right py-2 px-3 text-amber-600 font-medium">
                    {agents.reduce((s, a) => s + a.totalInTransit, 0)}
                  </td>
                  <td className="text-right py-2 px-3 text-gray-700">
                    {agents.reduce((s, a) => s + a.totalFulfilled, 0)}
                  </td>
                  <td className="text-right py-2 px-3 text-gray-700">
                    {agents.reduce((s, a) => s + a.totalReturned, 0)}
                  </td>
                  <td className="text-right py-2 px-3 font-semibold text-gray-900">
                    {data?.totalWithAgents}
                  </td>
                  <td className="text-right py-2 px-3 text-gray-700">
                    {formatCurrency(data?.totalValue || 0)}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <AllocateStockModal
        isOpen={showAllocate}
        onClose={() => setShowAllocate(false)}
        onSubmit={handleAllocate}
        productName={productName}
        warehouseStock={warehouseStock}
      />

      {transferTarget && (
        <TransferStockModal
          isOpen={!!transferTarget}
          onClose={() => setTransferTarget(null)}
          onSubmit={handleTransfer}
          productName={productName}
          fromAgentId={transferTarget.agentId}
          fromAgentName={transferTarget.agentName}
          availableQuantity={transferTarget.quantity}
        />
      )}

      {returnTarget && (
        <ReturnStockModal
          isOpen={!!returnTarget}
          onClose={() => setReturnTarget(null)}
          onSubmit={handleReturn}
          productName={productName}
          agentName={returnTarget.agentName}
          availableQuantity={returnTarget.quantity}
        />
      )}

      <TransferHistoryModal
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        productId={productId}
        productName={productName}
      />
    </div>
  );
};
