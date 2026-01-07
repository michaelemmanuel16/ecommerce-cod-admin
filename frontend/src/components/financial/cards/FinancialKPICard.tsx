import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Card } from '../../ui/Card';
import { formatCurrency } from '../../../utils/format';

interface FinancialKPICardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
  subtitle?: string;
  trend?: {
    value: number;
    label: string;
  };
  onClick?: () => void;
}

export const FinancialKPICard: React.FC<FinancialKPICardProps> = ({
  title,
  value,
  icon: Icon,
  iconColor,
  iconBgColor,
  subtitle,
  trend,
  onClick
}) => {
  const formatVal = (val: string | number) => {
    if (typeof val === 'number') {
      return formatCurrency(val);
    }
    return val;
  };

  return (
    <Card
      className={`hover:shadow-lg transition-shadow ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">
              {formatVal(value)}
            </p>
            {subtitle && (
              <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
            )}
            {trend && (
              <div className="flex items-center mt-2">
                {trend.value >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-600 mr-1" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-600 mr-1" />
                )}
                <span
                  className={`text-xs font-medium ${trend.value >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                >
                  {trend.value >= 0 ? '+' : ''}
                  {trend.value}% {trend.label}
                </span>
              </div>
            )}
          </div>
          <div className={`h-12 w-12 ${iconBgColor} rounded-full flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-6 h-6 ${iconColor}`} />
          </div>
        </div>
      </div>
    </Card>
  );
};
