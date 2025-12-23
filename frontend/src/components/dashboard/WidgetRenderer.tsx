/**
 * Widget Renderer Component
 * Dynamically renders widgets based on configuration
 */

import React from 'react';
import { WidgetConfig, DashboardData } from '../../config/types/dashboard';
import { resolveDataSource, applyDataFilters } from '../../utils/dashboard/dataResolver';
import { widgetRegistry } from './widgetRegistry';
import { useAuthStore } from '../../stores/authStore';

interface WidgetRendererProps {
  config: WidgetConfig;
  data: DashboardData;
  loading?: boolean;
  error?: Error | null;
  dataFilters?: Record<string, any>;
}

export const WidgetRenderer: React.FC<WidgetRendererProps> = ({
  config,
  data,
  loading = false,
  error = null,
  dataFilters,
}) => {
  const { user } = useAuthStore();

  // Get the appropriate widget component from registry
  const WidgetComponent = widgetRegistry[config.type];

  if (!WidgetComponent) {
    console.error(`Widget type "${config.type}" not found in registry`);
    return (
      <div className="p-4 border border-red-300 bg-red-50 rounded-lg">
        <p className="text-red-600">
          Error: Widget type "{config.type}" not registered
        </p>
      </div>
    );
  }

  // Resolve data from data source path
  let widgetData = resolveDataSource(data, config.dataSource);

  // Apply filters if specified (for role-specific filtering)
  if (dataFilters && config.dataSource) {
    const filterKey = config.dataSource.split('.')[0]; // Get top-level key
    const filters = dataFilters[filterKey];

    if (filters && Array.isArray(widgetData)) {
      widgetData = applyDataFilters(widgetData, filters, user?.id);
    }
  }

  // Handle error state
  if (error) {
    return (
      <div className="p-4 border border-yellow-300 bg-yellow-50 rounded-lg">
        <p className="text-yellow-700 text-sm">
          Failed to load widget: {error.message}
        </p>
      </div>
    );
  }

  // Render the widget component
  return (
    <WidgetComponent
      config={config}
      data={widgetData}
      loading={loading}
      error={error}
      fullDashboardData={data}
    />
  );
};
