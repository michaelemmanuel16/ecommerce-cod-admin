import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { useFinancialStore } from '../../../stores/financialStore';
import { financialService } from '../../../services/financial.service';
import { formatCurrency } from '../../../utils/format';
import { CheckCircle, XCircle, Loader2, ListChecks, ChevronLeft, ChevronRight, Image } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import toast from 'react-hot-toast';

const PAGE_SIZE = 50;

type Tab = 'collections' | 'deposits';

interface CollectionActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    agentId: number;
    agentName: string;
}

const collectionStatusColors = {
    draft: 'bg-yellow-100 text-yellow-800',
    verified: 'bg-blue-100 text-blue-800',
    approved: 'bg-indigo-100 text-indigo-800',
    deposited: 'bg-purple-100 text-purple-800',
    reconciled: 'bg-green-100 text-green-800',
};

const depositStatusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    verified: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
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

    const [activeTab, setActiveTab] = useState<Tab>('collections');
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [isProcessingBulk, setIsProcessingBulk] = useState(false);
    const [page, setPage] = useState(1);

    // Deposit state (managed locally for per-agent context)
    const [deposits, setDeposits] = useState<any[]>([]);
    const [depositsLoading, setDepositsLoading] = useState(false);
    const [depositVerifying, setDepositVerifying] = useState<number | null>(null);
    const [rejectingId, setRejectingId] = useState<number | null>(null);
    const [rejectNotes, setRejectNotes] = useState('');

    const fetchDeposits = useCallback(async () => {
        setDepositsLoading(true);
        try {
            const data = await financialService.getAgentDeposits({ agentId });
            setDeposits(data);
        } catch {
            toast.error('Failed to fetch deposits');
        } finally {
            setDepositsLoading(false);
        }
    }, [agentId]);

    useEffect(() => {
        if (isOpen && agentId) {
            fetchAgentCollections(agentId);
            fetchDeposits();
            setSelectedIds([]);
            setPage(1);
            setActiveTab('collections');
        }
    }, [isOpen, agentId, fetchAgentCollections, fetchDeposits]);

    const reconcilableCollections = useMemo(
        () => currentAgentCollections.filter(c => c.status !== 'reconciled'),
        [currentAgentCollections]
    );
    const totalPages = Math.max(1, Math.ceil(reconcilableCollections.length / PAGE_SIZE));
    const pagedCollections = useMemo(
        () => reconcilableCollections.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [reconcilableCollections, page]
    );

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
        // Select/deselect only the current page
        const pageIds = pagedCollections.map(c => c.id);
        const allPageSelected = pageIds.every(id => selectedIds.includes(id));
        if (allPageSelected) {
            setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)));
        } else {
            setSelectedIds(prev => [...new Set([...prev, ...pageIds])]);
        }
    };

    const toggleSelect = (id: number) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleVerifyDeposit = async (depositId: number) => {
        if (depositVerifying) return;
        setDepositVerifying(depositId);
        try {
            await financialService.verifyDeposit(depositId);
            toast.success('Deposit verified successfully');
            fetchDeposits();
            fetchAgentCashHoldings();
            fetchAgentAging();
        } catch (error: any) {
            toast.error(error?.response?.data?.message || 'Failed to verify deposit');
        } finally {
            setDepositVerifying(null);
        }
    };

    const handleRejectDeposit = async (depositId: number) => {
        if (!rejectNotes.trim()) {
            toast.error('Please provide a reason for rejection');
            return;
        }
        setDepositVerifying(depositId);
        try {
            await financialService.rejectDeposit(depositId, rejectNotes);
            toast.success('Deposit rejected');
            setRejectingId(null);
            setRejectNotes('');
            fetchDeposits();
            fetchAgentCashHoldings();
            fetchAgentAging();
        } catch (error: any) {
            toast.error(error?.response?.data?.message || 'Failed to reject deposit');
        } finally {
            setDepositVerifying(null);
        }
    };

    if (!isOpen) return null;

    const reconcilableCount = reconcilableCollections.length;
    const pageIds = pagedCollections.map(c => c.id);
    const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.includes(id));
    const pendingDepositsCount = deposits.filter(d => d.status === 'pending').length;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`${agentName}`}
            size="xl"
        >
            <div className="space-y-4">
                {/* Tab Bar */}
                <div className="flex border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('collections')}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'collections'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Collections
                        {reconcilableCount > 0 && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                {reconcilableCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('deposits')}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'deposits'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Deposits
                        {pendingDepositsCount > 0 && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                {pendingDepositsCount} pending
                            </span>
                        )}
                    </button>
                </div>

                {/* Collections Tab */}
                {activeTab === 'collections' && (
                    <>
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
                                                    checked={allPageSelected}
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
                                            pagedCollections.map((collection) => (
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
                                                        <Badge className={collectionStatusColors[collection.status as keyof typeof collectionStatusColors] || 'bg-gray-100 text-gray-800'}>
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

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between border-t border-gray-200 pt-3">
                                <span className="text-sm text-gray-500">
                                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, reconcilableCount)} of {reconcilableCount}
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                        className="p-1.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <span className="text-sm font-medium text-gray-700">
                                        Page {page} of {totalPages}
                                    </span>
                                    <button
                                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                        disabled={page === totalPages}
                                        className="p-1.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* Deposits Tab */}
                {activeTab === 'deposits' && (
                    <>
                        {depositsLoading && deposits.length === 0 ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                            </div>
                        ) : (
                            <div className="overflow-x-auto min-h-[400px]">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50 sticky top-0 z-10">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Receipt</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {deposits.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                                                    No deposits found for this agent.
                                                </td>
                                            </tr>
                                        ) : (
                                            deposits.map((deposit) => (
                                                <tr key={deposit.id} className="hover:bg-gray-50">
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {deposit.referenceNumber}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">
                                                        {formatCurrency(deposit.amount)}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {deposit.depositMethod.replace('_', ' ').toUpperCase()}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                                        {new Date(deposit.depositDate).toLocaleDateString()}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                                                        {deposit.receiptUrl ? (
                                                            <a
                                                                href={deposit.receiptUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                                                            >
                                                                <Image className="w-4 h-4" />
                                                                <span>View</span>
                                                            </a>
                                                        ) : (
                                                            <span className="text-gray-400">No receipt</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        <Badge className={depositStatusColors[deposit.status as keyof typeof depositStatusColors] || 'bg-gray-100 text-gray-800'}>
                                                            {deposit.status.charAt(0).toUpperCase() + deposit.status.slice(1)}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                                        <div className="flex justify-end gap-2">
                                                            {deposit.status === 'pending' && (
                                                                <>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="primary"
                                                                        onClick={() => handleVerifyDeposit(deposit.id)}
                                                                        disabled={depositVerifying !== null}
                                                                        isLoading={depositVerifying === deposit.id}
                                                                    >
                                                                        <CheckCircle className="w-4 h-4 mr-1" />
                                                                        Verify
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        onClick={() => {
                                                                            setRejectingId(rejectingId === deposit.id ? null : deposit.id);
                                                                            setRejectNotes('');
                                                                        }}
                                                                        disabled={depositVerifying !== null}
                                                                    >
                                                                        <XCircle className="w-4 h-4 mr-1" />
                                                                        Reject
                                                                    </Button>
                                                                </>
                                                            )}
                                                            {deposit.status === 'verified' && (
                                                                <span className="text-green-600 text-sm">✓ Verified</span>
                                                            )}
                                                            {deposit.status === 'rejected' && (
                                                                <span className="text-red-600 text-sm">✗ Rejected</span>
                                                            )}
                                                        </div>
                                                        {rejectingId === deposit.id && (
                                                            <div className="mt-2 flex gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={rejectNotes}
                                                                    onChange={(e) => setRejectNotes(e.target.value)}
                                                                    placeholder="Reason for rejection..."
                                                                    className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500"
                                                                />
                                                                <Button
                                                                    size="sm"
                                                                    variant="danger"
                                                                    onClick={() => handleRejectDeposit(deposit.id)}
                                                                    disabled={depositVerifying !== null}
                                                                >
                                                                    Confirm
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
};
