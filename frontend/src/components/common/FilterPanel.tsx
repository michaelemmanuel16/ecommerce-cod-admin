import React from 'react';
import { Filter, X } from 'lucide-react';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';

interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-lg p-6 border-l z-40">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Filters</h3>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <Select
          label="Status"
          options={[
            { value: '', label: 'All' },
            { value: 'new_orders', label: 'New Orders' },
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'delivered', label: 'Delivered' },
          ]}
        />
        <Select
          label="Priority"
          options={[
            { value: '', label: 'All' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'urgent', label: 'Urgent' },
          ]}
        />
        <div className="pt-4">
          <Button variant="primary" className="w-full mb-2">
            Apply Filters
          </Button>
          <Button variant="ghost" className="w-full">
            Clear All
          </Button>
        </div>
      </div>
    </div>
  );
};
