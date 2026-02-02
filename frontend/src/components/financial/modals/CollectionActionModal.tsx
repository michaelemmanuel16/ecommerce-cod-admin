import React, { useEffect } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { useFinancialStore } from '../../../stores/financialStore';
import { formatCurrency } from '../../../utils/format';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Badge } from '../../ui/Badge';

interface CollectionActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    agentId: number;
    agentName: string;
}

const statusColors = {
    draft: 'bg-yellow-100 text-yellow-800',
    verified: 'bg-blue-100 text-blue-800',
    reconciled: 'bg-green-100 text-green-800',
};

export const CollectionActionModal: React.FC<CollectionActionModalProps> = ({
    isOpen,
    onClose,
    agentId,
    agentName,
}) => {
    const { currentAgentCollections, fetchAgentCollections, verifyCollection, isLoading, fetchAgentCashHoldings } = useFinancialStore();

    useEffect(() => {
        if (isOpen && agentId) {
            fetchAgentCollections(agentId);
        }
    }, [isOpen, agentId, fetchAgentCollections]);

    const handleVerify = async (collectionId: number) => {
        await verifyCollection(collectionId);
        // Refresh both collections and cash holdings after verification
        fetchAgentCollections(agentId);
        fetchAgentCashHoldings();
    };

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Collections for ${agentName}`}
            size="xl"
        >
            <div className="space-y-4">
                {isLoading && currentAgentCollections.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order ID</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {currentAgentCollections.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                                            No pending collections for this agent.
                                        </td>
                                    </tr>
                                ) : (
                                    currentAgentCollections.map((collection) => (
                                        <tr key={collection.id}>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                                #{collection.orderId}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                                {formatCurrency(collection.amount)}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                {new Date(collection.collectionDate).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <Badge className={statusColors[collection.status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'}>
                                                    {collection.status.charAt(0).toUpperCase() + collection.status.slice(1)}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                                <div className="flex justify-end gap-2">
                                                    {(collection.status === 'draft' || collection.status === 'verified') && (
                                                        <Button
                                                            size="sm"
                                                            variant="primary"
                                                            onClick={() => handleVerify(collection.id)}
                                                        >
                                                            <CheckCircle className="w-4 h-4 mr-1" />
                                                            Reconcile
                                                        </Button>
                                                    )}
                                                    {collection.status === 'reconciled' && (
                                                        <span className="text-green-600 text-sm">✓ Reconciled</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Modal>
    );
};
