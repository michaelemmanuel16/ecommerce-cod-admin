/**
 * Stat Card Widget
 * Displays a single metric with icon, value, trend, and subtitle
 */

import React from 'react';
import * as LucideIcons from 'lucide-react';
import { StatCardConfig, WidgetProps, DashboardData } from '../../../config/types/dashboard';
import { formatValue } from '../../../utils/dashboard/formatters';
import { calculateTrend, getTrendColorClass, getTrendIcon } from '../../../utils/dashboard/trendCalculator';
import { resolveTemplate } from '../../../utils/dashboard/dataResolver';

interface StatCardWidgetProps extends WidgetProps {
  config: StatCardConfig;
  fullDashboardData?: DashboardData;
}

export const StatCardWidget: React.FC<StatCardWidgetProps> = ({
  config,
  data,
  loading = false,
  fullDashboardData,
}) => {
  // Get icon component dynamically
  const IconComponent = (LucideIcons as any)[config.icon] || LucideIcons.TrendingUp;

  // Format the main value
  const formattedValue = formatValue(data, config.format);

  // Calculate trend if enabled
  let trendData = null;
  if (config.trend?.enabled && fullDashboardData) {
    // For now, we'll use a placeholder previous value
    // In production, this would come from historical data
    const currentValue = typeof data === 'number' ? data : parseFloat(String(data));
    const previousValue = currentValue * 0.9; // Placeholder: assume 10% less

    if (!isNaN(currentValue) && !isNaN(previousValue)) {
      trendData = calculateTrend(currentValue, previousValue, config.trend.inverted);
    }
  }

  // Resolve subtitle template
  let subtitleText = '';
  if (config.subtitle && fullDashboardData) {
    subtitleText = resolveTemplate(
      config.subtitle.template,
      fullDashboardData,
      config.subtitle.dataSources
    );
  }

  // Determine onboarding CSS classes based on config.id (for sales rep tour)
  const getOnboardingClasses = () => {
    if (config.id === 'my-commission') return 'onboarding-earnings-card';
    if (config.id === 'my-pending-orders') return 'onboarding-pending-orders';
    if (config.id === 'my-total-orders' || config.id === 'my-conversion-rate') {
      return 'onboarding-stats-cards';
    }
    return '';
  };

  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden ${getOnboardingClasses()}`}>
      <div className="p-6">
        {/* Header with icon and title */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg bg-gray-50 ${config.iconColor}`}>
              <IconComponent className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-medium text-gray-600">{config.title}</h3>
          </div>

          {/* Info tooltip (if provided) */}
          {config.info && (
            <button
              className="text-gray-400 hover:text-gray-600"
              title={config.info}
            >
              <LucideIcons.Info className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Main value */}
        <div className="mb-3">
          {loading ? (
            <div className="h-10 w-32 bg-gray-200 animate-pulse rounded" />
          ) : (
            <div className="text-3xl font-bold text-gray-900">
              {formattedValue.formatted}
            </div>
          )}
        </div>

        {/* Trend indicator */}
        {trendData && !loading && (
          <div className={`flex items-center gap-1 text-sm font-medium ${getTrendColorClass(trendData)}`}>
            <span className="text-lg">{getTrendIcon(trendData.direction)}</span>
            <span>
              {trendData.direction === 'up' ? '+' : trendData.direction === 'down' ? '-' : ''}
              {trendData.percentage}%
            </span>
          </div>
        )}

        {/* Subtitle */}
        {subtitleText && !loading && (
          <p className="text-sm text-gray-500 mt-2">
            {subtitleText}
          </p>
        )}

        {/* Loading state */}
        {loading && (
          <div className="space-y-2">
            <div className="h-4 w-24 bg-gray-200 animate-pulse rounded" />
            <div className="h-4 w-full bg-gray-200 animate-pulse rounded" />
          </div>
        )}
      </div>

      {/* Optional click handler indicator */}
      {config.onClick && !loading && (
        <div className="border-t border-gray-100 px-6 py-3 bg-gray-50">
          <button className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
            View details
            <LucideIcons.ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Helper to format comparison period labels
 */
function formatComparisonLabel(comparison: string): string {
  const labels: Record<string, string> = {
    previousPeriod: 'previous period',
    yesterday: 'yesterday',
    lastWeek: 'last week',
    lastMonth: 'last month',
  };
  return labels[comparison] || comparison;
}
