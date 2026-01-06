import React from 'react';
import { Card } from '../../ui/Card';
import { formatCurrency } from '../../../utils/format';

interface ExpenseCategoryCardProps {
  category: string;
  amount: number;
  count: number;
  percentage: number;
  onClick?: () => void;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  COGS: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
  'Delivery Fees': { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
  'Delivery': { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
  Marketing: { bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200' },
  Operations: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200' },
  Salaries: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
  Utilities: { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
  Other: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' }
};

const getColorsForCategory = (category: string) => {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
};

export const ExpenseCategoryCard: React.FC<ExpenseCategoryCardProps> = ({
  category,
  amount,
  count,
  percentage,
  onClick
}) => {
  const colors = getColorsForCategory(category);

  return (
    <Card
      className={`border-l-4 ${colors.border} ${colors.bg} ${onClick ? 'cursor-pointer hover:shadow-md' : ''
        } transition-shadow`}
      onClick={onClick}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className={`text-sm font-semibold ${colors.text}`}>
            {category}
          </h3>
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${colors.bg} ${colors.text}`}>
            {percentage.toFixed(1)}%
          </span>
        </div>
        <p className={`text-2xl font-bold ${colors.text} mb-1`}>
          {formatCurrency(amount)}
        </p>
        <p className="text-xs text-gray-500">
          {count} {count === 1 ? 'expense' : 'expenses'}
        </p>
      </div>
    </Card>
  );
};
