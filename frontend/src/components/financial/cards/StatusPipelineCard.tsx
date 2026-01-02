import React from 'react';
import { Card } from '../../ui/Card';

interface StatusPipelineCardProps {
  status: 'pending' | 'collected' | 'deposited' | 'reconciled';
  count: number;
  amount: number;
  onClick?: () => void;
}

const STATUS_CONFIG = {
  pending: {
    label: 'Pending Collection',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200'
  },
  collected: {
    label: 'Collected',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200'
  },
  deposited: {
    label: 'Deposited',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200'
  },
  reconciled: {
    label: 'Reconciled',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200'
  }
};

export const StatusPipelineCard: React.FC<StatusPipelineCardProps> = ({
  status,
  count,
  amount,
  onClick
}) => {
  const config = STATUS_CONFIG[status];

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <Card
      className={`border-l-4 ${config.borderColor} ${config.bgColor} ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      } transition-shadow`}
      onClick={onClick}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className={`text-sm font-semibold ${config.color}`}>
            {config.label}
          </h3>
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${config.bgColor} ${config.color}`}>
            {count} {count === 1 ? 'order' : 'orders'}
          </span>
        </div>
        <p className={`text-2xl font-bold ${config.color}`}>
          {formatCurrency(amount)}
        </p>
      </div>
    </Card>
  );
};
