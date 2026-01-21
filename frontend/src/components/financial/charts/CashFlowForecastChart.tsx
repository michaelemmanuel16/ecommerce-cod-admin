import React from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    Area,
    AreaChart
} from 'recharts';
import { CashFlowForecastPoint } from '../../../services/financial.service';
import { formatCurrency } from '../../../utils/format';

interface CashFlowForecastChartProps {
    data: CashFlowForecastPoint[];
    height?: number;
}

export const CashFlowForecastChart: React.FC<CashFlowForecastChartProps> = ({
    data,
    height = 350
}) => {
    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-400">
                No forecast data available
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="#6b7280"
                    style={{ fontSize: '12px' }}
                    tick={{ fill: '#6b7280' }}
                />
                <YAxis
                    tickFormatter={(value) => formatCurrency(value)}
                    stroke="#6b7280"
                    style={{ fontSize: '12px' }}
                    tick={{ fill: '#6b7280' }}
                />
                <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => `Date: ${formatDate(label)}`}
                    contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                    }}
                />
                <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: '14px', paddingBottom: '20px' }}
                />
                <Area
                    type="monotone"
                    dataKey="projectedBalance"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorBalance)"
                    name="Projected Balance"
                    dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                />
                <Line
                    type="monotone"
                    dataKey="expectedCollection"
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Avg Daily Collection"
                />
                <Line
                    type="monotone"
                    dataKey="expectedExpense"
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Avg Daily Expense"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
};
