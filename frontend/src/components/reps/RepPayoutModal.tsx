import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCurrency, formatDate } from '../../utils/format';
import { useCustomerRepsStore } from '../../stores/customerRepsStore';
import { CheckCircle, History, Wallet, ExternalLink } from 'lucide-react';

interface RepPayoutModalProps {
    repId: string | null;
    isOpen: boolean;
    onClose: () => void;
    repName: string;
}

export const RepPayoutModal: React.FC<RepPayoutModalProps> = ({
    repId,
    isOpen,
    onClose,
    repName
}) => {
    const {
        pendingPayments,
        payoutHistory,
        fetchPendingPayments,
        fetchPayoutHistory,
        processPayout,
        isLoading
    } = useCustomerRepsStore();

    const [selectedOrders, setSelectedOrders] = useState<number[]>([]);
    const [payoutMethod, setPayoutMethod] = useState('Bank Transfer');
    const [payoutNotes, setPayoutNotes] = useState('');

    useEffect(() => {
        if (isOpen && repId) {
            fetchPendingPayments(repId);
            fetchPayoutHistory(repId);
            setSelectedOrders([]);
        }
    }, [isOpen, repId, fetchPendingPayments, fetchPayoutHistory]);

    const totalSelectedCommission = pendingPayments
        .filter(p => selectedOrders.includes(p.orderId))
        .reduce((sum, p) => sum + p.commissionAmount, 0);

    const handleSelectAll = () => {
        if (selectedOrders.length === pendingPayments.length) {
            setSelectedOrders([]);
        } else {
            setSelectedOrders(pendingPayments.map(p => p.orderId));
        }
    };

    const handleToggleOrder = (orderId: number) => {
        setSelectedOrders(prev =>
            prev.includes(orderId)
                ? prev.filter(id => id !== orderId)
                : [...prev, orderId]
        );
    };

    const handleProcessPayout = async () => {
        if (!repId || selectedOrders.length === 0) return;

        try {
            await processPayout(repId, {
                amount: totalSelectedCommission,
                method: payoutMethod,
                orderIds: selectedOrders,
                notes: payoutNotes
            });
            setSelectedOrders([]);
            setPayoutNotes('');
        } catch (error) {
            // Error handled by store
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Payment Details - ${repName}`}
            size="xl"
        >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Side: Pending Payments */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="text-md font-semibold flex items-center gap-2">
                            <Wallet className="w-4 h-4 text-blue-500" />
                            Pending Commissions
                        </h4>
                        <Badge variant="warning">{pendingPayments.length} delivered</Badge>
                    </div>

                    <Card className="p-0 overflow-hidden border-blue-100 bg-blue-50/30">
                        <div className="p-4 bg-white border-b border-blue-100 flex justify-between items-center">
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Total Selected</p>
                                <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalSelectedCommission)}</p>
                            </div>
                            <Button
                                size="sm"
                                disabled={selectedOrders.length === 0 || isLoading}
                                onClick={handleProcessPayout}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                Process Payment
                            </Button>
                        </div>

                        <div className="max-h-[400px] overflow-y-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-2 text-left">
                                            <input
                                                type="checkbox"
                                                checked={pendingPayments.length > 0 && selectedOrders.length === pendingPayments.length}
                                                onChange={handleSelectAll}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            />
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Delivered</th>
                                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Comm.</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-100">
                                    {pendingPayments.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-4 py-8 text-center text-gray-500 italic">
                                                No pending commissions for delivered orders.
                                            </td>
                                        </tr>
                                    ) : (
                                        pendingPayments.map((p) => (
                                            <tr key={p.orderId} className="hover:bg-blue-50/50 transition-colors">
                                                <td className="px-4 py-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedOrders.includes(p.orderId)}
                                                        onChange={() => handleToggleOrder(p.orderId)}
                                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                </td>
                                                <td className="px-4 py-3">
                                                    <p className="text-sm font-medium text-gray-900">#{p.orderId}</p>
                                                    <p className="text-xs text-gray-500 truncate w-24">{p.customerName}</p>
                                                </td>
                                                <td className="px-4 py-3 text-xs text-gray-600">
                                                    {formatDate(p.deliveredAt)}
                                                </td>
                                                <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                                                    {formatCurrency(p.commissionAmount)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-gray-500">Method</label>
                            <select
                                value={payoutMethod}
                                onChange={(e) => setPayoutMethod(e.target.value)}
                                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option>Bank Transfer</option>
                                <option>Mobile Money</option>
                                <option>Cash</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500">Notes (Optional)</label>
                            <input
                                type="text"
                                value={payoutNotes}
                                onChange={(e) => setPayoutNotes(e.target.value)}
                                placeholder="Transaction ref..."
                                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Right Side: Payout History */}
                <div className="space-y-4">
                    <h4 className="text-md font-semibold flex items-center gap-2">
                        <History className="w-4 h-4 text-gray-500" />
                        Payout History
                    </h4>

                    <div className="max-h-[550px] overflow-y-auto space-y-3 pr-1">
                        {payoutHistory.length === 0 ? (
                            <div className="text-center py-12 text-gray-500 border-2 border-dashed border-gray-100 rounded-lg">
                                <History className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                <p>No payout history available.</p>
                            </div>
                        ) : (
                            payoutHistory.map((h) => (
                                <Card key={h.id} className="p-4 border-l-4 border-l-green-500 shadow-sm">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <p className="text-lg font-bold text-gray-900">{formatCurrency(h.amount)}</p>
                                            <p className="text-xs text-gray-500">{formatDate(h.payoutDate)}</p>
                                        </div>
                                        <Badge variant="success" className="bg-green-100 text-green-700 border-green-200">
                                            <CheckCircle className="w-3 h-3 mr-1" />
                                            Completed
                                        </Badge>
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-gray-600 mt-3 pt-3 border-t">
                                        <span className="flex items-center gap-1">
                                            <span className="font-medium">Method:</span> {h.method}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <span className="font-medium">Orders:</span> {h._count?.orders || 0}
                                        </span>
                                    </div>
                                    {h.notes && (
                                        <p className="text-xs text-gray-400 mt-2 italic bg-gray-50 p-1.5 rounded">
                                            Note: {h.notes}
                                        </p>
                                    )}
                                </Card>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
};
