import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  agentInventoryService,
  InventoryTransfer,
} from '../../services/agent-inventory.service';

interface TransferHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: number;
  productName: string;
}

const TRANSFER_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  allocation: { label: 'Allocation', color: 'bg-blue-100 text-blue-800' },
  order_fulfillment: { label: 'Order Fulfilled', color: 'bg-green-100 text-green-800' },
  agent_transfer: { label: 'Agent Transfer', color: 'bg-purple-100 text-purple-800' },
  return_to_warehouse: { label: 'Return', color: 'bg-orange-100 text-orange-800' },
  adjustment: { label: 'Adjustment', color: 'bg-yellow-100 text-yellow-800' },
};

function formatAgent(agent: { firstName: string; lastName: string } | null): string {
  if (!agent) return 'Warehouse';
  return `${agent.firstName} ${agent.lastName}`;
}

export const TransferHistoryModal: React.FC<TransferHistoryModalProps> = ({
  isOpen,
  onClose,
  productId,
  productName,
}) => {
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterType, setFilterType] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      loadTransfers();
    }
  }, [isOpen, page, filterType]);

  const loadTransfers = async () => {
    setIsLoading(true);
    try {
      const result = await agentInventoryService.getTransferHistory({
        productId,
        type: filterType || undefined,
        page,
        limit: 20,
      });
      setTransfers(result.transfers);
      setTotalPages(result.pagination.totalPages);
    } catch (error) {
      console.error('Failed to load transfer history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilterChange = (type: string) => {
    setFilterType(type);
    setPage(1);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Transfer History - ${productName}`} size="xl">
      <div className="space-y-4">
        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Filter:</span>
          <select
            value={filterType}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            <option value="allocation">Allocations</option>
            <option value="order_fulfillment">Order Fulfillments</option>
            <option value="agent_transfer">Agent Transfers</option>
            <option value="return_to_warehouse">Returns</option>
            <option value="adjustment">Adjustments</option>
          </select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-2 text-sm text-gray-500">Loading...</p>
          </div>
        ) : transfers.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No transfers found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {transfers.map((t) => {
                  const typeInfo = TRANSFER_TYPE_LABELS[t.transferType] || {
                    label: t.transferType,
                    color: 'bg-gray-100 text-gray-800',
                  };
                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {new Date(t.createdAt).toLocaleDateString()}{' '}
                        <span className="text-gray-400">
                          {new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                        {formatAgent(t.fromAgent)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                        {formatAgent(t.toAgent)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right font-medium">
                        {t.quantity}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {t.order ? `#${t.order.id}` : '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {formatAgent(t.createdBy)}
                      </td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate" title={t.notes || ''}>
                        {t.notes || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
