import React, { useEffect } from 'react';
import { useAnalyticsStore } from '../../stores/analyticsStore';
import { RevenueChart } from '../../components/analytics/RevenueChart';
import { ProductPerformanceChart } from '../../components/analytics/ProductPerformanceChart';
import { AreaDistributionChart } from '../../components/analytics/AreaDistributionChart';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/format';

interface SalesRevenueTabProps {
  startDate?: string;
  endDate?: string;
}

export const SalesRevenueTab: React.FC<SalesRevenueTabProps> = ({ startDate, endDate }) => {
  const {
    trends,
    productPerformance,
    areaDistribution,
    fetchSalesTrends,
    fetchProductPerformance,
    fetchAreaDistribution,
  } = useAnalyticsStore();

  useEffect(() => {
    fetchSalesTrends('daily', undefined, startDate, endDate);
    fetchProductPerformance(startDate, endDate);
    fetchAreaDistribution(startDate, endDate);
  }, [startDate, endDate, fetchSalesTrends, fetchProductPerformance, fetchAreaDistribution]);

  return (
    <div className="space-y-6">
      {/* Revenue & Orders Trend */}
      <RevenueChart data={trends} title="Revenue & Orders Over Time" />

      {/* Products and Areas Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProductPerformanceChart data={productPerformance} />
        <AreaDistributionChart data={areaDistribution} />
      </div>

      {/* Daily Sales Table */}
      {trends.length > 0 && (
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Sales Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Orders</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delivered</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {trends.map((trend) => (
                    <tr key={trend.date} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {new Date(trend.date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                        {trend.orders}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{trend.delivered}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                        {formatCurrency(trend.revenue)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            trend.conversionRate >= 70
                              ? 'bg-green-100 text-green-800'
                              : trend.conversionRate >= 50
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {trend.conversionRate.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
