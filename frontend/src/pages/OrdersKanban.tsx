import React, { useState } from 'react';
import { Filter, Plus } from 'lucide-react';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { SearchBar } from '../components/common/SearchBar';
import { FilterPanel } from '../components/common/FilterPanel';
import { Button } from '../components/ui/Button';

export const OrdersKanban: React.FC = () => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const handleSearch = (query: string) => {
    console.log('Search:', query);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Orders Kanban</h1>
        <div className="flex items-center gap-4">
          <div className="w-64">
            <SearchBar onSearch={handleSearch} placeholder="Search orders..." />
          </div>
          <Button variant="ghost" onClick={() => setIsFilterOpen(true)}>
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </Button>
          <Button variant="primary">
            <Plus className="w-4 h-4 mr-2" />
            New Order
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <KanbanBoard />
      </div>
      <FilterPanel isOpen={isFilterOpen} onClose={() => setIsFilterOpen(false)} />
    </div>
  );
};
