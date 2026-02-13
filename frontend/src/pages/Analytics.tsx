import React, { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard,
  DollarSign,
  Truck,
  Users,
} from 'lucide-react';
import { startOfMonth, format } from 'date-fns';
import { DateRangePicker } from '../components/ui/DateRangePicker';
import { cn } from '../utils/cn';
import { OverviewTab } from './analytics/OverviewTab';
import { SalesRevenueTab } from './analytics/SalesRevenueTab';
import { DeliveryOperationsTab } from './analytics/DeliveryOperationsTab';
import { TeamPerformanceTab } from './analytics/TeamPerformanceTab';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sales-revenue', label: 'Sales & Revenue', icon: DollarSign },
  { id: 'delivery-operations', label: 'Delivery & Operations', icon: Truck },
  { id: 'team-performance', label: 'Team Performance', icon: Users },
] as const;

type TabId = (typeof TABS)[number]['id'];

export const Analytics: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = TABS.some((t) => t.id === tabParam) ? tabParam! : 'overview';

  // Default to month-to-date
  const [startDate, setStartDate] = useState<string | undefined>(
    format(startOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState<string | undefined>(
    new Date().toISOString()
  );

  const handleTabChange = useCallback(
    (tabId: TabId) => {
      setSearchParams({ tab: tabId });
    },
    [setSearchParams]
  );

  const handleDateChange = useCallback(
    (start: string | undefined, end: string | undefined) => {
      setStartDate(start);
      setEndDate(end);
    },
    []
  );

  const renderTab = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewTab startDate={startDate} endDate={endDate} />;
      case 'sales-revenue':
        return <SalesRevenueTab startDate={startDate} endDate={endDate} />;
      case 'delivery-operations':
        return <DeliveryOperationsTab startDate={startDate} endDate={endDate} />;
      case 'team-performance':
        return <TeamPerformanceTab startDate={startDate} endDate={endDate} />;
      default:
        return <OverviewTab startDate={startDate} endDate={endDate} />;
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics & Insights</h1>
          <p className="text-sm text-gray-600 mt-1">
            Track your business performance and key metrics
          </p>
        </div>
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={handleDateChange}
          placeholder="Select date range"
        />
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  'flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm',
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Active Tab Content */}
      {renderTab()}
    </div>
  );
};
