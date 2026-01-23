import React, { useEffect, useState } from 'react';
import {
    BarChart3,
    TrendingUp,
    TrendingDown,
    DollarSign,
    Package,
    Download,
    Filter,
    PieChart,
    ArrowUpRight,
    ArrowDownRight
} from 'lucide-react';
import { useFinancialStore } from '../../stores/financialStore';
import { FinancialKPICard } from './cards/FinancialKPICard';
import { formatCurrency, formatPercentage } from '../../utils/format';
import { Card } from '../ui/Card';
import { Table, TableHead, TableBody, TableRow, TableCell } from '../ui/Table';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { DateRangePicker } from '../ui/DateRangePicker';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
    LineChart,
    Line
} from 'recharts';

export const ProfitabilityTab: React.FC = () => {
    const {
        profitabilityAnalysis,
        loadingStates,
        dateRange,
        fetchProfitabilityAnalysis,
        exportProfitability,
        setDateRange
    } = useFinancialStore();

    const [productId, setProductId] = useState<number | undefined>(undefined);

    useEffect(() => {
        fetchProfitabilityAnalysis({
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            productId
        });
    }, [dateRange.startDate, dateRange.endDate, productId]);

    const handleExport = (format: 'csv' | 'xlsx') => {
        exportProfitability({
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            productId,
            format
        });
    };

    if (loadingStates.profitability || !profitabilityAnalysis) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[...Array(4)].map((_, i) => (
                        <Card key={i} className="h-32">
                            <div />
                        </Card>
                    ))}
                </div>
                <Card className="h-96">
                    <div />
                </Card>
                <Card className="h-64">
                    <div />
                </Card>
            </div>
        );
    }

    const { summary, products, daily } = profitabilityAnalysis;

    return (
        <div className="space-y-6">
            {/* Filters and Actions */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-lg border border-gray-200">
                <div className="flex flex-wrap items-center gap-4">
                    <DateRangePicker
                        startDate={dateRange.startDate}
                        endDate={dateRange.endDate}
                        onChange={(start, end) => setDateRange(start, end)}
                    />
                    <div className="w-48">
                        <Select
                            value={productId?.toString() || ''}
                            onChange={(e) => setProductId(e.target.value ? parseInt(e.target.value) : undefined)}
                            options={[
                                { label: 'All Products', value: '' },
                                ...products.map(p => ({ label: p.name, value: p.id.toString() }))
                            ]}
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExport('csv')}
                    >
                        <Download className="w-4 h-4 mr-2" />
                        Export CSV
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExport('xlsx')}
                    >
                        <Download className="w-4 h-4 mr-2" />
                        Export Excel
                    </Button>
                </div>
            </div>

            {/* KPI Overviews */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <FinancialKPICard
                    title="Gross Profit"
                    value={summary.grossProfit}
                    icon={DollarSign}
                    iconColor="text-green-600"
                    iconBgColor="bg-green-100"
                    subtitle={`Margin: ${summary.grossMargin.toFixed(1)}%`}
                />
                <FinancialKPICard
                    title="Net Profit"
                    value={summary.netProfit}
                    icon={TrendingUp}
                    iconColor="text-blue-600"
                    iconBgColor="bg-blue-100"
                    subtitle={`Margin: ${summary.netMargin.toFixed(1)}%`}
                />
                <FinancialKPICard
                    title="Total COGS"
                    value={summary.totalCOGS}
                    icon={Package}
                    iconColor="text-orange-600"
                    iconBgColor="bg-orange-100"
                    subtitle={`${summary.orderCount} orders`}
                />
                <FinancialKPICard
                    title="Marketing & Ship"
                    value={summary.totalMarketingExpense + summary.totalShippingCost}
                    icon={BarChart3}
                    iconColor="text-purple-600"
                    iconBgColor="bg-purple-100"
                    subtitle={`Ship: ${formatCurrency(summary.totalShippingCost)}`}
                />
            </div>

            {/* Profitability Trend */}
            <Card>
                <div className="p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-gray-900">Profitability Trend</h3>
                        <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                                <span>Revenue</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                                <span>Gross Profit</span>
                            </div>
                        </div>
                    </div>
                    <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={daily}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 12 }}
                                    tickFormatter={(date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                />
                                <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `$${value}`} />
                                <Tooltip
                                    formatter={(value: number) => formatCurrency(value)}
                                    labelFormatter={(label) => new Date(label).toLocaleDateString(undefined, { dateStyle: 'long' })}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="revenue"
                                    stroke="#3b82f6"
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4 }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="grossProfit"
                                    stroke="#10b981"
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </Card>

            {/* Product breakdown */}
            <Card>
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Product Profitability</h3>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell isHeader>Product</TableCell>
                                <TableCell isHeader>SKU</TableCell>
                                <TableCell isHeader className="text-right">Quantity</TableCell>
                                <TableCell isHeader className="text-right">Revenue</TableCell>
                                <TableCell isHeader className="text-right">COGS</TableCell>
                                <TableCell isHeader className="text-right">Gross Profit</TableCell>
                                <TableCell isHeader className="text-right">Margin</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {products.map((product) => (
                                <TableRow key={product.id}>
                                    <TableCell className="font-medium">{product.name}</TableCell>
                                    <TableCell className="text-gray-500">{product.sku}</TableCell>
                                    <TableCell className="text-right">{product.quantity}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(product.revenue)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(product.cogs)}</TableCell>
                                    <TableCell className="text-right text-green-600 font-medium">
                                        {formatCurrency(product.grossProfit)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${product.grossMargin >= 30 ? 'bg-green-100 text-green-800' :
                                            product.grossMargin >= 10 ? 'bg-blue-100 text-blue-800' :
                                                'bg-red-100 text-red-800'
                                            }`}>
                                            {product.grossMargin.toFixed(1)}%
                                        </span>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </Card>
        </div>
    );
};
