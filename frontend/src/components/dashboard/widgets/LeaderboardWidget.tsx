/**
 * Leaderboard Widget
 * Displays ranked list with horizontal bars
 */

import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Trophy, Medal } from 'lucide-react';
import { LeaderboardConfig, WidgetProps } from '../../../config/types/dashboard';
import { formatValue } from '../../../utils/dashboard/formatters';

interface LeaderboardWidgetProps extends WidgetProps {
  config: LeaderboardConfig;
}

export const LeaderboardWidget: React.FC<LeaderboardWidgetProps> = ({
  config,
  data,
  loading = false,
}) => {
  // Sort and limit data
  const leaderboardData = useMemo(() => {
    if (!Array.isArray(data)) return [];

    let sorted = [...data];

    // Sort by specified key
    sorted.sort((a, b) => {
      const aVal = a[config.config.sortBy] || 0;
      const bVal = b[config.config.sortBy] || 0;
      return config.config.sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Limit to maxItems
    if (config.config.maxItems) {
      sorted = sorted.slice(0, config.config.maxItems);
    }

    return sorted;
  }, [data, config.config]);

  // Handle empty state
  if (!loading && leaderboardData.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">{config.title}</h3>
        <div
          className="flex flex-col items-center justify-center bg-gray-50 rounded-lg"
          style={{ height: config.height }}
        >
          <Trophy className="w-16 h-16 text-gray-300 mb-4" />
          <p className="text-gray-500 text-sm">No data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Trophy className="w-5 h-5 text-yellow-500" />
        {config.title}
      </h3>

      {loading ? (
        <div
          className="bg-gray-100 animate-pulse rounded-lg"
          style={{ height: config.height }}
        />
      ) : (
        <ResponsiveContainer width="100%" height={config.height}>
          <BarChart data={leaderboardData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />

            <XAxis
              type="number"
              tick={{ fontSize: 12, fill: '#6B7280' }}
              tickFormatter={(value) => {
                const formatted = formatValue(value, config.config.format);
                return formatted.formatted;
              }}
            />

            <YAxis
              type="category"
              dataKey={config.config.nameKey}
              tick={{ fontSize: 12, fill: '#6B7280' }}
              width={150}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
              formatter={(value: any) => {
                const formatted = formatValue(value, config.config.format);
                return formatted.formatted;
              }}
            />

            <Bar
              dataKey={config.config.valueKey}
              fill="#3B82F6"
              radius={[0, 8, 8, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Show rank badges for top 3 */}
      {config.config.showRank !== false && leaderboardData.length > 0 && (
        <div className="mt-4 space-y-2">
          {leaderboardData.slice(0, 3).map((item, index) => (
            <div
              key={index}
              className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                {index === 0 && <Medal className="w-5 h-5 text-yellow-500" />}
                {index === 1 && <Medal className="w-5 h-5 text-gray-400" />}
                {index === 2 && <Medal className="w-5 h-5 text-orange-600" />}
                <span className="text-sm font-medium text-gray-700">
                  {item[config.config.nameKey]}
                </span>
              </div>
              <span className="text-sm font-semibold text-gray-900">
                {formatValue(item[config.config.valueKey], config.config.format).formatted}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
