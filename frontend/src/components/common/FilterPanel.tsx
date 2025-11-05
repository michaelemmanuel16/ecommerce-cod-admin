import React from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useOrdersStore } from '../../stores/ordersStore';
import { OrderStatus } from '../../types';

interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({ isOpen, onClose }) => {
  const { filters, setFilters } = useOrdersStore();

  const [selectedStatus, setSelectedStatus] = React.useState<OrderStatus[]>(filters.status || []);

  const statuses: OrderStatus[] = [
    'pending_confirmation',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'returned',
    'failed_delivery',
  ];

  const handleApply = () => {
    setFilters({
      ...filters,
      status: selectedStatus.length > 0 ? selectedStatus : undefined,
    });
    onClose();
  };

  const handleReset = () => {
    setSelectedStatus([]);
    // Preserve date filters when resetting status filters
    setFilters({
      startDate: filters.startDate,
      endDate: filters.endDate,
    });
  };

  const toggleStatus = (status: OrderStatus) => {
    setSelectedStatus((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-96 bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Status Filter */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Order Status</h3>
            <div className="space-y-2">
              {statuses.map((status) => (
                <label key={status} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedStatus.includes(status)}
                    onChange={() => toggleStatus(status)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                  <span className="ml-2 text-sm text-gray-700 capitalize">
                    {status.replace(/_/g, ' ')}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-6 space-y-3">
          <Button variant="primary" onClick={handleApply} className="w-full">
            Apply Filters
          </Button>
          <Button variant="ghost" onClick={handleReset} className="w-full">
            Reset All
          </Button>
        </div>
      </div>
    </>
  );
};
