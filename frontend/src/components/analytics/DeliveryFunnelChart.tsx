import React from 'react';
import { Card } from '../ui/Card';
import { ConversionFunnelStep } from '../../services/analytics.service';

interface DeliveryFunnelChartProps {
  data: ConversionFunnelStep[];
  title?: string;
}

const PIPELINE_ORDER = [
  'pending_confirmation',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'out_for_delivery',
  'delivered',
];

const STAGE_LABELS: Record<string, string> = {
  pending_confirmation: 'Pending Confirmation',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready for Pickup',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
};

const STAGE_COLORS: Record<string, string> = {
  pending_confirmation: 'bg-amber-500',
  confirmed: 'bg-blue-500',
  preparing: 'bg-violet-500',
  ready_for_pickup: 'bg-cyan-500',
  out_for_delivery: 'bg-orange-500',
  delivered: 'bg-emerald-500',
};

export const DeliveryFunnelChart: React.FC<DeliveryFunnelChartProps> = ({
  data,
  title = 'Order Pipeline',
}) => {
  const statusMap = new Map(data.map((d) => [d.status, d.count]));
  const stages = PIPELINE_ORDER.map((status) => ({
    status,
    label: STAGE_LABELS[status] || status,
    count: statusMap.get(status) || 0,
    color: STAGE_COLORS[status] || 'bg-gray-500',
  }));

  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  const totalOrders = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        {totalOrders === 0 ? (
          <p className="text-gray-500 text-center py-12">No data available</p>
        ) : (
          <div className="space-y-3">
            {stages.map((stage, idx) => {
              const widthPercent = Math.max((stage.count / maxCount) * 100, 2);
              const conversionRate =
                idx > 0 && stages[idx - 1].count > 0
                  ? ((stage.count / stages[idx - 1].count) * 100).toFixed(0)
                  : null;

              return (
                <div key={stage.status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-700">{stage.label}</span>
                    <div className="flex items-center gap-2">
                      {conversionRate && (
                        <span className="text-xs text-gray-400">{conversionRate}%</span>
                      )}
                      <span className="text-sm font-semibold text-gray-900">
                        {stage.count}
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-6">
                    <div
                      className={`${stage.color} h-6 rounded-full transition-all duration-500`}
                      style={{ width: `${widthPercent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
};
