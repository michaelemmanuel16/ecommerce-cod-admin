/**
 * Stat Card Widget
 * Displays a single metric with icon, value, trend, and subtitle
 */

import React from 'react';
import * as LucideIcons from 'lucide-react';
import { StatCardConfig, WidgetProps, DashboardData } from '../../../config/types/dashboard';
import { formatValue } from '../../../utils/dashboard/formatters';
import { calculateTrend, getTrendColorClass, getTrendIcon } from '../../../utils/dashboard/trendCalculator';
import { resolveTemplate, resolveDataSource } from '../../../utils/dashboard/dataResolver';
import { Tooltip } from '../../ui/Tooltip';

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
    const currentValue = typeof data === 'number' ? data : parseFloat(String(data));

    // Determine the previous value (comparison value)
    let previousValue = undefined;
    const comparisonPath = config.trend.comparisonSource || config.trend.dataSource;

    if (comparisonPath) {
      previousValue = resolveDataSource(fullDashboardData, comparisonPath);
    }

    if (!isNaN(currentValue) && previousValue !== undefined && !isNaN(previousValue)) {
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
      <div className="p-3 sm:p-6">
        {/* Header with icon and title */}
        <div className="flex items-start justify-between mb-2 sm:mb-4">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div className={`p-1.5 sm:p-2 rounded-lg bg-gray-50 shrink-0 ${config.iconColor}`}>
              <IconComponent className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 line-clamp-2">{config.title}</h3>
          </div>

          {/* Info tooltip (if provided) - hidden on small screens */}
          {config.info && (
            <Tooltip content={config.info} position="bottom">
              <button className="text-gray-400 hover:text-gray-600 hidden sm:block shrink-0">
                <LucideIcons.Info className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
        </div>

        {/* Main value */}
        <div className="mb-1 sm:mb-3">
          {loading ? (
            <div className="h-10 w-32 bg-gray-200 animate-pulse rounded" />
          ) : (
            <div className="text-lg sm:text-3xl font-bold text-gray-900 truncate">
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
          <p className="text-xs sm:text-sm text-gray-500 mt-1 sm:mt-2 truncate">
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

