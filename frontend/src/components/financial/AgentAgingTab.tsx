import React, { useEffect, useState, useMemo } from 'react';
import { useFinancialStore } from '../../stores/financialStore';
import { Card } from '../ui/Card';
import { formatCurrency } from '../../utils/format';
import { Download, AlertCircle, Clock, Users, ShieldAlert, BarChart3, Filter, FileText, Mail, Ban, Eye, ChevronUp, ChevronDown } from 'lucide-react';
import { financialService } from '../../services/financial.service';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import toast from 'react-hot-toast';
import { cn } from '../../utils/cn';
import { Link } from 'react-router-dom';

export const AgentAgingTab: React.FC = () => {
    const {
        agentAging,
        loadingStates,
        fetchAgentAging
    } = useFinancialStore();

    const [filterOverdue, setFilterOverdue] = useState(false);
    const [sortField, setSortField] = useState<string>('totalBalance');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    useEffect(() => {
        fetchAgentAging();
    }, []);

    const handleExport = async () => {
        try {
            await financialService.downloadAgentAgingCSV();
            toast.success('Agent aging report exported');
        } catch (error) {
            toast.error('Failed to export aging report');
        }
    };

    const getBucketColor = (bucket: string) => {
        switch (bucket) {
            case '0_1': return 'bg-green-100 text-green-800';
            case '2_3': return 'bg-blue-100 text-blue-800';
            case '4_7': return 'bg-orange-100 text-orange-800';
            case '8_plus': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const filteredAndSortedBuckets = useMemo(() => {
        if (!agentAging) return [];

        let result = [...agentAging.buckets];

        if (filterOverdue) {
            result = result.filter(b => b.bucket_4_7 > 0 || b.bucket_8_plus > 0);
        }

        result.sort((a: any, b: any) => {
            let valA = a[sortField];
            let valB = b[sortField];

            // Handle nested paths if needed
            if (sortField === 'name') {
                valA = `${a.agent.firstName} ${a.agent.lastName}`;
                valB = `${b.agent.firstName} ${b.agent.lastName}`;
            }

            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [agentAging, filterOverdue, sortField, sortOrder]);

    const chartData = useMemo(() => {
        if (!agentAging?.summary?.bucketTotals) return [];
        const { bucketTotals } = agentAging.summary;
        return [
            { name: '0-1 Day', value: bucketTotals.bucket_0_1, color: '#22c55e' },
            { name: '2-3 Days', value: bucketTotals.bucket_2_3, color: '#3b82f6' },
            { name: '4-7 Days', value: bucketTotals.bucket_4_7, color: '#f97316' },
            { name: '8+ Days', value: bucketTotals.bucket_8_plus, color: '#ef4444' },
        ].filter(d => d.value > 0);
    }, [agentAging]);

    if (loadingStates.agents || !agentAging) {
        return (
            <div className="flex flex-col items-center justify-center py-24 bg-white rounded-lg border border-gray-100 shadow-sm">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
                <p className="mt-4 text-gray-500 font-medium italic">Assembling aging report...</p>
            </div>
        );
    }

    const { summary } = agentAging;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Agent Aging Analysis</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Tracking aging of approved collections not yet deposited by agents
                    </p>
                </div>
                <button
                    onClick={handleExport}
                    className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                    <Download className="w-4 h-4 mr-2" />
                    Export CSV
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border-l-4 border-primary-500 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Outstanding AR</span>
                        <div className="p-1.5 bg-primary-50 rounded-lg">
                            <BarChart3 className="w-4 h-4 text-primary-600" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">{formatCurrency(summary.totalOutstandingAmount)}</div>
                    <div className="text-xs text-gray-500 mt-1">Held by {summary.totalAgentsWithBalance} agents</div>
                </Card>

                <Card className="border-l-4 border-red-500 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Critical (8+ Days)</span>
                        <div className="p-1.5 bg-red-50 rounded-lg">
                            <AlertCircle className="w-4 h-4 text-red-600" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-red-600">{formatCurrency(summary.criticalOverdueAmount)}</div>
                    <div className="text-xs text-red-500 font-medium mt-1">{summary.overdueAgentsCount} agents overdue</div>
                </Card>

                <Card className="border-l-4 border-orange-500 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Warning (4-7 Days)</span>
                        <div className="p-1.5 bg-orange-50 rounded-lg">
                            <Clock className="w-4 h-4 text-orange-600" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-orange-600">{formatCurrency(summary.warningOverdueAmount)}</div>
                    <div className="text-xs text-gray-500 mt-1">Pending action required</div>
                </Card>

                <Card className="border-l-4 border-gray-900 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Blocked Agents</span>
                        <div className="p-1.5 bg-gray-50 rounded-lg">
                            <ShieldAlert className="w-4 h-4 text-gray-900" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">{summary.blockedAgentsWithBalance}</div>
                    <div className="text-xs text-gray-500 mt-1">Restricted from deliveries</div>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-1 p-0 flex flex-col">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Exposure Distribution</h3>
                    </div>
                    <div className="h-64 mt-4 mb-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value: number) => formatCurrency(value)}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="px-6 py-4 mt-auto border-t border-gray-100 bg-gray-50/30 text-[11px] text-gray-500 italic">
                        Values represent the total amount held in each bucket across all agents.
                    </div>
                </Card>

                <Card className="lg:col-span-2 p-0">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <div className="flex items-center space-x-3">
                            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Agent Details</h3>
                            <div className="h-4 w-px bg-gray-200" />
                            <div className="flex items-center bg-white border border-gray-200 rounded-md px-2 py-1">
                                <Filter className="w-3.5 h-3.5 text-gray-400 mr-2" />
                                <label className="flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                                        checked={filterOverdue}
                                        onChange={(e) => setFilterOverdue(e.target.checked)}
                                    />
                                    <span className="ml-2 text-xs font-medium text-gray-700 select-none">Show Overdue Only</span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-white">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-900 transition-colors group" onClick={() => { setSortField('name'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                                        <div className="flex items-center">
                                            Agent
                                            {sortField === 'name' ? (
                                                sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 ml-1 text-primary-600" /> : <ChevronDown className="w-3 h-3 ml-1 text-primary-600" />
                                            ) : (
                                                <Users className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100" />
                                            )}
                                        </div>
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-900 transition-colors group" onClick={() => { setSortField('totalBalance'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                                        <div className="flex items-center">
                                            Balance
                                            {sortField === 'totalBalance' ? (
                                                sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 ml-1 text-primary-600" /> : <ChevronDown className="w-3 h-3 ml-1 text-primary-600" />
                                            ) : (
                                                <BarChart3 className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100" />
                                            )}
                                        </div>
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">0-3 Days</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">4-7 Days</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">8+ Days</th>
                                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                                {filteredAndSortedBuckets.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-400 italic text-sm">
                                            No aging data found matching filters
                                        </td>
                                    </tr>
                                ) : (
                                    filteredAndSortedBuckets.map((entry) => (
                                        <tr key={entry.agent.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <Link to={`/users/${entry.agent.id}`} className="block">
                                                    <div className="text-sm font-bold text-primary-600 hover:underline">{entry.agent.firstName} {entry.agent.lastName}</div>
                                                    <div className="text-[11px] text-gray-500 font-mono mt-0.5">{entry.agent.email}</div>
                                                </Link>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-black text-gray-900 font-mono">
                                                {formatCurrency(entry.totalBalance)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="space-y-1">
                                                    <div className="flex items-center text-[10px] font-bold text-gray-400 uppercase tracking-tight">
                                                        <span>{formatCurrency(entry.bucket_0_1 + entry.bucket_2_3)}</span>
                                                    </div>
                                                    <div className="w-16 h-1 bg-gray-100 rounded-full overflow-hidden">
                                                        {entry.totalBalance > 0 && (
                                                            <div
                                                                className="h-full bg-green-500 rounded-full"
                                                                style={{ width: `${Math.min(100, ((entry.bucket_0_1 + entry.bucket_2_3) / entry.totalBalance) * 100)}%` }}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider",
                                                    entry.bucket_4_7 > 0 ? getBucketColor('4_7') : "text-gray-300"
                                                )}>
                                                    {formatCurrency(entry.bucket_4_7)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider",
                                                    entry.bucket_8_plus > 0 ? getBucketColor('8_plus') : "text-gray-300"
                                                )}>
                                                    {formatCurrency(entry.bucket_8_plus)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right">
                                                <div className="flex items-center justify-end space-x-1">
                                                    <button
                                                        title="Send Reminder Email"
                                                        aria-label={`Send reminder to ${entry.agent.firstName}`}
                                                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                                                        onClick={() => toast.success(`Reminder sent to ${entry.agent.firstName}`)}
                                                    >
                                                        <Mail className="w-3.5 h-3.5" />
                                                    </button>
                                                    <Link
                                                        to={`/financial/reconciliation?agentId=${entry.agent.id}`}
                                                        title="View Collections"
                                                        aria-label={`View collections for ${entry.agent.firstName}`}
                                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                    </Link>
                                                    <button
                                                        title="Block Agent"
                                                        aria-label={`Block agent ${entry.agent.firstName}`}
                                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                        onClick={() => toast.error(`Block functionality for ${entry.agent.firstName} triggered`)}
                                                    >
                                                        <Ban className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
        </div>
    );
};
