import React, { useEffect } from 'react';
import { useFinancialStore } from '../../stores/financialStore';
import { Card } from '../ui/Card';
import { formatCurrency } from '../../utils/format';
import { Download, AlertCircle, Clock } from 'lucide-react';
import { financialService } from '../../services/financial.service';
import toast from 'react-hot-toast';

export const AgentAgingTab: React.FC = () => {
    const {
        agentAging,
        loadingStates,
        fetchAgentAging
    } = useFinancialStore();

    useEffect(() => {
        fetchAgentAging();
    }, []);

    const handleExport = async () => {
        try {
            const report = await financialService.getAgentAging();

            // CSV Header
            let csv = 'Agent,Total Balance,0-1 Day,2-3 Days,4-7 Days,8+ Days,Oldest Collection\n';

            for (const entry of report) {
                const agentName = `${entry.agent.firstName} ${entry.agent.lastName}`;
                const oldestDate = entry.oldestCollectionDate ? new Date(entry.oldestCollectionDate).toLocaleDateString() : 'N/A';

                csv += `"${agentName}",${entry.totalBalance},${entry.bucket_0_1},${entry.bucket_2_3},${entry.bucket_4_7},${entry.bucket_8_plus},"${oldestDate}"\n`;
            }

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            a.setAttribute('download', `agent-aging-report-${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (error) {
            toast.error('Failed to export aging report');
        }
    };

    const getBucketColor = (bucket: string) => {
        switch (bucket) {
            case '0_1': return 'bg-green-100 text-green-800';
            case '2_3': return 'bg-yellow-100 text-yellow-800';
            case '4_7': return 'bg-orange-100 text-orange-800';
            case '8_plus': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    if (loadingStates.agents) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

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

            <Card>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agent</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Balance</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">0-1 Day</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">2-3 Days</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">4-7 Days</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">8+ Days</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Oldest</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {agentAging.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                                        No aging data found
                                    </td>
                                </tr>
                            ) : (
                                agentAging.map((entry) => (
                                    <tr key={entry.agent.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">{entry.agent.firstName} {entry.agent.lastName}</div>
                                            <div className="text-xs text-gray-500">{entry.agent.email}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                                            {formatCurrency(entry.totalBalance)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getBucketColor('0_1')}`}>
                                                {formatCurrency(entry.bucket_0_1)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getBucketColor('2_3')}`}>
                                                {formatCurrency(entry.bucket_2_3)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getBucketColor('4_7')}`}>
                                                {formatCurrency(entry.bucket_4_7)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getBucketColor('8_plus')}`}>
                                                {formatCurrency(entry.bucket_8_plus)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            <div className="flex items-center">
                                                <Clock className="w-3 h-3 mr-1" />
                                                {new Date(entry.oldestCollectionDate).toLocaleDateString()}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-6 border-l-4 border-red-500">
                    <div className="flex items-start">
                        <AlertCircle className="w-5 h-5 text-red-500 mr-3 mt-1" />
                        <div>
                            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Critical Aging (8+ Days)</h4>
                            <p className="text-2xl font-bold text-red-600 mt-1">
                                {formatCurrency(agentAging.reduce((sum, e) => sum + e.bucket_8_plus, 0))}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">Total amount in 8+ days bucket across all agents</p>
                        </div>
                    </div>
                </Card>

                <Card className="p-6 border-l-4 border-orange-500">
                    <div className="flex items-start">
                        <AlertCircle className="w-5 h-5 text-orange-500 mr-3 mt-1" />
                        <div>
                            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Warning Aging (4-7 Days)</h4>
                            <p className="text-2xl font-bold text-orange-600 mt-1">
                                {formatCurrency(agentAging.reduce((sum, e) => sum + e.bucket_4_7, 0))}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">Total amount in 4-7 days bucket across all agents</p>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
};
