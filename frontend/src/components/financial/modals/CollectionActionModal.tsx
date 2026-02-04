import React, { useEffect, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { useFinancialStore } from '../../../stores/financialStore';
import { formatCurrency } from '../../../utils/format';
import { CheckCircle, Loader2, ListChecks } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import toast from 'react-hot-toast';

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
    const {
        currentAgentCollections,
        fetchAgentCollections,
        verifyCollection,
        bulkVerifyCollections,
        isLoading,
        fetchAgentCashHoldings,
        fetchAgentAging
    } = useFinancialStore();

    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [isProcessingBulk, setIsProcessingBulk] = useState(false);

    useEffect(() => {
        if (isOpen && agentId) {
            fetchAgentCollections(agentId);
            setSelectedIds([]); // Reset selection when modal opens
        }
    }, [isOpen, agentId, fetchAgentCollections]);

    const handleVerify = async (collectionId: number) => {
        await verifyCollection(collectionId);
        // Refresh both collections and cash holdings after verification
        fetchAgentCollections(agentId);
        fetchAgentCashHoldings();
        fetchAgentAging();
    };

    const handleBulkVerify = async () => {
        if (selectedIds.length === 0) return;

        setIsProcessingBulk(true);
        try {
            await bulkVerifyCollections(selectedIds);
            setSelectedIds([]);
            // Refresh automated data
            fetchAgentCollections(agentId);
            fetchAgentCashHoldings();
            fetchAgentAging();
        } catch (error) {
            // Error handled in store toast
        } finally {
            setIsProcessingBulk(false);
        }
    };

    const toggleSelectAll = () => {
        const reconcilableCollections = currentAgentCollections.filter(c => c.status !== 'reconciled');
        if (selectedIds.length === reconcilableCollections.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(reconcilableCollections.map(c => c.id));
        }
    };

    const toggleSelect = (id: number) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    if (!isOpen) return null;

    const reconcilableCount = currentAgentCollections.filter(c => c.status !== 'reconciled').length;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Collections for ${agentName}`}
            size="xl"
        >
            <div className="space-y-4">
                <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <div className="text-sm font-medium text-gray-700">
                        {selectedIds.length > 0 ? (
                            <span className="text-blue-600">{selectedIds.length} collections selected</span>
                        ) : (
                            <span>Select collections to reconcile in bulk</span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {selectedIds.length > 0 && (
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleBulkVerify}
                                isLoading={isProcessingBulk}
                            >
                                <ListChecks className="w-4 h-4 mr-2" />
                                Reconcile Selected ({selectedIds.length})
                            </Button>
                        )}
                    </div>
                </div>
                {isLoading && currentAgentCollections.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : (
                    <div className="overflow-x-auto min-h-[400px]">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 text-left">
                                        <input
                                            type="checkbox"
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                                            checked={reconcilableCount > 0 && selectedIds.length === reconcilableCount}
                                            onChange={toggleSelectAll}
                                            disabled={reconcilableCount === 0}
                                        />
                                    </th>
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
                                        <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                                            No pending collections for this agent.
                                        </td>
                                    </tr>
                                ) : (
                                    currentAgentCollections.map((collection) => (
                                        <tr
                                            key={collection.id}
                                            className={selectedIds.includes(collection.id) ? 'bg-blue-50' : ''}
                                        >
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {collection.status !== 'reconciled' && (
                                                    <input
                                                        type="checkbox"
                                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                                                        checked={selectedIds.includes(collection.id)}
                                                        onChange={() => toggleSelect(collection.id)}
                                                    />
                                                )}
                                            </td>
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
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleVerify(collection.id);
                                                            }}
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
