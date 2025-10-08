import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Card } from '../ui/Card';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: number;
  iconColor?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon: Icon,
  trend,
  iconColor = 'text-blue-600',
}) => {
  const isPositive = trend && trend > 0;
  const isNegative = trend && trend < 0;
  const trendAbs = trend ? Math.abs(trend) : 0;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {trend !== undefined && (
            <div className="flex items-center gap-1 mt-1">
              {isPositive ? (
                <TrendingUp className="w-4 h-4 text-green-600" />
              ) : isNegative ? (
                <TrendingDown className="w-4 h-4 text-red-600" />
              ) : null}
              <span
                className={
                  isPositive ? 'text-sm text-green-600' : isNegative ? 'text-sm text-red-600' : 'text-sm text-gray-600'
                }
              >
                {trendAbs}%
              </span>
            </div>
          )}
        </div>
        <div className="p-3 rounded-full bg-blue-50">
          <Icon className={`w-6 h-6 ${iconColor}`} />
        </div>
      </div>
    </Card>
  );
};
