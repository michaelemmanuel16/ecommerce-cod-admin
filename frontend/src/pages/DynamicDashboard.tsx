/**
 * Dynamic Dashboard Component
 * Main dashboard that loads configuration based on user role
 */

import React, { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { dashboardConfigs } from '../config/dashboards';
import { DashboardLayout } from '../components/dashboard/DashboardLayout';
import { useDashboardData } from '../hooks/useDashboardData';

export interface DateRangeFilter {
  preset?: string;
  startDate?: string;
  endDate?: string;
}

export const DynamicDashboard: React.FC = () => {
  const { user } = useAuthStore();

  // Get config based on user role
  const config = dashboardConfigs[user?.role || 'admin'];

  // State for date range (supports both presets and custom ranges)
  const [dateRange, setDateRange] = useState<DateRangeFilter>({
    preset: config?.defaultDateRange || 'last-30-days',
  });

  // Fetch dashboard data
  const { data, loading, error, refetch } = useDashboardData(config, dateRange);

  // Handle no config found
  if (!config) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Dashboard Not Available
          </h2>
          <p className="text-gray-600">
            No dashboard configuration found for role: {user?.role || 'unknown'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <DashboardLayout
        config={config}
        data={data}
        loading={loading}
        error={error}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onRefresh={refetch}
      />
    </div>
  );
};
