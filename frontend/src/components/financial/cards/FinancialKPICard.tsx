import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Tooltip } from '../../ui/Tooltip';
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
  info?: string;
}

export const FinancialKPICard: React.FC<FinancialKPICardProps> = ({
  title,
  value,
  icon: Icon,
  iconColor,
  iconBgColor,
  subtitle,
  trend,
  onClick,
  info
}) => {
  const formatVal = (val: string | number) => {
    if (typeof val === 'number') {
      return formatCurrency(val);
    }
    return val;
  };

  return (
    <Card
      className={`hover:shadow-lg transition-shadow relative ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="p-5">
        {/* Icon — absolute top-right */}
        <div className={`absolute top-4 right-4 h-10 w-10 ${iconBgColor} rounded-full flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>

        {/* Title row — right-padded to clear icon */}
        <div className="pr-14 flex items-center gap-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          {info && (
            <Tooltip content={info} position="bottom">
              <Info className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 flex-shrink-0 cursor-help" />
            </Tooltip>
          )}
        </div>

        {/* Value — full width */}
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
              className={`text-xs font-medium ${trend.value >= 0 ? 'text-green-600' : 'text-red-600'}`}
            >
              {trend.value >= 0 ? '+' : ''}
              {trend.value}% {trend.label}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
};
